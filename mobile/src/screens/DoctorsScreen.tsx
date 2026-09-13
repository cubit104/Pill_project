import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import Card, { SectionLabel } from '../components/Card'
import EmptyState from '../components/EmptyState'
import ErrorCard from '../components/ErrorCard'
import { ChevronRightIcon } from '../components/Icons'
import SegmentedControl from '../components/SegmentedControl'
import Sheet from '../components/Sheet'
import TextField from '../components/TextField'
import { ApiError } from '../lib/api'
import { useBackHandler } from '../lib/backstack'
import {
  FINDERS,
  SPECIALTIES,
  getPosition,
  isValidZip,
  loadDoctorPrefs,
  mapsUrl,
  nearestZipTo,
  nppesUrl,
  saveDoctorPrefs,
  searchDoctors,
  shareText,
  specialtyByKey,
  telUrl,
  type Doctor,
  type FinderKind,
  type Origin,
  type SearchMode,
  type Specialty,
} from '../lib/doctors'
import { formatMiles, loadZipTable, suggestCities, type CityHit, type ZipTable } from '../lib/geo'
import { useT } from '../lib/i18n'
import { hapticTick, hideKeyboard, isNative, openUrl, platform, shareTextNative } from '../lib/native'

/**
 * Find a doctor: specialty pulldown, then a ZIP, a city (live-filled) or the
 * phone's location. Results come from the official NPI registry, nearest
 * first, each with a call button, a map link and a detail sheet.
 */
export default function DoctorsScreen({ kind = 'doctors' }: { kind?: FinderKind }) {
  const t = useT()
  const navigate = useNavigate()
  const scrollRef = useRef<HTMLDivElement>(null)
  const finder = FINDERS[kind]
  const [table, setTable] = useState<ZipTable | null>(null)
  const [specialty, setSpecialty] = useState<Specialty>(finder.fixed ?? SPECIALTIES[0]!)
  const [mode, setMode] = useState<SearchMode>('zip')
  const [zip, setZip] = useState('')
  const [cityQuery, setCityQuery] = useState('')
  const [city, setCity] = useState<{ city: string; state: string } | null>(null)
  const [cityHits, setCityHits] = useState<CityHit[]>([])
  const [cityFocus, setCityFocus] = useState(false)
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [results, setResults] = useState<Doctor[] | null>(null)
  const [origin, setOrigin] = useState<Origin | null>(null)
  const [loading, setLoading] = useState(false)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState<ApiError | Error | null>(null)
  const [selected, setSelected] = useState<Doctor | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate('/home', { replace: true }))
  useBackHandler(true, goBack)

  // Bundled ZIP table (city live-fill, nearest ZIP, distances) and the last search.
  useEffect(() => {
    let cancelled = false
    void loadZipTable()
      .then((tb) => !cancelled && setTable(tb))
      .catch(() => {
        /* without the table we still search; just no live-fill or distances */
      })
    void loadDoctorPrefs(kind).then((p) => {
      if (cancelled) return
      setSpecialty(finder.fixed ?? specialtyByKey(p.specialty))
      setMode(p.mode)
      setZip(p.zip)
      if (p.city && p.state) {
        setCity({ city: p.city, state: p.state })
        setCityQuery(`${p.city}, ${p.state}`)
      }
      setPrefsLoaded(true)
    })
    return () => {
      cancelled = true
      abortRef.current?.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  const run = useCallback(
    async (sp: Specialty, m: SearchMode, z: string, c: { city: string; state: string } | null) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setLoading(true)
      setError(null)
      try {
        const res = await searchDoctors({ specialty: sp, mode: m, zip: z, city: c ?? undefined }, table, controller.signal)
        if (controller.signal.aborted) return
        setResults(res.doctors)
        setOrigin(res.origin)
        void saveDoctorPrefs({ specialty: sp.key, mode: m, zip: z, city: c?.city ?? '', state: c?.state ?? '' }, kind)
      } catch (err) {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err : new Error(String(err)))
        setResults(null)
        setOrigin(null)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    },
    [table, kind],
  )

  const canSearch = !loading && (mode === 'city' ? city !== null : isValidZip(zip))

  const submit = () => {
    if (!canSearch) return
    void hapticTick()
    void hideKeyboard()
    void run(specialty, mode, zip, city)
  }

  const changeSpecialty = (key: string) => {
    const sp = specialtyByKey(key)
    setSpecialty(sp)
    if (results && (mode === 'city' ? city !== null : isValidZip(zip))) void run(sp, mode, zip, city)
  }

  const changeMode = (m: SearchMode) => {
    void hapticTick()
    setMode(m)
    setResults(null)
    setOrigin(null)
    setError(null)
  }

  const typeCity = (v: string) => {
    setCityQuery(v)
    setCity(null)
    setCityHits(table ? suggestCities(table, v) : [])
  }

  const pickCity = (hit: CityHit) => {
    void hapticTick()
    const c = { city: hit.city, state: hit.state }
    setCity(c)
    setCityQuery(`${hit.city}, ${hit.state}`)
    setCityHits([])
    void hideKeyboard()
    void run(specialty, 'city', zip, c)
  }

  const useLocation = async () => {
    void hapticTick()
    setLocating(true)
    setError(null)
    try {
      const pos = await getPosition()
      const tb = table ?? (await loadZipTable())
      const z = nearestZipTo(tb, pos)
      if (!z) throw new ApiError('unknown', 'Could not match your location to a US ZIP code.', { retryable: false })
      setZip(z)
      await run(specialty, 'near', z, null)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      setLocating(false)
    }
  }

  const open = (url: string) => {
    void hapticTick()
    if (isNative()) window.open(url, '_system')
    else window.open(url, '_blank', 'noopener')
  }

  const share = (d: Doctor) => {
    void hapticTick()
    void shareTextNative(d.name, shareText(d))
  }

  const genderLabel = (g: Doctor['gender']) => (g === 'F' ? t('Female') : g === 'M' ? t('Male') : '')
  const originLabel = origin?.label ?? (mode === 'city' && city ? `${city.city}, ${city.state}` : zip)

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
        <p className="min-w-0 flex-1 truncate text-center text-[17px] font-semibold text-ink">{t(finder.title)}</p>
        <span className="w-11" aria-hidden />
      </div>

      <main className="screen mx-auto max-w-lg space-y-4 px-4 pb-8 pt-2" style={{ paddingLeft: 'max(16px, var(--safe-left))', paddingRight: 'max(16px, var(--safe-right))' }}>
        <div className="px-1">
          <h1 className="text-[26px] font-bold leading-tight tracking-tight text-ink">{t(finder.title)}</h1>
          <p className="mt-1 text-[15px] leading-relaxed text-muted">{t(finder.subtitle)}</p>
        </div>

        {/* Specialty pulldown (doctor list only; pharmacies and urgent care are one category) */}
        {!finder.fixed && (
        <label className="block">
          <span className="mb-1 block px-1 text-[13px] font-semibold uppercase tracking-wide text-muted">{t('Specialty')}</span>
          <div className="relative">
            <select
              value={specialty.key}
              onChange={(e) => changeSpecialty(e.target.value)}
              className="h-12 w-full appearance-none rounded-2xl border border-line bg-surface px-4 pr-11 text-[17px] text-ink focus:border-brand focus:outline-none"
            >
              {SPECIALTIES.map((sp) => (
                <option key={sp.key} value={sp.key}>
                  {t(sp.label)}
                </option>
              ))}
            </select>
            <ChevronRightIcon size={20} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 rotate-90 text-muted" />
          </div>
        </label>
        )}

        <SegmentedControl<SearchMode>
          label={t('Search by')}
          value={mode}
          onChange={changeMode}
          options={[
            { value: 'zip', label: t('ZIP') },
            { value: 'city', label: t('City') },
            { value: 'near', label: t('Near me') },
          ]}
        />

        {mode === 'zip' && (
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
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
                disabled={!prefsLoaded}
              />
            </div>
            <Button onClick={submit} disabled={!canSearch} loading={loading} size="md">
              {t('Search')}
            </Button>
          </div>
        )}

        {mode === 'city' && (
          <div className="relative">
            <TextField
              label={t('City')}
              value={cityQuery}
              onChange={typeCity}
              onClear={() => typeCity('')}
              onFocus={() => setCityFocus(true)}
              onBlur={() => window.setTimeout(() => setCityFocus(false), 150)}
              autoComplete="off"
              placeholder={t('Start typing, e.g. San Fr')}
              enterKeyHint="search"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && cityHits[0]) pickCity(cityHits[0])
              }}
              disabled={!prefsLoaded}
            />
            {cityFocus && cityHits.length > 0 && (
              <ul className="absolute left-0 right-0 z-10 mt-1 overflow-hidden rounded-2xl border border-line bg-surface shadow-lg">
                {cityHits.map((h) => (
                  <li key={`${h.city}|${h.state}`}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickCity(h)}
                      className="pressable flex w-full items-center justify-between px-4 py-3 text-left text-[16px] text-ink"
                    >
                      <span>
                        {h.city}, {h.state}
                      </span>
                      <span className="text-[13px] text-muted">{t('{n} ZIPs', { n: h.zips.length })}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!table && <p className="mt-1 px-1 text-[13px] text-muted">{t('Loading city list…')}</p>}
          </div>
        )}

        {mode === 'near' && (
          <div className="space-y-2">
            <Button onClick={() => void useLocation()} loading={locating || loading} disabled={locating || loading} full size="md">
              {t('Use my location')}
            </Button>
            <p className="px-1 text-[13px] text-muted">{t('Your location is used once to find the nearest ZIP code and is not stored.')}</p>
          </div>
        )}

        {error && <ErrorCard error={error} onRetry={() => (mode === 'near' ? void useLocation() : submit())} />}

        {results && results.length === 0 && !loading && (
          <EmptyState
            title={t('No {specialty} found near {place}', { specialty: t(specialty.label).toLowerCase(), place: originLabel })}
            body={t('Try a neighbouring ZIP code, a nearby city or another specialty.')}
          />
        )}

        {results && results.length > 0 && (
          <section className="space-y-2">
            <SectionLabel>
              {mode === 'near'
                ? t('{n} results near you', { n: results.length })
                : t('{n} results near {place}', { n: results.length, place: originLabel })}
            </SectionLabel>
            {results.map((d) => (
              <Card key={d.npi} padded={false} className="overflow-hidden">
                <button type="button" onClick={() => { void hapticTick(); setSelected(d) }} className="pressable block w-full px-4 pt-3 text-left" aria-label={t('{name}, details', { name: d.name })}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 text-[17px] font-semibold leading-snug text-ink">
                      {d.name}
                      {d.credential && <span className="ml-1 text-[14px] font-normal text-muted">{d.credential}</span>}
                    </p>
                    {d.distanceMiles !== null && (
                      <span className="shrink-0 rounded-full bg-brand-tint px-2 py-0.5 text-[12px] font-semibold text-brand">{formatMiles(d.distanceMiles)}</span>
                    )}
                  </div>
                  {d.specialty && <p className="mt-0.5 text-[14px] text-muted">{d.specialty}</p>}
                  <p className="mt-1 text-[15px] text-ink">
                    {d.address}
                    <br />
                    {d.city}, {d.state} {d.zip}
                  </p>
                </button>
                <div className="flex flex-wrap gap-2 px-4 pb-3 pt-2">
                  {d.phone && (
                    <Button variant="secondary" size="sm" onClick={() => open(telUrl(d.phone))}>
                      {t('Call')}
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => open(mapsUrl(d, platform()))}>
                    {t('Map')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { void hapticTick(); setSelected(d) }}>
                    {t('Details')}
                  </Button>
                </div>
              </Card>
            ))}
            <p className="px-1 pt-2 text-[12px] leading-relaxed text-muted">
              {t('Listings come from the NPPES NPI Registry (CMS) and may be out of date. Call ahead to confirm they are accepting patients. ZIP data © GeoNames (CC BY 4.0).')}
            </p>
          </section>
        )}
      </main>

      <Sheet open={selected !== null} onClose={() => setSelected(null)} title={selected?.name ?? ''}>
        {selected && (
          <div className="space-y-4 pb-4">
            <div>
              <p className="text-[17px] font-semibold text-ink">
                {selected.name}
                {selected.credential && <span className="ml-1 text-[15px] font-normal text-muted">{selected.credential}</span>}
              </p>
              <p className="text-[14px] text-muted">
                {[selected.organisation ? t('Organisation') : genderLabel(selected.gender), selected.since && t('In the registry since {year}', { year: selected.since })]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {selected.distanceMiles !== null && <p className="text-[14px] text-brand">{t('{distance} from your search', { distance: formatMiles(selected.distanceMiles) })}</p>}
            </div>

            <div>
              <SectionLabel>{t('Specialties')}</SectionLabel>
              <ul className="mt-1 space-y-1">
                {selected.taxonomies.map((tx, i) => (
                  <li key={i} className="text-[15px] text-ink">
                    {tx.desc}
                    {tx.primary && <span className="ml-1 rounded-full bg-brand-tint px-1.5 text-[11px] font-semibold text-brand">{t('Primary')}</span>}
                    {(tx.state || tx.license) && (
                      <span className="block text-[13px] text-muted">
                        {[tx.state && t('Licensed in {state}', { state: tx.state }), tx.license && `#${tx.license}`].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </li>
                ))}
                {selected.taxonomies.length === 0 && <li className="text-[15px] text-muted">{t('Not listed')}</li>}
              </ul>
            </div>

            <div>
              <SectionLabel>{t('Practice address')}</SectionLabel>
              <p className="mt-1 text-[15px] text-ink">
                {selected.address}
                <br />
                {selected.city}, {selected.state} {selected.zip}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {selected.phone && (
                  <Button variant="primary" size="sm" onClick={() => open(telUrl(selected.phone))}>
                    {t('Call {phone}', { phone: selected.phone })}
                  </Button>
                )}
                <Button variant="secondary" size="sm" onClick={() => open(mapsUrl(selected, platform()))}>
                  {t('Open in Maps')}
                </Button>
              </div>
            </div>

            {selected.mailing && (
              <div>
                <SectionLabel>{t('Mailing address')}</SectionLabel>
                <p className="mt-1 text-[15px] text-ink">
                  {selected.mailing.address}
                  <br />
                  {selected.mailing.city}, {selected.mailing.state} {selected.mailing.zip}
                </p>
              </div>
            )}

            <div>
              <SectionLabel>{t('Registry')}</SectionLabel>
              <p className="mt-1 text-[15px] text-ink">NPI {selected.npi}</p>
              <div className="mt-1 flex flex-wrap gap-2">
                <Button variant="ghost" size="sm" onClick={() => { void hapticTick(); void openUrl(nppesUrl(selected.npi)) }}>
                  {t('View on NPPES')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => share(selected)}>
                  {t('Share')}
                </Button>
              </div>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  )
}
