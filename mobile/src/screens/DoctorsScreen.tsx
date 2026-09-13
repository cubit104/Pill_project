import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import Card, { SectionLabel } from '../components/Card'
import Chip, { ChipRow } from '../components/Chip'
import EmptyState from '../components/EmptyState'
import ErrorCard from '../components/ErrorCard'
import { ChevronRightIcon } from '../components/Icons'
import TextField from '../components/TextField'
import { ApiError } from '../lib/api'
import { useBackHandler } from '../lib/backstack'
import { SPECIALTIES, isValidZip, loadDoctorZip, mapsUrl, saveDoctorZip, searchDoctors, telUrl, type Doctor, type Specialty } from '../lib/doctors'
import { useT } from '../lib/i18n'
import { hapticTick, hideKeyboard, isNative, platform } from '../lib/native'

/**
 * Find a doctor: pick a specialty, enter a ZIP, get the official NPI registry's
 * list of clinicians there with a call button and a map link.
 */
export default function DoctorsScreen() {
  const t = useT()
  const navigate = useNavigate()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [specialty, setSpecialty] = useState<Specialty>(SPECIALTIES[0]!)
  const [zip, setZip] = useState('')
  const [zipLoaded, setZipLoaded] = useState(false)
  const [results, setResults] = useState<Doctor[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<ApiError | Error | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate('/home', { replace: true }))
  useBackHandler(true, goBack)

  useEffect(() => {
    let cancelled = false
    void loadDoctorZip().then((z) => {
      if (cancelled) return
      setZip(z)
      setZipLoaded(true)
    })
    return () => {
      cancelled = true
      abortRef.current?.abort()
    }
  }, [])

  const run = useCallback(
    async (sp: Specialty, z: string) => {
      if (!isValidZip(z)) return
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setLoading(true)
      setError(null)
      try {
        const rows = await searchDoctors({ specialty: sp, zip: z.trim() }, controller.signal)
        if (controller.signal.aborted) return
        setResults(rows)
        void saveDoctorZip(z.trim())
      } catch (err) {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err : new Error(String(err)))
        setResults(null)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    },
    [],
  )

  const submit = () => {
    void hapticTick()
    void hideKeyboard()
    void run(specialty, zip)
  }

  const pickSpecialty = (sp: Specialty) => {
    void hapticTick()
    setSpecialty(sp)
    if (isValidZip(zip)) void run(sp, zip)
  }

  const open = (url: string) => {
    void hapticTick()
    if (isNative()) window.open(url, '_system')
    else window.open(url, '_blank', 'noopener')
  }

  const canSearch = isValidZip(zip) && !loading

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-canvas animate-fade-up">
      <div
        className="sticky top-0 z-20 flex items-center gap-2 bg-[color-mix(in_srgb,var(--canvas)_95%,transparent)] px-2 pb-2 backdrop-blur"
        style={{ paddingTop: 'calc(var(--safe-top) + 6px)', paddingLeft: 'max(8px, var(--safe-left))', paddingRight: 'max(8px, var(--safe-right))' }}
      >
        <button type="button" onClick={goBack} aria-label={t('Back')} className="pressable flex h-11 min-w-[44px] items-center gap-0.5 rounded-full px-2 text-[17px] font-medium text-brand">
          <ChevronRightIcon size={22} className="rotate-180" />
          {t('Back')}
        </button>
        <p className="min-w-0 flex-1 truncate text-center text-[17px] font-semibold text-ink">{t('Find a doctor')}</p>
        <span className="w-11" aria-hidden />
      </div>

      <main className="screen mx-auto max-w-lg space-y-4 px-4 pb-8 pt-2" style={{ paddingLeft: 'max(16px, var(--safe-left))', paddingRight: 'max(16px, var(--safe-right))' }}>
        <div className="px-1">
          <h1 className="text-[26px] font-bold leading-tight tracking-tight text-ink">{t('Find a doctor')}</h1>
          <p className="mt-1 text-[15px] leading-relaxed text-muted">
            {t('Clinicians and pharmacies near a ZIP code, from the official US provider registry.')}
          </p>
        </div>

        <ChipRow label={t('Specialty')}>
          {SPECIALTIES.map((sp) => (
            <Chip key={sp.key} selected={sp.key === specialty.key} onClick={() => pickSpecialty(sp)}>
              {t(sp.label)}
            </Chip>
          ))}
        </ChipRow>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <TextField
              label={t('ZIP code')}
              value={zip}
              onChange={(v) => setZip(v.replace(/\D/g, '').slice(0, 5))}
              onClear={() => setZip('')}
              inputMode="numeric"
              autoComplete="postal-code"
              placeholder={t('e.g. 94107')}
              enterKeyHint="search"
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
              disabled={!zipLoaded}
            />
          </div>
          <Button onClick={submit} disabled={!canSearch} loading={loading} size="md">
            {t('Search')}
          </Button>
        </div>

        {error && <ErrorCard error={error} onRetry={() => void run(specialty, zip)} />}

        {results && results.length === 0 && !loading && (
          <EmptyState
            title={t('No {specialty} found in {zip}', { specialty: t(specialty.label).toLowerCase(), zip: zip.trim() })}
            body={t('Try a neighbouring ZIP code or another specialty.')}
          />
        )}

        {results && results.length > 0 && (
          <section className="space-y-2">
            <SectionLabel>{t('{n} results near {zip}', { n: results.length, zip: zip.trim() })}</SectionLabel>
            {results.map((d) => (
              <Card key={d.npi} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="min-w-0 truncate text-[17px] font-semibold text-ink">
                    {d.name}
                    {d.credential && <span className="ml-1 text-[14px] font-normal text-muted">{d.credential}</span>}
                  </p>
                </div>
                {d.specialty && <p className="text-[14px] text-muted">{d.specialty}</p>}
                <p className="text-[15px] text-ink">
                  {d.address}
                  <br />
                  {d.city}, {d.state} {d.zip}
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {d.phone && (
                    <Button variant="secondary" size="sm" onClick={() => open(telUrl(d.phone))}>
                      {t('Call {phone}', { phone: d.phone })}
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => open(mapsUrl(d, platform()))}>
                    {t('Open in Maps')}
                  </Button>
                </div>
              </Card>
            ))}
            <p className="px-1 pt-2 text-[12px] leading-relaxed text-muted">
              {t('Listings come from the NPPES NPI Registry (CMS) and may be out of date. Call ahead to confirm they are accepting patients.')}
            </p>
          </section>
        )}
      </main>
    </div>
  )
}
