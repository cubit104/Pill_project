import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import Card, { SectionLabel } from '../components/Card'
import Chip from '../components/Chip'
import Disclaimer from '../components/Disclaimer'
import { CameraIcon, CheckIcon, ImagesIcon } from '../components/Icons'
import { PillThumb, TextBadge } from '../components/PillRow'
import ScreenHeader from '../components/ScreenHeader'
import TextField from '../components/TextField'
import { useToast } from '../components/Toast'
import { useAccount } from '../lib/account'
import { getDrugPills, lookupDrugs, type DrugRow, type SearchResult } from '../lib/api'
import { useBackHandler } from '../lib/backstack'
import { takeSystemPhoto } from '../lib/camera'
import { parseLabel, scheduleFromSig, type OcrLine, type ParsedLabel, type SigSchedule } from '../lib/labelParse'
import { hapticNotify, hapticTick } from '../lib/native'
import { blobToBase64, ocrAvailable, recognizeText } from '../lib/ocr'

type Phase = 'idle' | 'reading' | 'matching' | 'review' | 'saving'

function normStrength(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/\s+/g, '').replace(/,/g, '.')
}

/**
 * Scan a pharmacy bottle: photo → on-device OCR → parsed label → matched pill →
 * one tap saves the pill, its reminder schedule, refill count, Rx and pharmacy.
 */
export default function BottleScanScreen() {
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
  const [error, setError] = useState<string | null>(null)

  const schedule: SigSchedule | null = useMemo(() => scheduleFromSig(directions), [directions])

  const scan = async (source: 'camera' | 'photos') => {
    void hapticTick()
    setError(null)
    const photo = await takeSystemPhoto(source)
    if (!photo) return
    setPreview(photo.previewUrl)
    setPhase('reading')
    try {
      const found = await recognizeText(await blobToBase64(photo.blob))
      setLines(found)
      const parsed = parseLabel(found)
      setLabel(parsed)
      setDirections(parsed.directions ?? '')
      setQuantity(parsed.quantity ? String(parsed.quantity) : '')
      setRx(parsed.rxNumber ?? '')
      setPharmacy([parsed.pharmacyName, parsed.pharmacyPhone].filter(Boolean).join(' · '))
      if (!parsed.drugName) {
        setPhase('review')
        setError('Could not find a drug name on the label. Aim at the part with the drug name and directions, then try again.')
        return
      }
      setPhase('matching')
      const res = await lookupDrugs(parsed.drugName)
      setDrugs(res.results)
      const best = res.results[0] ?? null
      if (best) await chooseDrug(best, parsed.strength)
      setPhase('review')
    } catch (err) {
      setPhase('review')
      setError(err instanceof Error ? err.message : 'Could not read the label')
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
      const notes = [rx ? `Rx #${rx}` : null, pharmacy || null, label?.prescriber ? `Dr. ${label.prescriber}` : null, directions || null].filter(Boolean).join('\n')
      await account.update(item.id, {
        ...(Number.isFinite(qty) && qty > 0 ? { pills_on_hand: qty, fill_quantity: qty, pills_counted_at: new Date().toISOString(), pills_per_day: schedule?.pillsPerDay ?? null } : {}),
        ...(notes ? { notes } : {}),
      })
      if (schedule && schedule.times.length > 0) {
        await account.upsertReminder({
          cabinet_item_id: item.id,
          times: schedule.times,
          days: schedule.days,
          dose: schedule.dose,
          enabled: true,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
        })
      }
      void hapticNotify('success')
      toast.show(schedule?.times.length ? 'Saved with reminders' : 'Saved to your cabinet', 'success')
      navigate('/cabinet', { replace: true })
    } catch (err) {
      setPhase('review')
      toast.show(err instanceof Error ? err.message : 'Could not save', 'error')
    }
  }

  const fmt = (t: string) => {
    const [h, m] = t.split(':').map((x) => parseInt(x, 10))
    return new Date(2000, 0, 1, h ?? 0, m ?? 0).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-canvas">
      <ScreenHeader title="Scan a bottle" subtitle="Pharmacy label → cabinet" scrollRef={scrollRef} onBack={goBack} />
      <main className="screen mx-auto max-w-lg space-y-4 px-4 pt-2" style={{ paddingLeft: 'max(16px, var(--safe-left))', paddingRight: 'max(16px, var(--safe-right))' }}>
        {!ocrAvailable() && (
          <Card tone="warn" className="text-[14px] text-body">
            Label reading needs the iPhone build of PillSeek. On other devices, add pills from their page instead.
          </Card>
        )}

        {phase === 'idle' && (
          <Card className="space-y-3">
            <p className="text-[15px] leading-relaxed text-body">
              Photograph the printed label on your prescription bottle. We read the drug, strength, directions, quantity and Rx number, then set up the pill and its reminders for you.
            </p>
            <p className="text-[13px] text-muted">Tip: fill the frame with the part that shows the drug name and “Take …” line.</p>
            <div className="flex gap-2">
              <Button full icon={<CameraIcon size={18} />} onClick={() => void scan('camera')} disabled={!ocrAvailable()}>
                Take photo
              </Button>
              <Button variant="secondary" icon={<ImagesIcon size={18} />} onClick={() => void scan('photos')} disabled={!ocrAvailable()}>
                Library
              </Button>
            </div>
          </Card>
        )}

        {preview && phase !== 'idle' && (
          <div className="flex items-start gap-3">
            <img src={preview} alt="Label" className="h-24 w-24 flex-none rounded-2xl object-cover" />
            <div className="min-w-0 flex-1 space-y-1 text-[14px] text-body">
              {phase === 'reading' && <p>Reading the label…</p>}
              {phase === 'matching' && <p>Matching the drug…</p>}
              {(phase === 'review' || phase === 'saving') && (
                <>
                  <p>
                    Read <span className="font-semibold text-ink">{lines.length}</span> lines.
                  </p>
                  <button type="button" onClick={() => setShowRaw((v) => !v)} className="pressable text-[13px] font-medium text-brand">
                    {showRaw ? 'Hide' : 'Show'} what the camera read
                  </button>
                  <button type="button" onClick={() => void scan('camera')} className="pressable block text-[13px] font-medium text-brand">
                    Scan again
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
                <SectionLabel>Medicine</SectionLabel>
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
                  <p className="text-[14px] text-muted">No match for “{label.drugName}”. Scan again or add the pill from Search.</p>
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
                {label.strength && !strength && drug && <p className="mt-1 text-[13px] text-muted">Label says {label.strength}; pick the matching strength.</p>}
              </div>

              {pills.length > 1 && (
                <div>
                  <SectionLabel>Which pill is in the bottle?</SectionLabel>
                  <div className="divide-y divide-line">
                    {pills.slice(0, 8).map((p) => (
                      <button key={p.slug ?? p.imprint} type="button" onClick={() => setPill(p)} className={`pressable flex w-full items-center gap-3 py-2 text-left ${pill?.slug === p.slug ? 'text-brand' : ''}`}>
                        <PillThumb src={p.image_url ?? p.images[0] ?? null} alt="" size={44} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-semibold text-ink">Imprint {p.imprint || '—'}</span>
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
                    Imprint <span className="font-semibold text-ink">{pill.imprint || '—'}</span>
                    {pill.manufacturer ? ` · ${pill.manufacturer}` : ''}
                  </span>
                </div>
              )}
            </Card>

            <Card className="space-y-3">
              <div>
                <p className="mb-1 px-1 text-[13px] font-semibold text-body">Directions</p>
                <TextField label="Directions" value={directions} onChange={setDirections} placeholder="e.g. Take 1 tablet twice daily" />
                <p className="mt-1 px-1 text-[13px] text-muted">
                  {schedule && schedule.times.length > 0
                    ? `Reminder: ${schedule.dose ?? 'dose'} at ${schedule.times.map(fmt).join(', ')}${schedule.days.length === 7 ? ', every day' : ''}`
                    : schedule?.asNeeded
                      ? 'As needed: no reminder will be set.'
                      : 'No reminder yet. You can add one in the cabinet.'}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="mb-1 px-1 text-[13px] font-semibold text-body">Quantity</p>
                  <TextField label="Quantity" value={quantity} onChange={setQuantity} inputMode="numeric" placeholder="e.g. 30" />
                </div>
                <div>
                  <p className="mb-1 px-1 text-[13px] font-semibold text-body">Rx number</p>
                  <TextField label="Rx number" value={rx} onChange={setRx} placeholder="e.g. 1234567" />
                </div>
              </div>
              <div>
                <p className="mb-1 px-1 text-[13px] font-semibold text-body">Pharmacy</p>
                <TextField label="Pharmacy" value={pharmacy} onChange={setPharmacy} placeholder="e.g. CVS · 555-0100" />
              </div>
              {(label.refills !== null || label.fillDate) && (
                <p className="flex flex-wrap gap-1.5">
                  {label.refills !== null && <TextBadge tone="neutral">{label.refills} refill{label.refills === 1 ? '' : 's'} left</TextBadge>}
                  {label.fillDate && <TextBadge tone="neutral">Filled {label.fillDate}</TextBadge>}
                </p>
              )}
            </Card>

            <Button full loading={phase === 'saving'} disabled={!pill?.slug} icon={<CheckIcon size={18} />} onClick={() => void save()}>
              {pill?.slug ? 'Save to my cabinet' : 'Pick the pill to continue'}
            </Button>
            <Disclaimer compact />
          </>
        )}
      </main>
    </div>
  )
}
