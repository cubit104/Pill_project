import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import Card, { SectionLabel } from '../components/Card'
import Chip from '../components/Chip'
import Disclaimer from '../components/Disclaimer'
import { CameraIcon, CheckIcon, ImagesIcon } from '../components/Icons'
import LabelScanner from '../components/LabelScanner'
import { PillThumb, TextBadge } from '../components/PillRow'
import ScreenHeader from '../components/ScreenHeader'
import TextField from '../components/TextField'
import { useToast } from '../components/Toast'
import { useAccount } from '../lib/account'
import { getDrugPills, lookupDrugs, suggestDrugs, type DrugRow, type SearchResult } from '../lib/api'
import { useBackHandler } from '../lib/backstack'
import { isPreviewSupported, takeSystemPhoto } from '../lib/camera'
import { useLocale, useT } from '../lib/i18n'
import { drugNameCandidates, parseLabel, scheduleFromSig, type OcrLine, type ParsedLabel, type SigSchedule } from '../lib/labelParse'
import { hapticNotify, hapticTick } from '../lib/native'
import { blobToBase64, ocrAvailable, recognizeText } from '../lib/ocr'

const PRESET_TIMES = [
  { label: 'Morning', time: '08:00' },
  { label: 'Noon', time: '12:00' },
  { label: 'Evening', time: '18:00' },
  { label: 'Bedtime', time: '22:00' },
]

type Phase = 'idle' | 'scanning' | 'reading' | 'matching' | 'review' | 'saving'

function normStrength(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/\s+/g, '').replace(/,/g, '.')
}

/**
 * Scan a pharmacy bottle: photo → on-device OCR → parsed label → matched pill →
 * one tap saves the pill, its reminder schedule, refill count, Rx and pharmacy.
 */
export default function BottleScanScreen() {
  const t = useT()
  const locale = useLocale()
  const navigate = useNavigate()
  const account = useAccount()
  const toast = useToast()
  const scrollRef = useRef<HTMLDivElement>(null)
  const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate('/cabinet', { replace: true }))
  useBackHandler(true, goBack)

  const [phase, setPhase] = useState<Phase>('idle')
  const [preview, setPreview] = useState<string | null>(null)
  const [lines, setLines] = useState<OcrLine[]>([])
  const [label, setLabel] = useState<ParsedLabel | null>(null)
  const [drugs, setDrugs] = useState<DrugRow[]>([])
  const [drug, setDrug] = useState<DrugRow | null>(null)
  const [strength, setStrength] = useState<string | null>(null)
  const [pills, setPills] = useState<SearchResult[]>([])
  const [pill, setPill] = useState<SearchResult | null>(null)
  const [directions, setDirections] = useState('')
  const [quantity, setQuantity] = useState('')
  const [rx, setRx] = useState('')
  const [pharmacy, setPharmacy] = useState('')
  const [showRaw, setShowRaw] = useState(false)
  // The label proposes times; the patient can change them before saving.
  const [times, setTimes] = useState<string[]>([])
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6])
  const [picked, setPicked] = useState('')
  const [replaceExisting, setReplaceExisting] = useState(false)
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<DrugRow[]>([])
  const [error, setError] = useState<string | null>(null)

  const schedule: SigSchedule | null = useMemo(() => scheduleFromSig(directions), [directions])

  // Follow the label as it is read or edited, until the patient touches the times.
  const [timesTouched, setTimesTouched] = useState(false)
  useEffect(() => {
    if (timesTouched || !schedule) return
    setTimes(schedule.times)
    setDays(schedule.days)
  }, [schedule, timesTouched])

  const setTimesByHand = (next: string[]) => {
    setTimesTouched(true)
    setTimes(next)
  }
  const toggleTime = (time: string) => setTimesByHand(times.includes(time) ? times.filter((x) => x !== time) : [...times, time].sort())

  /** The pill's current schedule, when it is already in the cabinet. */
  const existingReminder = useMemo(() => {
    const slug = pill?.slug
    if (!slug) return null
    const item = account.items.find((i) => i.slug === slug)
    return item ? (account.reminders.find((r) => r.cabinet_item_id === item.id) ?? null) : null
  }, [pill?.slug, account.items, account.reminders])

  /** Live scan (turn the bottle) when the native preview exists; otherwise a single photo. */
  const scan = async (source: 'camera' | 'photos') => {
    void hapticTick()
    setError(null)
    if (source === 'camera' && isPreviewSupported()) {
      setPhase('scanning')
      return
    }
    const photo = await takeSystemPhoto(source)
    if (!photo) return
    setPreview(photo.previewUrl)
    setPhase('reading')
    try {
      const found = await recognizeText(await blobToBase64(photo.blob))
      await handleRead(found, parseLabel(found))
    } catch (err) {
      setPhase('review')
      setError(err instanceof Error ? err.message : t('Could not read the label'))
    }
  }

  const handleRead = async (found: OcrLine[], parsed: ParsedLabel) => {
    try {
      setLines(found)
      setLabel(parsed)
      setTimesTouched(false)
      setReplaceExisting(false)
      setDirections(parsed.directions ?? '')
      setQuantity(parsed.quantity ? String(parsed.quantity) : '')
      setRx(parsed.rxNumber ?? '')
      setPharmacy([parsed.pharmacyName, parsed.pharmacyPhone].filter(Boolean).join(' · '))
      if (!parsed.drugName) {
        setPhase('review')
        setError(t('Could not find a drug name on the label. Aim at the part with the drug name and directions, then try again.'))
        return
      }
      setPhase('matching')
      // Labels use shorthand ("AMOX/K CLAV"); try the printed name, its expansion, then each ingredient.
      let results: DrugRow[] = []
      for (const candidate of drugNameCandidates(parsed.drugName)) {
        results = (await lookupDrugs(candidate)).results
        if (results.length) break
      }
      setDrugs(results)
      const best = results[0] ?? null
      if (best) await chooseDrug(best, parsed.strength)
      else setQuery(parsed.drugName)
      setPhase('review')
    } catch (err) {
      setPhase('review')
      setError(err instanceof Error ? err.message : t('Could not match the drug'))
    }
  }

  const search = async (q: string) => {
    setQuery(q)
    if (q.trim().length < 2) {
      setSuggestions([])
      return
    }
    try {
      setSuggestions(await suggestDrugs(q.trim()))
    } catch {
      setSuggestions([])
    }
  }

  const chooseDrug = async (row: DrugRow, wanted: string | null) => {
    setDrug(row)
    const target = normStrength(wanted)
    const match = row.strengths.find((s) => normStrength(s) === target) ?? row.strengths.find((s) => target && normStrength(s).startsWith(target.replace(/[a-z%]+$/, ''))) ?? (row.strengths.length === 1 ? row.strengths[0] : null)
    await chooseStrength(row, match ?? null)
  }

  const chooseStrength = async (row: DrugRow, s: string | null) => {
    setStrength(s)
    setPill(null)
    setPills([])
    if (!s) return
    try {
      const { results } = await getDrugPills(row.name, s)
      setPills(results)
      if (results.length === 1) setPill(results[0] ?? null)
    } catch {
      /* user can still pick manually */
    }
  }

  const save = async () => {
    if (!pill?.slug) return
    if (!account.user) {
      navigate('/account')
      return
    }
    void hapticTick()
    setPhase('saving')
    try {
      const item = await account.add(pill.slug)
      const qty = parseInt(quantity, 10)
      const [pharmacyName, pharmacyPhone] = pharmacy.split('·').map((x) => x.trim())
      await account.update(item.id, {
        ...(Number.isFinite(qty) && qty > 0 ? { pills_on_hand: qty, fill_quantity: qty, pills_counted_at: new Date().toISOString(), pills_per_day: schedule?.pillsPerDay ?? null } : {}),
        directions: directions.trim() || null,
        rx_number: rx.trim() || null,
        pharmacy_name: pharmacyName || label?.pharmacyName || null,
        pharmacy_phone: pharmacyPhone || label?.pharmacyPhone || null,
        prescriber: label?.prescriber ?? null,
        refills_left: label?.refills ?? null,
      })
      // Never quietly change a schedule the patient set themselves.
      const keepExisting = existingReminder !== null && !replaceExisting
      if (times.length > 0 && !keepExisting) {
        await account.upsertReminder({
          id: existingReminder?.id,
          cabinet_item_id: item.id,
          times,
          days,
          dose: schedule?.dose ?? null,
          enabled: true,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
        })
      }
      void hapticNotify('success')
      toast.show(times.length > 0 && !(existingReminder && !replaceExisting) ? t('Saved with reminders') : t('Saved to your cabinet'), 'success')
      navigate('/cabinet', { replace: true })
    } catch (err) {
      setPhase('review')
      toast.show(err instanceof Error ? err.message : t('Could not save'), 'error')
    }
  }

  const fmt = (time: string) => {
    const [h, m] = time.split(':').map((x) => parseInt(x, 10))
    return new Date(2000, 0, 1, h ?? 0, m ?? 0).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-canvas">
      {phase === 'scanning' && (
        <LabelScanner
          onDone={({ label: parsed, lines: found }) => {
            setPreview(null)
            setPhase('reading')
            void handleRead(found, parsed)
          }}
          onCancel={() => setPhase(label ? 'review' : 'idle')}
          onUnavailable={() => {
            setPhase('idle')
            setError(t('The camera is not available. Use Library to pick a photo of the label.'))
          }}
        />
      )}
      <ScreenHeader title={t('Scan a bottle')} subtitle={t('Pharmacy label → cabinet')} scrollRef={scrollRef} onBack={goBack} />
      <main className="screen mx-auto max-w-lg space-y-4 px-4 pt-2" style={{ paddingLeft: 'max(16px, var(--safe-left))', paddingRight: 'max(16px, var(--safe-right))' }}>
        {!ocrAvailable() && (
          <Card tone="warn" className="text-[14px] text-body">
            {t('Label reading needs the PillSeek app on a phone. On the web, add pills from their page instead.')}
          </Card>
        )}

        {phase === 'idle' && (
          <Card className="space-y-3">
            <p className="text-[15px] leading-relaxed text-body">
              {t('Photograph the printed label on your prescription bottle. We read the drug, strength, directions, quantity and Rx number, then set up the pill and its reminders for you.')}
            </p>
            <p className="text-[13px] text-muted">{t('The label wraps around the bottle, so keep the camera on it and slowly turn the bottle; fields tick off as they are read.')}</p>
            <div className="flex gap-2">
              <Button full icon={<CameraIcon size={18} />} onClick={() => void scan('camera')} disabled={!ocrAvailable()}>
                {t('Scan label')}
              </Button>
              <Button variant="secondary" icon={<ImagesIcon size={18} />} onClick={() => void scan('photos')} disabled={!ocrAvailable()}>
                {t('Library')}
              </Button>
            </div>
          </Card>
        )}

        {phase !== 'idle' && phase !== 'scanning' && (
          <div className="flex items-start gap-3">
            {preview && <img src={preview} alt={t('Label')} className="h-24 w-24 flex-none rounded-2xl object-cover" />}
            <div className="min-w-0 flex-1 space-y-1 text-[14px] text-body">
              {phase === 'reading' && <p>{t('Reading the label…')}</p>}
              {phase === 'matching' && <p>{t('Matching the drug…')}</p>}
              {(phase === 'review' || phase === 'saving') && (
                <>
                  <p>
                    {t('Read')} <span className="font-semibold text-ink">{lines.length}</span> {t('lines.')}
                  </p>
                  <button type="button" onClick={() => setShowRaw((v) => !v)} className="pressable text-[13px] font-medium text-brand">
                    {showRaw ? t('Hide what the camera read') : t('Show what the camera read')}
                  </button>
                  <button type="button" onClick={() => void scan('camera')} className="pressable block text-[13px] font-medium text-brand">
                    {t('Scan again')}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {showRaw && lines.length > 0 && (
          <Card className="max-h-56 overflow-y-auto text-[12px] leading-relaxed text-muted">
            {lines.map((l, i) => (
              <p key={i}>{l.text}</p>
            ))}
          </Card>
        )}

        {error && (
          <Card tone="danger" className="text-[14px] text-body">
            {error}
          </Card>
        )}

        {(phase === 'review' || phase === 'saving') && label && (
          <>
            <Card className="space-y-3">
              <div>
                <SectionLabel>{t('Medicine')}</SectionLabel>
                {drugs.length > 1 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {drugs.slice(0, 5).map((d) => (
                      <Chip key={d.key} selected={drug?.key === d.key} onClick={() => void chooseDrug(d, label.strength)}>
                        {d.name}
                      </Chip>
                    ))}
                  </div>
                )}
                {drug ? (
                  <p className="text-[17px] font-semibold text-ink">{drug.name}</p>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[14px] text-muted">
                      {label.drugName ? `${t('No match for “{name}”.', { name: label.drugName })} ` : ''}
                      {t('Type the medicine name and pick it:')}
                    </p>
                    <TextField label={t('Medicine name')} value={query} onChange={(v) => void search(v)} placeholder={t('e.g. Amoxicillin')} autoCapitalize="none" />
                    {suggestions.length > 0 && (
                      <div className="divide-y divide-line rounded-2xl hairline bg-surface">
                        {suggestions.slice(0, 6).map((d) => (
                          <button
                            key={d.key}
                            type="button"
                            onClick={() => {
                              setSuggestions([])
                              setDrugs([d])
                              void chooseDrug(d, label.strength)
                            }}
                            className="pressable flex w-full items-center gap-3 px-3 py-2.5 text-left"
                          >
                            <PillThumb src={d.image_url} alt="" size={36} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[15px] font-semibold text-ink">{d.name}</span>
                              <span className="block truncate text-[12px] text-muted">{d.strengths.slice(0, 4).join(' · ')}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {drug && drug.strengths.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {drug.strengths.map((s) => (
                      <Chip key={s} selected={strength === s} onClick={() => void chooseStrength(drug, s)}>
                        {s}
                      </Chip>
                    ))}
                  </div>
                )}
                {label.strength && !strength && drug && <p className="mt-1 text-[13px] text-muted">{t('Label says {strength}; pick the matching strength.', { strength: label.strength })}</p>}
              </div>

              {pills.length > 1 && (
                <div>
                  <SectionLabel>{t('Which pill is in the bottle?')}</SectionLabel>
                  <div className="divide-y divide-line">
                    {pills.slice(0, 8).map((p) => (
                      <button key={p.slug ?? p.imprint} type="button" onClick={() => setPill(p)} className={`pressable flex w-full items-center gap-3 py-2 text-left ${pill?.slug === p.slug ? 'text-brand' : ''}`}>
                        <PillThumb src={p.image_url ?? p.images[0] ?? null} alt="" size={44} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-semibold text-ink">{t('Imprint {imprint}', { imprint: p.imprint || '—' })}</span>
                          <span className="block truncate text-[13px] text-muted">{[p.color, p.shape, p.manufacturer].filter(Boolean).join(' · ')}</span>
                        </span>
                        {pill?.slug === p.slug && <CheckIcon size={18} />}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {pill && pills.length === 1 && (
                <div className="flex items-center gap-3">
                  <PillThumb src={pill.image_url ?? pill.images[0] ?? null} alt="" size={44} />
                  <span className="text-[14px] text-body">
                    {t('Imprint')} <span className="font-semibold text-ink">{pill.imprint || '—'}</span>
                    {pill.manufacturer ? ` · ${pill.manufacturer}` : ''}
                  </span>
                </div>
              )}
            </Card>

            <Card className="space-y-3">
              <div>
                <p className="mb-1 px-1 text-[13px] font-semibold text-body">{t('Directions')}</p>
                <TextField label={t('Directions')} value={directions} onChange={setDirections} placeholder="e.g. Take 1 tablet twice daily" />
              </div>

              <div>
                <p className="mb-1 px-1 text-[13px] font-semibold text-body">
                  {t('Reminder times')}
                  {schedule && schedule.times.length > 0 && !timesTouched && <span className="font-normal text-muted"> · {t('from the label')}</span>}
                </p>
                <div className="flex flex-wrap gap-2">
                  {PRESET_TIMES.map((p) => (
                    <Chip key={p.time} selected={times.includes(p.time)} onClick={() => toggleTime(p.time)}>
                      {t(p.label)} {fmt(p.time)}
                    </Chip>
                  ))}
                  {times
                    .filter((time) => !PRESET_TIMES.some((p) => p.time === time))
                    .map((time) => (
                      <Chip key={time} selected onClick={() => toggleTime(time)}>
                        {fmt(time)}
                      </Chip>
                    ))}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <label className="flex h-12 flex-1 items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-3 text-[15px] text-body">
                    <span>{t('Other time')}</span>
                    <input
                      type="time"
                      aria-label={t('Pick another time')}
                      value={picked}
                      onChange={(e) => setPicked(e.target.value)}
                      className="h-9 rounded-lg bg-transparent px-2 text-[17px] font-semibold text-brand"
                    />
                  </label>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!/^\d{2}:\d{2}$/.test(picked)}
                    onClick={() => {
                      if (!times.includes(picked)) setTimesByHand([...times, picked].sort())
                      setPicked('')
                    }}
                  >
                    {t('Add')}
                  </Button>
                </div>
                <p className="mt-1 px-1 text-[12px] text-muted">
                  {times.length === 0
                    ? schedule?.asNeeded
                      ? t('As needed: no reminder will be set.')
                      : t('No reminder will be set. Tap a time to add one.')
                    : t('Tap a time to remove it.')}
                </p>
              </div>

              {existingReminder && (
                <Card tone="warn" className="text-[14px] text-body">
                  <p>
                    {t('This pill already has a reminder at {times}.', { times: existingReminder.times.map(fmt).join(', ') })}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Chip selected={!replaceExisting} onClick={() => setReplaceExisting(false)}>
                      {t('Keep it')}
                    </Chip>
                    <Chip selected={replaceExisting} onClick={() => setReplaceExisting(true)}>
                      {t('Use these times')}
                    </Chip>
                  </div>
                </Card>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="mb-1 px-1 text-[13px] font-semibold text-body">{t('Quantity')}</p>
                  <TextField label={t('Quantity')} value={quantity} onChange={setQuantity} inputMode="numeric" placeholder={t('e.g. 30')} />
                </div>
                <div>
                  <p className="mb-1 px-1 text-[13px] font-semibold text-body">{t('Rx number')}</p>
                  <TextField label={t('Rx number')} value={rx} onChange={setRx} placeholder={t('e.g. 1234567')} />
                </div>
              </div>
              <div>
                <p className="mb-1 px-1 text-[13px] font-semibold text-body">{t('Pharmacy')}</p>
                <TextField label={t('Pharmacy')} value={pharmacy} onChange={setPharmacy} placeholder={t('e.g. CVS · 555-0100')} />
              </div>
              {(label.refills !== null || label.fillDate) && (
                <p className="flex flex-wrap gap-1.5">
                  {label.refills !== null && <TextBadge tone="neutral">{label.refills === 1 ? t('1 refill left') : t('{n} refills left', { n: label.refills })}</TextBadge>}
                  {label.fillDate && <TextBadge tone="neutral">{t('Filled {date}', { date: label.fillDate })}</TextBadge>}
                </p>
              )}
            </Card>

            <Button full loading={phase === 'saving'} disabled={!pill?.slug} icon={<CheckIcon size={18} />} onClick={() => void save()}>
              {pill?.slug ? t('Save to my cabinet') : t('Pick the pill to continue')}
            </Button>
            <Disclaimer compact />
          </>
        )}
      </main>
    </div>
  )
}
