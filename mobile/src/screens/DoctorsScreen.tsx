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
  providerDetails,
  providerExtras,
  saveDoctorPrefs,
  nameParams,
  searchDoctors,
  shareText,
  specialtyByKey,
  telUrl,
  todaysHours,
  websiteLabel,
  type CmsDetails,
  type Doctor,
  type DoctorSearch,
  type FinderKind,
  type GoogleDetails,
  type GoogleSummary,
  type Origin,
  type ProviderDetails,
  type SearchMode,
  type Specialty,
} from '../lib/doctors'
import { US_STATES, formatMiles, loadZipTable, suggestCities, type CityHit, type ZipTable } from '../lib/geo'
import { useT } from '../lib/i18n'
import { hapticTick, hideKeyboard, isNative, platform, shareTextNative } from '../lib/native'

/**
 * Find a doctor: specialty pulldown, then a ZIP, a city (live-filled), the
 * phone's location or a name. Results come from PillSeek's finder (the official
 * NPI registry, nearest first), each with a call button, a map link, Google's
 * rating and hours when known, and a detail sheet that adds the CMS facts
 * (school, years, hospitals, Medicare, telehealth) and the website.
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
  const [lastName, setLastName] = useState('')
  const [firstName, setFirstName] = useState('')
  const [nameState, setNameState] = useState('')
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [results, setResults] = useState<Doctor[] | null>(null)
  const [origin, setOrigin] = useState<Origin | null>(null)
  const [loading, setLoading] = useState(false)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState<ApiError | Error | null>(null)
  const [selected, setSelected] = useState<Doctor | null>(null)
  const [details, setDetails] = useState<ProviderDetails | null>(null)
  const [extras, setExtras] = useState<{ cms: CmsDetails | null; google: GoogleDetails | null } | null>(null)
  const [extrasLoading, setExtrasLoading] = useState(false)
  const [detailsError, setDetailsError] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const detailAbort = useRef<AbortController | null>(null)

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
      detailAbort.current?.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  const run = useCallback(
    async (
      sp: Specialty,
      m: SearchMode,
      z: string,
      c: { city: string; state: string } | null,
      n?: { last: string; first: string; state: string },
      pos?: { lat: number; lon: number },
    ) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setLoading(true)
      setError(null)
      try {
        const search: DoctorSearch = { specialty: sp, mode: m, zip: z, city: c ?? undefined, name: n, position: pos }
        const res = await searchDoctors(kind, search, controller.signal)
        if (controller.signal.aborted) return
        setResults(res.doctors)
        setOrigin(res.origin)
        // "Near me" is anchored to the nearest ZIP by the backend; remember that one like a typed ZIP.
        const savedZip = m === 'near' && res.origin?.zip ? res.origin.zip : z
        if (m === 'near' && res.origin?.zip) setZip(res.origin.zip)
        void saveDoctorPrefs({ specialty: sp.key, mode: m, zip: savedZip, city: c?.city ?? '', state: c?.state ?? '' }, kind)
      } catch (err) {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err : new Error(String(err)))
        setResults(null)
        setOrigin(null)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    },
    [kind],
  )

  const nameQuery = { last: lastName, first: firstName, state: nameState }
  const canSearch = !loading && (mode === 'city' ? city !== null : mode === 'name' ? nameParams(nameQuery) !== null : isValidZip(zip))

  const submit = () => {
    if (!canSearch) return
    void hapticTick()
    void hideKeyboard()
    void run(specialty, mode, zip, city, mode === 'name' ? nameQuery : undefined)
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
      await run(specialty, 'near', zip, null, undefined, pos)
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

  /** Open the sheet at once with the registry record, then fill in the CMS and Google details as they arrive. */
  const openDetails = (d: Doctor) => {
    void hapticTick()
    detailAbort.current?.abort()
    const controller = new AbortController()
    detailAbort.current = controller
    setSelected(d)
    setDetails(null)
    setExtras(null)
    setDetailsError(false)
    setExtrasLoading(true)
    void (async () => {
      try {
        const det = await providerDetails(d.npi, controller.signal)
        if (controller.signal.aborted) return
        setDetails(det)
        if (det.extras_pending) {
          const ex = await providerExtras(d.npi, controller.signal)
          if (controller.signal.aborted) return
          setExtras(ex)
        }
      } catch {
        if (!controller.signal.aborted) setDetailsError(true)
      } finally {
        if (!controller.signal.aborted) setExtrasLoading(false)
      }
    })()
  }

  const closeDetails = () => {
    detailAbort.current?.abort()
    setSelected(null)
  }

  // What the sheet shows: the slow fetch wins over the fast one, which wins over the card's summary.
  const cms = extras?.cms ?? details?.cms ?? null
  const google: (GoogleSummary & Partial<GoogleDetails>) | null = extras?.google ?? details?.google ?? selected?.google ?? null
  const phone = selected ? selected.phone || google?.phone || '' : ''
  const todayIndex = (new Date().getDay() + 6) % 7
  const pending = extrasLoading && !detailsError

  const genderLabel = (g: Doctor['gender']) => (g === 'F' ? t('Female') : g === 'M' ? t('Male') : '')
  const originLabel = origin?.label ?? (mode === 'city' && city ? `${city.city}, ${city.state}` : zip)
  const nameLabel = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ')

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

        {/* Specialty pulldown (doctor list only; pharmacies and urgent care are one category; name search is any specialty) */}
        {!finder.fixed && mode !== 'name' && (
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
            ...(finder.fixed ? [] : [{ value: 'name' as const, label: t('By name') }]),
          ]}
        />

        {mode === 'name' && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <TextField
                  label={t('Last name')}
                  value={lastName}
                  onChange={setLastName}
                  onClear={() => setLastName('')}
                  autoCapitalize="words"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={t('Last name')}
                  enterKeyHint="search"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submit()
                  }}
                />
              </div>
              <div className="min-w-0 flex-1">
                <TextField
                  label={t('First name (optional)')}
                  value={firstName}
                  onChange={setFirstName}
                  onClear={() => setFirstName('')}
                  autoCapitalize="words"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={t('First name (optional)')}
                  enterKeyHint="search"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submit()
                  }}
                />
              </div>
            </div>
            <div className="flex items-end gap-2">
              <label className="block min-w-0 flex-1">
                <span className="mb-1 block px-1 text-[13px] font-semibold uppercase tracking-wide text-muted">{t('State')}</span>
                <div className="relative">
                  <select
                    value={nameState}
                    onChange={(e) => setNameState(e.target.value)}
                    className="h-12 w-full appearance-none rounded-2xl border border-line bg-surface px-4 pr-11 text-[17px] text-ink focus:border-brand focus:outline-none"
                  >
                    <option value="">{t('Any state')}</option>
                    {US_STATES.map(([code, name]) => (
                      <option key={code} value={code}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <ChevronRightIcon size={20} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 rotate-90 text-muted" />
                </div>
              </label>
              <Button onClick={submit} disabled={!canSearch} loading={loading} size="md">
                {t('Search')}
              </Button>
            </div>
          </div>
        )}

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
            title={
              mode === 'name'
                ? t('No providers named {name}', { name: nameLabel })
                : t('No {specialty} found near {place}', { specialty: t(specialty.label).toLowerCase(), place: originLabel })
            }
            body={mode === 'name' ? t('Check the spelling, or add the state to narrow it down.') : t('Try a neighbouring ZIP code, a nearby city or another specialty.')}
          />
        )}

        {results && results.length > 0 && (
          <section className="space-y-2">
            <SectionLabel>
              {mode === 'name'
                ? t('{n} providers named {name}', { n: results.length, name: nameLabel })
                : mode === 'near'
                  ? t('{n} results near you', { n: results.length })
                  : t('{n} results near {place}', { n: results.length, place: originLabel })}
            </SectionLabel>
            {results.map((d) => (
              <Card key={d.npi} padded={false} className="overflow-hidden">
                <button type="button" onClick={() => openDetails(d)} className="pressable block w-full px-4 pt-3 text-left" aria-label={t('{name}, details', { name: d.name })}>
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
                  <GoogleLine g={d.google} />
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
                  {d.google?.website && (
                    <Button variant="ghost" size="sm" onClick={() => open(d.google!.website)}>
                      {t('Website')}
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => openDetails(d)}>
                    {t('Details')}
                  </Button>
                </div>
              </Card>
            ))}
            <p className="px-1 pt-2 text-[12px] leading-relaxed text-muted">
              {t('Listings come from the NPPES NPI Registry (CMS) and may be out of date. Call ahead to confirm they are accepting patients. ZIP data © GeoNames (CC BY 4.0).')}{' '}
              {t('Ratings and hours: Google.')}
            </p>
          </section>
        )}
      </main>

      <Sheet open={selected !== null} onClose={closeDetails} title={selected?.name ?? ''}>
        {selected && (
          <div className="space-y-3 pb-2">
            {/* Who: specialty, credential, rating, open/closed, distance */}
            <div>
              <p className="text-[15px] text-ink">
                {selected.specialty || selected.taxonomies[0]?.desc || (selected.organisation ? t('Organisation') : '')}
                {selected.credential && <span className="text-muted"> · {selected.credential}</span>}
              </p>
              <p className="mt-0.5 text-[13px] text-muted">
                {[selected.organisation ? t('Organisation') : genderLabel(selected.gender), selected.since && t('In the registry since {year}', { year: selected.since })]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {google && google.rating !== null && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[14px] font-semibold text-amber-800">
                    <span aria-hidden>★</span> {google.rating.toFixed(1)}
                    <span className="font-normal text-amber-700/80">({google.ratings_count ?? 0})</span>
                  </span>
                )}
                {google?.open_now === true && <span className="rounded-full bg-brand-tint px-2.5 py-1 text-[13px] font-semibold text-brand">{t('Open now')}</span>}
                {google?.open_now === false && <span className="rounded-full bg-line/60 px-2.5 py-1 text-[13px] font-semibold text-muted">{t('Closed now')}</span>}
                {selected.distanceMiles !== null && <span className="text-[13px] text-muted">{t('{distance} from your search', { distance: formatMiles(selected.distanceMiles) })}</span>}
              </div>
            </div>

            {/* Actions */}
            <div className={`grid gap-2 ${google?.website ? 'grid-cols-3' : 'grid-cols-2'}`}>
              <Button variant="primary" size="md" full disabled={!phone} onClick={() => phone && open(telUrl(phone))}>
                {t('Call')}
              </Button>
              <Button variant="secondary" size="md" full onClick={() => open(mapsUrl(selected, platform()))}>
                {t('Get directions')}
              </Button>
              {google?.website && (
                <Button variant="secondary" size="md" full onClick={() => open(google.website)}>
                  {t('Website')}
                </Button>
              )}
            </div>
            {detailsError && <p className="px-1 text-[13px] text-muted">{t('Extra details are not available right now.')}</p>}

            {/* Hours */}
            {(google?.hours.length || pending) && (
              <Card>
                <SectionLabel className="!px-0">{t('Hours')}</SectionLabel>
                {google?.hours.length ? (
                  <ul className="space-y-1">
                    {google.hours.map((line, i) => {
                      const [day, ...rest] = line.split(':')
                      const today = i === todayIndex
                      return (
                        <li key={i} className={`flex justify-between gap-3 text-[14px] ${today ? 'font-semibold text-ink' : 'text-muted'}`}>
                          <span>{t(day ?? '')}</span>
                          <span className={`text-right ${today && google.open_now ? 'text-brand' : ''}`}>{rest.join(':').trim()}</span>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <Shimmer />
                )}
              </Card>
            )}

            {/* CMS facts, clinicians only */}
            {!selected.organisation && (
              <Card>
                <SectionLabel className="!px-0">{t('Practice details')}</SectionLabel>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <DetailRow label={t('Medical school')} wide>{cms ? cms.medical_school || t('Not listed') : pending ? <Shimmer /> : '—'}</DetailRow>
                  <DetailRow label={t('In practice')}>{cms ? (cms.years_in_practice !== null ? t('{n} years', { n: cms.years_in_practice }) : t('Not listed')) : pending ? <Shimmer /> : '—'}</DetailRow>
                  <DetailRow label={t('Accepts')}>
                    {cms ? [cms.medicare ? t('Medicare') : null, cms.telehealth ? t('Telehealth visits') : null].filter(Boolean).join(' · ') || t('Not listed') : pending ? <Shimmer /> : '—'}
                  </DetailRow>
                  <DetailRow label={t('Group practice')} wide>{cms ? cms.group_name || t('Independent') : pending ? <Shimmer /> : '—'}</DetailRow>
                  <DetailRow label={t('Hospital affiliation')} wide>{cms ? cms.hospitals.join(', ') || t('None listed') : pending ? <Shimmer /> : '—'}</DetailRow>
                </dl>
              </Card>
            )}

            {/* Where */}
            <Card>
              <SectionLabel className="!px-0">{t('Practice address')}</SectionLabel>
              <p className="text-[15px] text-ink">
                {selected.address}
                <br />
                {selected.city}, {selected.state} {selected.zip}
              </p>
              {phone && <p className="mt-1 text-[14px] text-muted">{phone}</p>}
              {google?.website && <p className="mt-0.5 text-[14px] text-brand">{websiteLabel(google.website)}</p>}
            </Card>

            {/* Registry record */}
            <Card>
              <SectionLabel className="!px-0">{t('Specialties')}</SectionLabel>
              <ul className="space-y-1">
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
              <div className="mt-2 flex items-center justify-between">
                <p className="text-[13px] text-muted">NPI {selected.npi}</p>
                <Button variant="ghost" size="sm" onClick={() => share(selected)}>
                  {t('Share')}
                </Button>
              </div>
            </Card>

            <p className="px-1 text-[12px] leading-relaxed text-muted">
              {t('Identity and licence: NPI Registry.')}
              {!selected.organisation ? ` ${t('School, years, Medicare, telehealth: CMS Doctors & Clinicians.')}` : ''}
              {google ? ` ${t('Hours, website, rating: Google.')}` : ''}
              {pending ? ` ${t('Loading more details…')}` : ''}
            </p>
          </div>
        )}
      </Sheet>
    </div>
  )
}

/** "★ 4.9 (62) · Open · 8:00 AM – 5:00 PM", only for listings Google has told the backend about already. */
function GoogleLine({ g }: { g: GoogleSummary | null }) {
  const t = useT()
  if (!g || (g.rating === null && !g.hours.length)) return null
  const today = todaysHours(g.hours)
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[14px] text-muted">
      {g.rating !== null && (
        <span>
          <span className="text-amber-500" aria-hidden>★</span> <span className="font-semibold text-ink">{g.rating.toFixed(1)}</span>
          {g.ratings_count !== null && <span> ({g.ratings_count})</span>}
        </span>
      )}
      {today && (
        <span className={g.open_now ? 'font-medium text-brand' : ''}>
          {g.open_now === true ? `${t('Open now')} · ` : g.open_now === false ? `${t('Closed now')} · ` : ''}
          {today}
        </span>
      )}
    </p>
  )
}

function DetailRow({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <dt className="text-[12px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="text-[15px] text-ink">{children}</dd>
    </div>
  )
}

function Shimmer() {
  return <span className="inline-block h-4 w-28 animate-pulse rounded bg-line align-middle" aria-hidden />
}
