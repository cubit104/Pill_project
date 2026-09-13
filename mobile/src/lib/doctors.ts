/**
 * Find a doctor / Pharmacies / Urgent care: the free NPPES NPI Registry (CMS),
 * the official list of every US clinician and health organisation. No key, no cost.
 *
 * Three ways in: a ZIP, a city (live-filled from the bundled ZIP table), or the
 * phone's location (nearest ZIP). Results are ranked by distance from that
 * point using the same table. Natively the call goes through CapacitorHttp (no
 * CORS in the WebView); in a browser it goes through the dev-server proxy.
 */
import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { ApiError } from './api'
import { distanceMiles, findCity, nearbyZips, nearestZip, type ZipTable } from './geo'

export const NPI_API = Capacitor.isNativePlatform() ? 'https://npiregistry.cms.hhs.gov/api/' : '/npi-api/'
const TIMEOUT_MS = 15_000
const prefsKey = (kind: FinderKind) => (kind === 'doctors' ? 'doctors.prefs' : `doctors.prefs.${kind}`)
/** The registry caps one query at 200; we ask for that and rank ourselves. */
const PAGE = '200'
/** What we show after ranking: enough to scroll, not the whole county. */
export const MAX_RESULTS = 100
/**
 * A ZIP search asks the registry for each of the nearest ZIPs separately: one
 * wide "750*" query is capped at 200 rows in no particular order and misses the
 * clinic next door in a big metro.
 */
const NEARBY_ZIPS = 10
const NEARBY_MILES = 12

export interface Specialty {
  key: string
  /** English label; rendered through t() so Spanish picks it up. */
  label: string
  /**
   * NPPES taxonomy search term. The registry matches on words, so "Psychiatry"
   * also returns neurologists; `match` then keeps only the specialties we mean.
   */
  taxonomy: string
  match: RegExp
  /** NPI-1 = individual clinician, NPI-2 = organisation (pharmacy, urgent care). */
  kind: 'NPI-1' | 'NPI-2'
  /**
   * Organisation-name wildcard for a second query, for places registered under
   * a generic taxonomy ("Urgent Care 360" is filed as General Practice).
   */
  nameHint?: string
}

export const SPECIALTIES: Specialty[] = [
  { key: 'family', label: 'Family doctor', taxonomy: 'Family Medicine', match: /Family/, kind: 'NPI-1' },
  { key: 'internal', label: 'Internal medicine', taxonomy: 'Internal Medicine', match: /^Internal Medicine/, kind: 'NPI-1' },
  { key: 'pediatrics', label: 'Pediatrician', taxonomy: 'Pediatrics', match: /Pediatric/, kind: 'NPI-1' },
  { key: 'obgyn', label: 'OB/GYN', taxonomy: 'Obstetrics & Gynecology', match: /Obstetric|Gynecolog/, kind: 'NPI-1' },
  { key: 'cardiology', label: 'Cardiologist', taxonomy: 'Cardiovascular Disease', match: /Cardiovascular|Cardiolog/, kind: 'NPI-1' },
  { key: 'dermatology', label: 'Dermatologist', taxonomy: 'Dermatology', match: /Dermatolog/, kind: 'NPI-1' },
  { key: 'psychiatry', label: 'Psychiatrist', taxonomy: 'Psychiatry', match: /^Psychiatry$|,\s*[^,]*Psychiatry[^,]*$/, kind: 'NPI-1' },
  { key: 'neurology', label: 'Neurologist', taxonomy: 'Neurology', match: /,\s*[^,]*Neurology[^,]*$/, kind: 'NPI-1' },
  { key: 'ortho', label: 'Orthopedic surgeon', taxonomy: 'Orthopaedic Surgery', match: /Orthop/, kind: 'NPI-1' },
  { key: 'endo', label: 'Endocrinologist', taxonomy: 'Endocrinology', match: /Endocrinolog/, kind: 'NPI-1' },
  { key: 'eye', label: 'Eye doctor', taxonomy: 'Ophthalmology', match: /Ophthalmolog/, kind: 'NPI-1' },
  { key: 'dentist', label: 'Dentist', taxonomy: 'Dentist*', match: /Dentist/, kind: 'NPI-1' },
]

/** Organisations with their own Home tiles, not in the doctor pulldown. */
export const PHARMACY: Specialty = { key: 'pharmacy', label: 'Pharmacy', taxonomy: 'Pharmacy*', match: /Pharmac/, kind: 'NPI-2', nameHint: '*pharmacy*' }
export const URGENT_CARE: Specialty = { key: 'urgent', label: 'Urgent care', taxonomy: 'Urgent Care', match: /Urgent Care/, kind: 'NPI-2', nameHint: '*urgent*' }

export type FinderKind = 'doctors' | 'pharmacy' | 'urgent'

export interface Finder {
  /** English; rendered through t(). */
  title: string
  subtitle: string
  /** Fixed category (no pulldown), or null for the doctor list. */
  fixed: Specialty | null
}

export const FINDERS: Record<FinderKind, Finder> = {
  doctors: { title: 'Find a doctor', subtitle: 'Doctors and clinics near you, from the official US provider registry.', fixed: null },
  pharmacy: { title: 'Pharmacies', subtitle: 'Pharmacies near you, from the official US provider registry.', fixed: PHARMACY },
  urgent: { title: 'Urgent care', subtitle: 'Urgent care clinics near you, from the official US provider registry.', fixed: URGENT_CARE },
}

export function specialtyByKey(key: string): Specialty {
  return SPECIALTIES.find((s) => s.key === key) ?? SPECIALTIES[0]!
}

export interface Taxonomy {
  desc: string
  state: string
  license: string
  primary: boolean
}

export interface Address {
  address: string
  city: string
  state: string
  zip: string
  phone: string
  fax: string
}

export interface Doctor {
  npi: string
  name: string
  credential: string
  /** Primary specialty as the registry words it. */
  specialty: string
  /** Practice location. */
  address: string
  city: string
  state: string
  zip: string
  phone: string
  organisation: boolean
  taxonomies: Taxonomy[]
  mailing: Address | null
  gender: 'M' | 'F' | ''
  /** Year first registered, "" when unknown. */
  since: string
  /** Set by ranking; null when the ZIP is unknown to the table. */
  distanceMiles: number | null
}

export function isValidZip(zip: string): boolean {
  return /^\d{5}$/.test(zip.trim())
}

/** Digits only, for tel: links. */
export function telUrl(phone: string): string {
  return `tel:${phone.replace(/\D/g, '')}`
}

export function mapsUrl(a: { address: string; city: string; state: string; zip: string }, platform: 'ios' | 'android' | 'web'): string {
  const q = encodeURIComponent(`${a.address}, ${a.city}, ${a.state} ${a.zip}`)
  if (platform === 'ios') return `https://maps.apple.com/?q=${q}`
  if (platform === 'android') return `geo:0,0?q=${q}`
  return `https://www.google.com/maps/search/?api=1&query=${q}`
}

/** The registry's own public page for a provider. */
export function nppesUrl(npi: string): string {
  return `https://npiregistry.cms.hhs.gov/provider-view/${npi}`
}

/** Plain text for the share sheet: who, what, where, phone, registry link. */
export function shareText(d: Doctor): string {
  const lines = [
    [d.name, d.credential].filter(Boolean).join(', '),
    d.specialty,
    d.address,
    `${d.city}, ${d.state} ${d.zip}`,
    d.phone,
    nppesUrl(d.npi),
  ]
  return lines.filter(Boolean).join('\n')
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bMd\b/g, 'MD')
    .replace(/\bDo\b/g, 'DO')
    .replace(/\bLlc\b/g, 'LLC')
    .replace(/\bPc\b/g, 'PC')
}

/** NPPES returns 9-digit ZIPs without a dash; show the 5-digit part. */
function shortZip(zip: string): string {
  return (zip || '').replace(/\D/g, '').slice(0, 5)
}

function toAddress(a: Record<string, unknown>): Address {
  return {
    address: titleCase([a.address_1, a.address_2].filter(Boolean).map(String).join(', ')),
    city: titleCase(String(a.city ?? '')),
    state: String(a.state ?? ''),
    zip: shortZip(String(a.postal_code ?? '')),
    phone: String(a.telephone_number ?? ''),
    fax: String(a.fax_number ?? ''),
  }
}

/**
 * Turn one NPPES search response into display rows. Pure, so it is unit-tested:
 * prefers the practice (LOCATION) address, drops entries without one, title-cases
 * the shouted names, keeps every specialty for the detail sheet, dedupes by NPI.
 */
export function parseNpiResponse(json: unknown): Doctor[] {
  const results = (json as { results?: unknown[] } | null)?.results
  if (!Array.isArray(results)) return []
  const out: Doctor[] = []
  const seen = new Set<string>()
  for (const raw of results) {
    const r = raw as {
      number?: number | string
      enumeration_type?: string
      basic?: Record<string, unknown>
      addresses?: Array<Record<string, unknown>>
      taxonomies?: Array<Record<string, unknown>>
    }
    const npi = String(r.number ?? '')
    if (!npi || seen.has(npi)) continue
    const addresses = r.addresses ?? []
    const locRaw = addresses.find((a) => a.address_purpose === 'LOCATION') ?? addresses[0]
    if (!locRaw || !locRaw.address_1) continue
    const basic = r.basic ?? {}
    const organisation = r.enumeration_type === 'NPI-2'
    const orgName = String(basic.organization_name ?? basic.name ?? '')
    const person = [basic.first_name, basic.last_name].filter(Boolean).map(String).join(' ')
    const name = titleCase(organisation ? orgName || person : person || orgName)
    if (!name.trim()) continue
    const taxonomies: Taxonomy[] = (r.taxonomies ?? [])
      .filter((t) => t.desc)
      .map((t) => ({ desc: String(t.desc), state: String(t.state ?? ''), license: String(t.license ?? ''), primary: t.primary === true }))
    const primary = taxonomies.find((t) => t.primary) ?? taxonomies[0]
    const loc = toAddress(locRaw)
    const mailRaw = addresses.find((a) => a.address_purpose === 'MAILING' && a !== locRaw)
    const mailing = mailRaw?.address_1 ? toAddress(mailRaw) : null
    const gender = basic.gender === 'M' || basic.gender === 'F' ? basic.gender : ''
    const since = /^\d{4}/.exec(String(basic.enumeration_date ?? ''))?.[0] ?? ''
    seen.add(npi)
    out.push({
      npi,
      name,
      credential: String(basic.credential ?? '').replace(/\./g, '').toUpperCase(),
      specialty: primary?.desc ?? '',
      address: loc.address,
      city: loc.city,
      state: loc.state,
      zip: loc.zip,
      phone: loc.phone,
      organisation,
      taxonomies,
      mailing: mailing && (mailing.address !== loc.address || mailing.zip !== loc.zip) ? mailing : null,
      gender,
      since,
      distanceMiles: null,
    })
  }
  return out
}

/**
 * Keep rows that carry the specialty asked for in any of their taxonomies (not
 * only the primary one), and show that matching specialty on the card rather
 * than an unrelated primary ("Emergency Medicine" on a family-doctor search).
 */
export function filterBySpecialty(rows: Doctor[], sp: Specialty): Doctor[] {
  const out: Doctor[] = []
  for (const d of rows) {
    if ((d.taxonomies.length === 0 && !d.specialty) || sp.match.test(d.specialty)) {
      out.push(d)
      continue
    }
    const hit = d.taxonomies.find((t) => sp.match.test(t.desc))
    if (hit) out.push({ ...d, specialty: hit.desc })
  }
  return out
}

/** Union of several result lists, first occurrence of each NPI wins. */
export function mergeResults(lists: Doctor[][]): Doctor[] {
  const seen = new Set<string>()
  const out: Doctor[] = []
  for (const list of lists) {
    for (const d of list) {
      if (seen.has(d.npi)) continue
      seen.add(d.npi)
      out.push(d)
    }
  }
  return out
}

export interface Origin {
  lat: number
  lon: number
  /** "San Francisco, CA 94107" or "your location" */
  label: string
}

/** Nearest first; rows whose ZIP the table does not know go last, in their original order. */
export function rankByDistance(rows: Doctor[], origin: Origin | null, table: ZipTable | null): Doctor[] {
  if (!origin || !table) return rows.map((d) => ({ ...d, distanceMiles: null }))
  const ranked = rows.map((d) => {
    const z = table.byZip.get(d.zip)
    return { ...d, distanceMiles: z ? distanceMiles(origin.lat, origin.lon, z.lat, z.lon) : null }
  })
  const known = ranked.filter((d) => d.distanceMiles !== null).sort((a, b) => a.distanceMiles! - b.distanceMiles!)
  return [...known, ...ranked.filter((d) => d.distanceMiles === null)]
}

// ---- Fetching ---------------------------------------------------------------

async function fetchJson(url: string, params: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.get({
      url,
      params,
      headers: { Accept: 'application/json' },
      connectTimeout: TIMEOUT_MS,
      readTimeout: TIMEOUT_MS,
      responseType: 'json',
    })
    if (res.status < 200 || res.status >= 300) throw new ApiError('server', 'The doctor directory is not responding. Try again later.')
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data
  }
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(`${url}?${qs}`, { headers: { Accept: 'application/json' }, signal })
  if (!res.ok) throw new ApiError('server', 'The doctor directory is not responding. Try again later.')
  return res.json()
}

/** One registry call. `byName` searches organisation names instead of the taxonomy and skips the taxonomy filter. */
async function query(sp: Specialty, extra: Record<string, string>, signal?: AbortSignal, byName = false): Promise<Doctor[]> {
  const base: Record<string, string> = { version: '2.1', enumeration_type: sp.kind, limit: PAGE }
  if (!byName) base.taxonomy_description = sp.taxonomy
  const json = await fetchJson(NPI_API, { ...base, ...extra }, signal)
  const errors = (json as { Errors?: Array<{ description?: string }> } | null)?.Errors
  if (Array.isArray(errors) && errors.length > 0) {
    throw new ApiError('server', errors[0]?.description ?? 'The doctor directory rejected the search.')
  }
  const rows = parseNpiResponse(json)
  return byName ? rows : filterBySpecialty(rows, sp)
}

export type SearchMode = 'zip' | 'city' | 'near'

export interface DoctorSearch {
  specialty: Specialty
  mode: SearchMode
  /** zip and near modes */
  zip?: string
  /** city mode */
  city?: { city: string; state: string }
}

export interface DoctorResults {
  doctors: Doctor[]
  origin: Origin | null
}

/**
 * ZIP / near: the nearest ZIPs around the point, one registry call each (in
 * parallel), plus a name search in the town for organisations filed under a
 * generic taxonomy; merged and ranked from the ZIP's centroid. City: the
 * registry's own city+state filter, ranked from the city's centroid.
 */
export async function searchDoctors(q: DoctorSearch, table: ZipTable | null, signal?: AbortSignal): Promise<DoctorResults> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError('offline', 'No internet connection. Reconnect and try again.')
  }
  try {
    let lists: Doctor[][]
    let origin: Origin | null = null
    if (q.mode === 'city') {
      const c = q.city
      if (!c?.city || !c.state) throw new ApiError('bad_request', 'Pick a city from the list.', { retryable: false })
      const hit = table ? findCity(table, c.city, c.state) : null
      origin = hit ? { lat: hit.lat, lon: hit.lon, label: `${hit.city}, ${hit.state}` } : null
      const jobs = [query(q.specialty, { city: c.city, state: c.state }, signal)]
      if (q.specialty.nameHint) jobs.push(query(q.specialty, { organization_name: q.specialty.nameHint, city: c.city, state: c.state }, signal, true))
      lists = await Promise.all(jobs)
    } else {
      const zip = (q.zip ?? '').trim()
      if (!isValidZip(zip)) throw new ApiError('bad_request', 'Enter a 5-digit ZIP code.', { retryable: false })
      const z = table?.byZip.get(zip) ?? null
      origin = z ? { lat: z.lat, lon: z.lon, label: q.mode === 'near' ? `${z.city}, ${z.state}` : `${z.city}, ${z.state} ${z.zip}` } : null
      const codes = table && z ? nearbyZips(table, z.lat, z.lon, NEARBY_ZIPS, NEARBY_MILES).map((r) => r.zip) : []
      if (!codes.includes(zip)) codes.unshift(zip)
      const jobs = codes.map((code) => query(q.specialty, { postal_code: `${code}*` }, signal))
      if (!table) jobs.push(query(q.specialty, { postal_code: `${zip.slice(0, 3)}*` }, signal)) // no table: fall back to the wider area
      if (q.specialty.nameHint && z) jobs.push(query(q.specialty, { organization_name: q.specialty.nameHint, city: z.city, state: z.state }, signal, true))
      lists = await Promise.all(jobs)
    }
    return { doctors: rankByDistance(mergeResults(lists), origin, table).slice(0, MAX_RESULTS), origin }
  } catch (err) {
    if (err instanceof ApiError) throw err
    throw new ApiError('unknown', 'Could not reach the doctor directory. Check your connection and try again.', { retryable: true })
  }
}

// ---- Location -----------------------------------------------------------------

export interface Position {
  lat: number
  lon: number
}

/** One fix from the phone (or the browser). Asks permission the first time. */
export async function getPosition(): Promise<Position> {
  try {
    if (Capacitor.isNativePlatform()) {
      const { Geolocation } = await import('@capacitor/geolocation')
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 12_000, maximumAge: 60_000 })
      return { lat: pos.coords.latitude, lon: pos.coords.longitude }
    }
    return await new Promise<Position>((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('unsupported'))
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
        (e) => reject(e),
        { enableHighAccuracy: false, timeout: 12_000, maximumAge: 60_000 },
      )
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/denied|permission|not authorized/i.test(msg)) {
      throw new ApiError('bad_request', 'Location is off for PillSeek. Turn it on in Settings, or search by ZIP or city.', { retryable: false })
    }
    throw new ApiError('unknown', 'Could not get your location. Try again, or search by ZIP or city.', { retryable: true })
  }
}

export function nearestZipTo(table: ZipTable, pos: Position): string | null {
  return nearestZip(table, pos.lat, pos.lon)?.zip ?? null
}

// ---- Remembered search --------------------------------------------------------

export interface DoctorPrefs {
  specialty: string
  mode: SearchMode
  zip: string
  city: string
  state: string
}

const DEFAULT_PREFS: DoctorPrefs = { specialty: 'family', mode: 'zip', zip: '', city: '', state: '' }

export async function loadDoctorPrefs(kind: FinderKind = 'doctors'): Promise<DoctorPrefs> {
  try {
    const { value } = await Preferences.get({ key: prefsKey(kind) })
    if (!value) return { ...DEFAULT_PREFS }
    const p = JSON.parse(value) as Partial<DoctorPrefs>
    return {
      specialty: typeof p.specialty === 'string' ? p.specialty : DEFAULT_PREFS.specialty,
      mode: p.mode === 'city' || p.mode === 'near' ? p.mode : 'zip',
      zip: typeof p.zip === 'string' ? p.zip : '',
      city: typeof p.city === 'string' ? p.city : '',
      state: typeof p.state === 'string' ? p.state : '',
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export async function saveDoctorPrefs(p: DoctorPrefs, kind: FinderKind = 'doctors'): Promise<void> {
  try {
    await Preferences.set({ key: prefsKey(kind), value: JSON.stringify(p) })
  } catch {
    /* ignore */
  }
}
