'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  KIND_LABEL,
  POPULAR_KEYS,
  SPECIALTIES,
  directionsHref,
  formatMiles,
  geocodeProviders,
  initials,
  isValidZip,
  providerDetails,
  providerExtras,
  resultNoun,
  searchParamsFor,
  searchProviders,
  suggestCities,
  telHref,
  todaysHours,
  type CityHit,
  type CmsDetails,
  type FinderKind,
  type GoogleDetails,
  type GoogleSummary,
  type Origin,
  type Position,
  type Provider,
  type ProviderDetails,
  type SearchQuery,
} from '../../lib/providers'

const ProviderMap = dynamic(() => import('./ProviderMap'), { ssr: false, loading: () => <div className="h-full w-full bg-slate-100" /> })

const US_STATES: ReadonlyArray<readonly [string, string]> = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'],
  ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'],
  ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'],
  ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'],
  ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'],
  ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['PR', 'Puerto Rico'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'],
  ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
]

export interface InitialQuery {
  kind?: string
  specialty?: string
  zip?: string
  city?: string
  state?: string
  last?: string
  first?: string
}

const ICONS: Record<string, JSX.Element> = {
  family: <path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3M8 15v1a6 6 0 0 0 6 6 6 6 0 0 0 6-6v-4M20 10a2 2 0 1 0 0 .01" />,
  cardiology: <path d="M19 14c1.5-1.5 3-3.2 3-5.5A4.5 4.5 0 0 0 12 6a4.5 4.5 0 0 0-10 2.5C2 11 3.5 12.5 5 14l7 7zM3.5 12h4l2-3 3 6 2-3h6" />,
  psychiatry: <path d="M12 3a4 4 0 0 0-4 4v1a4 4 0 0 0-3 4 4 4 0 0 0 1 2.6A4 4 0 0 0 9 21h6a4 4 0 0 0 3-6.4A4 4 0 0 0 19 12a4 4 0 0 0-3-4V7a4 4 0 0 0-4-4zM12 3v18" />,
  pediatrics: <path d="M12 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM5 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2M9 13.5l3 3 3-3" />,
  dermatology: <path d="M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />,
  ortho: <path d="M17 10c1.7 0 3-1.3 3-3s-1.3-3-3-3c-.4 0-.8.1-1.1.2C15.5 3 14.4 2 13 2c-1.7 0-3 1.3-3 3 0 .4.1.8.2 1.1M7 14c-1.7 0-3 1.3-3 3s1.3 3 3 3c.4 0 .8-.1 1.1-.2.4 1.2 1.5 2.2 2.9 2.2 1.7 0 3-1.3 3-3 0-.4-.1-.8-.2-1.1M10.2 6.1L6.1 10.2M13.8 17.9l4.1-4.1M9 9l6 6" />,
  eye: <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />,
  obgyn: <path d="M12 22c4-3 6-6 6-9a6 6 0 0 0-12 0c0 3 2 6 6 9zM12 15a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM9 3.5C10 2.5 11 2 12 2s2 .5 3 1.5" />,
}

function Icon({ d, className = 'h-5 w-5', stroke = 'currentColor' }: { d: string; className?: string; stroke?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const PIN = 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'
const PHONE = 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.8.7a2 2 0 0 1 1.8 2z'
const LOCATE = 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 2v3M12 19v3M2 12h3M19 12h3'
const CHEVRON = 'M6 9l6 6 6-6'
const CLOSE = 'M18 6L6 18M6 6l12 12'
const STAR = 'M12 2l3 6.5 7 .8-5.2 4.8 1.5 7L12 17.6 5.7 21l1.5-7L2 9.3l7-.8z'

type Mode = 'place' | 'name'

function milesBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * 3958.8 * Math.asin(Math.sqrt(a))
}

export default function FindDoctorClient({ initial }: { initial: InitialQuery }) {
  const initialKind: FinderKind = initial.kind === 'pharmacy' || initial.kind === 'urgent' ? initial.kind : 'doctors'
  const [kind, setKind] = useState<FinderKind>(initialKind)
  const [specialty, setSpecialty] = useState(initial.specialty && SPECIALTIES.some((s) => s.key === initial.specialty) ? initial.specialty : 'family')
  const [mode, setMode] = useState<Mode>(initial.last ? 'name' : 'place')
  const [place, setPlace] = useState(initial.zip || (initial.city && initial.state ? `${initial.city}, ${initial.state}` : ''))
  const [pickedCity, setPickedCity] = useState<CityHit | null>(initial.city && initial.state ? { city: initial.city, state: initial.state, zips: 0 } : null)
  const [cityHits, setCityHits] = useState<CityHit[]>([])
  const [cityOpen, setCityOpen] = useState(false)
  const [lastName, setLastName] = useState(initial.last ?? '')
  const [firstName, setFirstName] = useState(initial.first ?? '')
  const [nameState, setNameState] = useState(initial.last ? initial.state ?? '' : '')
  const [locating, setLocating] = useState(false)

  const [query, setQuery] = useState<SearchQuery | null>(null)
  const [results, setResults] = useState<Provider[] | null>(null)
  const [origin, setOrigin] = useState<Origin | null>(null)
  const [positions, setPositions] = useState<Record<string, Position>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shown, setShown] = useState(20)

  const [selected, setSelected] = useState<string | null>(null)
  const [details, setDetails] = useState<ProviderDetails | null>(null)
  const [extras, setExtras] = useState<{ cms: CmsDetails | null; google: GoogleDetails | null } | null>(null)
  const [extrasLoading, setExtrasLoading] = useState(false)
  const [detailsError, setDetailsError] = useState<string | null>(null)

  const placeRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const detailAbort = useRef<AbortController | null>(null)

  // ---- city live-fill ----
  useEffect(() => {
    if (mode !== 'place') return
    const q = place.trim()
    if (isValidZip(q) || q.length < 2 || (pickedCity && q === `${pickedCity.city}, ${pickedCity.state}`)) {
      setCityHits([])
      return
    }
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      suggestCities(q, ctrl.signal)
        .then((hits) => {
          if (!ctrl.signal.aborted) {
            setCityHits(hits)
            setCityOpen(hits.length > 0)
          }
        })
        .catch(() => {})
    }, 150)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [place, mode, pickedCity])

  const pickCity = (hit: CityHit) => {
    setPickedCity(hit)
    setPlace(`${hit.city}, ${hit.state}`)
    setCityHits([])
    setCityOpen(false)
  }

  // ---- search ----
  const run = useCallback(async (q: SearchQuery, push = true) => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setError(null)
    setSelected(null)
    setDetails(null)
    setExtras(null)
    setShown(20)
    setQuery(q)
    if (push && typeof window !== 'undefined') {
      const p = searchParamsFor(q)
      p.delete('lat')
      p.delete('lon')
      window.history.replaceState(null, '', `${window.location.pathname}?${p.toString()}`)
    }
    try {
      const res = await searchProviders(q, ctrl.signal)
      if (ctrl.signal.aborted) return
      setResults(res.results)
      setOrigin(res.origin)
      setLoading(false) // the list is in; the pins follow in the background
      // Pins at once: exact where cached, else the ZIP centre (lighter) until the geocode lands.
      setPositions(Object.fromEntries(res.results.filter((d) => d.lat !== null && d.lon !== null).map((d) => [d.npi, { lat: d.lat!, lon: d.lon!, approx: d.approx === true }])))
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
      const pos = await geocodeProviders(res.results.slice(0, 60), ctrl.signal)
      if (ctrl.signal.aborted) return
      setPositions((prev) => ({ ...prev, ...pos }))
      // The list came ranked by ZIP centre; with real pins, show real distances and re-rank the top of the list.
      if (res.origin) {
        const o = res.origin
        const refined = res.results.map((d) => {
          const pp = pos[d.npi]
          return pp && !pp.approx ? { ...d, distanceMiles: Math.round(milesBetween(o.lat, o.lon, pp.lat, pp.lon) * 100) / 100 } : d
        })
        refined.sort((a, b) => (a.distanceMiles ?? 1e9) - (b.distanceMiles ?? 1e9))
        setResults(refined)
      }
    } catch (err) {
      if (ctrl.signal.aborted) return
      setResults(null)
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.')
    } finally {
      if (!ctrl.signal.aborted) setLoading(false)
    }
  }, [])

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault()
    setCityOpen(false)
    if (mode === 'name') {
      if (lastName.trim().length < 2) return setError('Enter at least two letters of the last name.')
      return void run({ kind: 'doctors', specialty: 'all', mode: 'name', last: lastName.trim(), first: firstName.trim(), state: nameState })
    }
    const q = place.trim()
    if (isValidZip(q)) return void run({ kind, specialty, mode: 'zip', zip: q })
    if (pickedCity && q === `${pickedCity.city}, ${pickedCity.state}`) return void run({ kind, specialty, mode: 'city', city: pickedCity.city, state: pickedCity.state })
    if (cityHits[0]) return pickCity(cityHits[0]), void run({ kind, specialty, mode: 'city', city: cityHits[0].city, state: cityHits[0].state })
    const m = /^(.+?)[,\s]+([A-Za-z]{2})$/.exec(q)
    if (m) return void run({ kind, specialty, mode: 'city', city: m[1].trim(), state: m[2].toUpperCase() })
    setError('Enter a ZIP code or pick a city from the list.')
    placeRef.current?.focus()
  }

  const useMyLocation = () => {
    if (!navigator.geolocation) return setError('Your browser cannot share your location. Enter a ZIP code instead.')
    setLocating(true)
    setError(null)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false)
        setPlace('Near me')
        setPickedCity(null)
        void run({ kind, specialty, mode: 'near', lat: p.coords.latitude, lon: p.coords.longitude })
      },
      () => {
        setLocating(false)
        setError('Location is blocked for this site. Enter a ZIP code or city instead.')
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 },
    )
  }

  // Run the search the page was opened with (shared link); once, even under React strict mode.
  const ranInitial = useRef(false)
  useEffect(() => {
    if (ranInitial.current) return
    ranInitial.current = true
    if (initial.last) void run({ kind: 'doctors', specialty: 'all', mode: 'name', last: initial.last, first: initial.first ?? '', state: initial.state ?? '' }, false)
    else if (initial.zip && isValidZip(initial.zip)) void run({ kind: initialKind, specialty, mode: 'zip', zip: initial.zip }, false)
    else if (initial.city && initial.state) void run({ kind: initialKind, specialty, mode: 'city', city: initial.city, state: initial.state }, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const chooseKind = (k: FinderKind) => {
    setKind(k)
    setMode('place')
    if (results && query && query.mode !== 'name') void run({ ...query, kind: k, specialty } as SearchQuery)
  }

  const chooseSpecialty = (key: string) => {
    setSpecialty(key)
    setKind('doctors')
    setMode('place')
    if (results && query && query.mode !== 'name') void run({ ...query, kind: 'doctors', specialty: key } as SearchQuery)
    else placeRef.current?.focus()
  }

  // ---- details ----
  const open = useCallback(async (npi: string) => {
    setSelected(npi)
    setDetails(null)
    setExtras(null)
    setDetailsError(null)
    detailAbort.current?.abort()
    const ctrl = new AbortController()
    detailAbort.current = ctrl
    try {
      const d = await providerDetails(npi, ctrl.signal)
      if (ctrl.signal.aborted) return
      setDetails(d)
      if (d.provider.lat !== null && d.provider.lon !== null) setPositions((prev) => ({ ...prev, [npi]: { lat: d.provider.lat!, lon: d.provider.lon!, approx: false } }))
      if (d.cms || d.google) setExtras({ cms: d.cms, google: d.google })
      if (d.extras_pending) {
        setExtrasLoading(true)
        const x = await providerExtras(npi, ctrl.signal)
        if (ctrl.signal.aborted) return
        setExtras({ cms: x.cms, google: x.google })
        if (x.google) {
          const g = x.google
          const summary: GoogleSummary = { rating: g.rating, ratings_count: g.ratings_count, open_now: g.open_now, hours: g.hours, website: g.website }
          setResults((prev) => prev?.map((r) => (r.npi === npi ? { ...r, google: summary } : r)) ?? prev)
        }
      }
    } catch (err) {
      if (ctrl.signal.aborted) return
      setDetailsError(err instanceof Error ? err.message : 'Could not load the details.')
    } finally {
      if (!ctrl.signal.aborted) setExtrasLoading(false)
    }
  }, [])

  const close = () => {
    detailAbort.current?.abort()
    setSelected(null)
    setDetails(null)
    setExtras(null)
    setExtrasLoading(false)
  }

  const selectedProvider = useMemo(() => results?.find((d) => d.npi === selected) ?? null, [results, selected])
  const visible = results ? results.slice(0, shown) : []
  const heading = results && query
    ? query.mode === 'name'
      ? `${results.length} ${results.length === 1 ? 'provider' : 'providers'} named ${query.last}`
      : `${results.length} ${resultNoun(query.kind, query.specialty, results.length)}${origin ? ` near ${origin.label}` : ''}`
    : ''

  return (
    <div>
      {/* Search card */}
      <form onSubmit={submit} className="mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white p-4 shadow-lg shadow-slate-900/5 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-full bg-slate-100 p-1" role="tablist" aria-label="What to find">
            {(['doctors', 'pharmacy', 'urgent'] as FinderKind[]).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kind === k && mode === 'place'}
                onClick={() => chooseKind(k)}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${kind === k && mode === 'place' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setMode(mode === 'name' ? 'place' : 'name')} className="ml-auto text-sm font-semibold text-emerald-700 hover:text-emerald-800">
            {mode === 'name' ? 'Search by place instead' : 'Search by name'}
          </button>
        </div>

        {mode === 'place' ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,280px)_minmax(0,1fr)_auto]">
            {kind === 'doctors' ? (
              <label className="relative block">
                <span className="absolute left-4 top-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Specialty</span>
                <select
                  value={specialty}
                  onChange={(e) => setSpecialty(e.target.value)}
                  className="h-14 w-full appearance-none rounded-xl border border-slate-300 bg-white pl-4 pr-10 pt-4 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {SPECIALTIES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <Icon d={CHEVRON} className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              </label>
            ) : (
              <div className="flex h-14 items-center rounded-xl border border-slate-200 bg-slate-50 px-4 text-base text-slate-700">{KIND_LABEL[kind]} near…</div>
            )}
            <div className="relative">
              <label className="block">
                <span className="absolute left-4 top-2 z-10 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Near</span>
                <input
                  ref={placeRef}
                  value={place}
                  onChange={(e) => {
                    setPlace(e.target.value)
                    setPickedCity(null)
                  }}
                  onFocus={() => cityHits.length > 0 && setCityOpen(true)}
                  onBlur={() => setTimeout(() => setCityOpen(false), 150)}
                  placeholder="City or ZIP code"
                  autoComplete="off"
                  inputMode="text"
                  className="h-14 w-full rounded-xl border border-slate-300 bg-white pl-4 pr-36 pt-4 text-base text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  aria-label="City or ZIP code"
                />
              </label>
              <button type="button" onClick={useMyLocation} disabled={locating} className="absolute right-3 top-1/2 inline-flex -translate-y-1/2 items-center gap-1.5 rounded-full px-2 py-1 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60">
                <Icon d={LOCATE} className="h-4 w-4" />
                {locating ? 'Locating…' : 'Use my location'}
              </button>
              {cityOpen && cityHits.length > 0 && (
                <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg" role="listbox">
                  {cityHits.map((h) => (
                    <li key={`${h.city}|${h.state}`}>
                      <button type="button" role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => pickCity(h)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-base text-slate-800 hover:bg-emerald-50">
                        <Icon d={PIN} className="h-4 w-4 text-slate-400" />
                        {h.city}, {h.state}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button type="submit" disabled={loading} className="inline-flex h-14 items-center justify-center rounded-xl bg-emerald-600 px-8 text-base font-semibold text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60">
              {loading ? 'Searching…' : 'Search'}
            </button>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_200px_auto]">
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last name" autoComplete="off" className="h-14 rounded-xl border border-slate-300 px-4 text-base focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500" aria-label="Last name" />
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name (optional)" autoComplete="off" className="h-14 rounded-xl border border-slate-300 px-4 text-base focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500" aria-label="First name" />
            <div className="relative">
              <select value={nameState} onChange={(e) => setNameState(e.target.value)} className="h-14 w-full appearance-none rounded-xl border border-slate-300 bg-white pl-4 pr-10 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500" aria-label="State">
                <option value="">Any state</option>
                {US_STATES.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
              <Icon d={CHEVRON} className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            </div>
            <button type="submit" disabled={loading} className="inline-flex h-14 items-center justify-center rounded-xl bg-emerald-600 px-8 text-base font-semibold text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60">
              {loading ? 'Searching…' : 'Search'}
            </button>
          </div>
        )}

        {error && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">{error}</p>}
      </form>

      {/* Landing: specialty tiles */}
      {results === null && !loading && (
        <section className="mx-auto mt-12 max-w-6xl">
          <div className="flex items-baseline justify-between">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">Browse by specialty</h2>
            <span className="text-sm text-slate-500">{SPECIALTIES.length - 1} specialties in the list above</span>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {POPULAR_KEYS.map((key) => {
              const s = SPECIALTIES.find((x) => x.key === key)!
              return (
                <button key={key} type="button" onClick={() => chooseSpecialty(key)} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-emerald-300 hover:bg-emerald-50/40 focus:outline-none focus:ring-2 focus:ring-emerald-500">
                  <span className="flex h-11 w-11 flex-none items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[key]}</svg>
                  </span>
                  <span className="min-w-0">
                    <span className="block text-base font-semibold text-slate-900">{s.label.replace(/\s*\(.*\)$/, '')}</span>
                    <span className="block truncate text-sm text-slate-500">{s.blurb}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* Results */}
      {(results !== null || loading) && (
        <section ref={resultsRef} className="mx-auto mt-8 max-w-6xl scroll-mt-20">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{loading && !results ? 'Searching the registry…' : heading}</h2>
              {results && <p className="mt-1 text-sm text-slate-500">{origin ? 'Nearest first' : 'Alphabetical'} · Official registry data · Tap a card for details</p>}
            </div>
            {results && results.length > 0 && kind === 'doctors' && query?.mode !== 'name' && (
              <p className="text-sm text-slate-500">Not the right specialty? Change it above.</p>
            )}
          </div>

          <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
            {/* List */}
            <div className="space-y-3">
              {loading && !results && Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-36 animate-pulse rounded-xl border border-slate-200 bg-white" />)}
              {results && results.length === 0 && (
                <div className="rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
                  <p className="text-lg font-semibold text-slate-900">Nothing in the registry for that search</p>
                  <p className="mt-1 text-sm text-slate-600">Try "All providers", a nearby city, or a wider area.</p>
                </div>
              )}
              {visible.map((d, i) => (
                <ProviderCard key={d.npi} d={d} index={i + 1} active={d.npi === selected} onOpen={() => void open(d.npi)} />
              ))}
              {results && shown < results.length && (
                <button type="button" onClick={() => setShown((n) => n + 20)} className="h-11 w-full rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  Show {Math.min(20, results.length - shown)} more
                </button>
              )}
            </div>

            {/* Map + details */}
            <div className="space-y-4 lg:sticky lg:top-16 lg:self-start">
              <div className="h-56 overflow-hidden rounded-xl border border-slate-200 shadow-sm sm:h-72 lg:h-80">
                {results && <ProviderMap providers={visible} positions={positions} origin={origin} selected={selected} onSelect={(npi) => void open(npi)} />}
              </div>
              {selected && (
                <DetailsPanel
                  provider={details?.provider ?? selectedProvider}
                  cms={extras?.cms ?? null}
                  google={extras?.google ?? null}
                  loadingExtras={extrasLoading}
                  error={detailsError}
                  onClose={close}
                />
              )}
              {!selected && results && results.length > 0 && (
                <p className="hidden text-sm text-slate-500 lg:block">Select a listing to see licences, medical school, hospital affiliations, hours and website.</p>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

function ProviderCard({ d, index, active, onOpen }: { d: Provider; index: number; active: boolean; onOpen: () => void }) {
  return (
    <article className={`rounded-xl border bg-white p-4 shadow-sm transition-colors ${active ? 'border-emerald-500 ring-2 ring-emerald-500/20' : 'border-slate-200 hover:border-slate-300'}`}>
      <div className="flex gap-3">
        <div className={`flex h-12 w-12 flex-none items-center justify-center rounded-full text-base font-bold ${active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`} aria-hidden="true">
          {initials(d.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <button type="button" onClick={onOpen} className="text-left text-lg font-bold leading-snug text-slate-900 hover:text-emerald-700">
              <span className="mr-1.5 text-sm font-semibold text-slate-400">{index}.</span>
              {d.name}
              {d.credential && <span className="font-semibold text-slate-600">, {d.credential}</span>}
            </button>
            {d.distanceMiles !== null && <span className="flex-none rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">{formatMiles(d.distanceMiles)}</span>}
          </div>
          {d.specialty && <p className="mt-0.5 text-sm text-slate-700">{d.specialty}</p>}
          <p className="mt-0.5 text-sm text-slate-500">
            {d.address}, {d.city}, {d.state} {d.zip}
          </p>
          <GoogleLine g={d.google} />
          <div className="mt-3 flex flex-wrap gap-2">
            {d.phone && (
              <a href={telHref(d.phone)} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">
                <Icon d={PHONE} className="h-4 w-4" />
                Call
              </a>
            )}
            <a href={directionsHref(d)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Directions
            </a>
            <button type="button" onClick={onOpen} className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Details
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}

/** "★ 4.9 · 62 reviews · Open until 5 PM", only for listings Google has told us about already. */
function GoogleLine({ g }: { g?: GoogleSummary | null }) {
  if (!g || (g.rating === null && !g.hours.length)) return null
  const today = todaysHours(g.hours)
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-slate-600">
      {g.rating !== null && (
        <span className="inline-flex items-center gap-1">
          <Icon d={STAR} className="h-4 w-4" stroke="#f59e0b" />
          <span className="font-semibold text-slate-800">{g.rating.toFixed(1)}</span>
          {g.ratings_count !== null && <span className="text-slate-500">({g.ratings_count})</span>}
        </span>
      )}
      {today && (
        <span className={g.open_now ? 'font-medium text-emerald-700' : g.open_now === false ? 'text-slate-500' : ''}>
          {g.open_now === true ? 'Open · ' : g.open_now === false ? 'Closed · ' : ''}
          {today}
        </span>
      )}
    </p>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-sm text-slate-800">{children}</div>
    </div>
  )
}

function DetailsPanel({ provider, cms, google, loadingExtras, error, onClose }: { provider: Provider | null; cms: CmsDetails | null; google: GoogleDetails | null; loadingExtras: boolean; error: string | null; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (window.innerWidth < 1024) panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [provider?.npi])
  if (!provider) return null
  const licences = Array.from(new Set(provider.taxonomies.filter((t) => t.license).map((t) => `${t.state} ${t.license}`)))
  const specialties = Array.from(new Set(provider.taxonomies.map((t) => t.desc)))
  const hoursToday = google ? todaysHours(google.hours) : null
  return (
    <div ref={panelRef} className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold text-slate-900">
            {provider.name}
            {provider.credential && <span className="font-semibold text-slate-600">, {provider.credential}</span>}
          </h3>
          <p className="mt-0.5 text-sm text-slate-700">{specialties.join(' · ') || provider.specialty}</p>
          {google && google.rating !== null && (
            <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-slate-700">
              <Icon d={STAR} className="h-4 w-4" stroke="#f59e0b" />
              <span className="font-semibold">{google.rating.toFixed(1)}</span>
              <span className="text-slate-500">· {google.ratings_count ?? 0} Google reviews{google.name && google.name !== provider.name ? ` · ${google.name}` : ''}</span>
            </p>
          )}
        </div>
        <button type="button" onClick={onClose} aria-label="Close details" className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
          <Icon d={CLOSE} className="h-5 w-5" />
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-amber-800">{error}</p>}

      <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3">
        {!provider.organisation && (
          <>
            <Field label="Medical school">{cms ? cms.medical_school || 'Not listed' : loadingExtras ? <Shimmer /> : '—'}</Field>
            <Field label="In practice">{cms ? (cms.years_in_practice !== null ? `${cms.years_in_practice} years` : 'Not listed') : loadingExtras ? <Shimmer /> : '—'}</Field>
            <Field label="Group practice">{cms ? cms.group_name || 'Independent' : loadingExtras ? <Shimmer /> : '—'}</Field>
            <Field label="Hospital affiliation">{cms ? cms.hospitals.join(', ') || 'None listed' : loadingExtras ? <Shimmer /> : '—'}</Field>
            <Field label="Accepts">{cms ? [cms.medicare ? 'Medicare' : null, cms.telehealth ? 'Telehealth visits' : null].filter(Boolean).join(' · ') || 'Not listed' : loadingExtras ? <Shimmer /> : '—'}</Field>
          </>
        )}
        {(google || loadingExtras) && (
          <Field label="Hours today">
            {google ? (
              hoursToday ? (
                <span className={google.open_now ? 'font-semibold text-emerald-700' : ''}>
                  {google.open_now === true ? 'Open · ' : google.open_now === false ? 'Closed · ' : ''}
                  {hoursToday}
                </span>
              ) : (
                'Not listed'
              )
            ) : (
              <Shimmer />
            )}
          </Field>
        )}
        {licences.length > 0 && <Field label="Licence">{licences.join(', ')}</Field>}
        <Field label="Registry NPI">{provider.npi}{provider.since ? ` · since ${provider.since}` : ''}</Field>
      </div>

      <div className="mt-4 border-t border-slate-100 pt-3 text-sm text-slate-800">
        <p>
          {provider.address}, {provider.city}, {provider.state} {provider.zip}
          {provider.distanceMiles !== null ? ` · ${formatMiles(provider.distanceMiles)}` : ''}
        </p>
        <p className="mt-0.5 text-slate-600">
          {provider.phone || google?.phone || ''}
          {google?.website ? (
            <>
              {provider.phone ? ' · ' : ''}
              <a href={google.website} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-emerald-700 hover:underline">
                {google.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
              </a>
            </>
          ) : null}
        </p>
      </div>

      <div className="mt-4 flex gap-2">
        {(provider.phone || google?.phone) && (
          <a href={telHref(provider.phone || google!.phone)} className="inline-flex h-11 flex-1 items-center justify-center rounded-lg bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-700">
            Call the office
          </a>
        )}
        <a href={directionsHref(provider)} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 flex-1 items-center justify-center rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50">
          Directions
        </a>
        {google?.website && (
          <a href={google.website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex h-11 flex-1 items-center justify-center rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Website ↗
          </a>
        )}
      </div>
      <p className="mt-3 text-xs text-slate-400">
        Identity and licence: NPI registry
        {!provider.organisation ? ' · School, years, Medicare, telehealth: CMS Doctors & Clinicians' : ''}
        {google ? ' · Hours, website, rating: Google' : ''}
        {loadingExtras ? ' · Loading more details…' : ''}
      </p>
    </div>
  )
}

function Shimmer() {
  return <span className="inline-block h-4 w-24 animate-pulse rounded bg-slate-200 align-middle" aria-label="Loading" />
}
