/**
 * Find a doctor / Pharmacies / Urgent care, served by PillSeek's own finder
 * (`/api/providers/*`, see Pill_backend/services/providers.py): the official
 * NPPES NPI Registry ranked by distance, plus the extra details the backend
 * caches — CMS "Doctors & Clinicians" (school, years in practice, hospitals,
 * Medicare, telehealth) and Google (rating, hours, website). The website's
 * Find a doctor page uses the same endpoints, so both show the same answers.
 *
 * Three ways in: a ZIP, a city (live-filled from the bundled ZIP table), or the
 * phone's location, and a by-name search for doctors.
 */
import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { ApiError, request } from './api'

const prefsKey = (kind: FinderKind) => (kind === 'doctors' ? 'doctors.prefs' : `doctors.prefs.${kind}`)
/** What we show after ranking: enough to scroll, not the whole county. */
export const MAX_RESULTS = 100
const SEARCH_TIMEOUT_MS = 25_000
/** CMS takes 5–15 s the first time a provider is opened; after that the backend has it cached. */
const EXTRAS_TIMEOUT_MS = 30_000

export interface Specialty {
  key: string
  /** English label; rendered through t() so Spanish picks it up. */
  label: string
}

/** Keys match the backend's list (services/providers.py SPECIALTIES). */
export const SPECIALTIES: Specialty[] = [
  { key: 'all', label: 'All providers' },
  { key: 'family', label: 'Family doctor' },
  { key: 'internal', label: 'Internal medicine' },
  { key: 'allergy', label: 'Allergist' },
  { key: 'cardiology', label: 'Cardiologist' },
  { key: 'chiro', label: 'Chiropractor' },
  { key: 'dentist', label: 'Dentist' },
  { key: 'dermatology', label: 'Dermatologist' },
  { key: 'endo', label: 'Endocrinologist' },
  { key: 'ent', label: 'ENT (ear, nose, throat)' },
  { key: 'eye', label: 'Eye doctor (ophthalmologist)' },
  { key: 'gastro', label: 'Gastroenterologist' },
  { key: 'neurology', label: 'Neurologist' },
  { key: 'np', label: 'Nurse practitioner' },
  { key: 'obgyn', label: 'OB/GYN' },
  { key: 'oncology', label: 'Oncologist' },
  { key: 'optometrist', label: 'Optometrist (glasses & contacts)' },
  { key: 'ortho', label: 'Orthopedic surgeon' },
  { key: 'pediatrics', label: 'Pediatrician' },
  { key: 'pt', label: 'Physical therapist' },
  { key: 'pa', label: 'Physician assistant' },
  { key: 'podiatry', label: 'Podiatrist (feet)' },
  { key: 'psychiatry', label: 'Psychiatrist' },
  { key: 'psychologist', label: 'Psychologist' },
  { key: 'pulmo', label: 'Pulmonologist (lungs)' },
  { key: 'rheum', label: 'Rheumatologist' },
  { key: 'counselor', label: 'Therapist / counselor' },
  { key: 'urology', label: 'Urologist' },
]

/** Organisations with their own Home tiles, not in the doctor pulldown. */
export const PHARMACY: Specialty = { key: 'pharmacy', label: 'Pharmacy' }
export const URGENT_CARE: Specialty = { key: 'urgent', label: 'Urgent care' }

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

/** Unknown keys fall back to the family doctor, the sensible default. */
export function specialtyByKey(key: string): Specialty {
  return SPECIALTIES.find((s) => s.key === key) ?? SPECIALTIES.find((s) => s.key === 'family')!
}

export const ALL_PROVIDERS: Specialty = SPECIALTIES[0]!

export interface Taxonomy {
  desc: string
  state: string
  license: string
  primary: boolean
}

/** What Google already told the backend about a listing (only once someone opened it). */
export interface GoogleSummary {
  rating: number | null
  ratings_count: number | null
  open_now: boolean | null
  /** Monday first, "Monday: 8:00 AM – 5:00 PM"; empty when unknown. */
  hours: string[]
  website: string
}

export interface Doctor {
  npi: string
  name: string
  /** Surname as registered (title-cased); empty for organisations. */
  last: string
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
  gender: 'M' | 'F' | ''
  /** Year first registered, "" when unknown. */
  since: string
  /** Miles from the search point; null for name searches. */
  distanceMiles: number | null
  google: GoogleSummary | null
}

/** CMS "Doctors & Clinicians" facts; clinicians only. */
export interface CmsDetails {
  primary_specialty: string
  secondary_specialties: string[]
  medical_school: string
  graduation_year: number | null
  years_in_practice: number | null
  medicare: boolean
  telehealth: boolean
  group_name: string
  group_size: number | null
  hospitals: string[]
}

export interface GoogleDetails extends GoogleSummary {
  name: string
  phone: string
  maps_url: string
}

export interface ProviderDetails {
  provider: Doctor
  cms: CmsDetails | null
  google: GoogleDetails | null
  /** True when the slow details are still to come: fetch `providerExtras`. */
  extras_pending: boolean
}

export interface ProviderExtras {
  cms: CmsDetails | null
  google: GoogleDetails | null
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

/** Plain text for the share sheet: who, what, where, phone, website. */
export function shareText(d: Doctor): string {
  const lines = [
    [d.name, d.credential].filter(Boolean).join(', '),
    d.specialty,
    d.address,
    `${d.city}, ${d.state} ${d.zip}`,
    d.phone,
    d.google?.website ?? '',
  ]
  return lines.filter(Boolean).join('\n')
}

/** "8:00 AM – 5:00 PM" for today from Google's Monday-first week; null when unknown. */
export function todaysHours(hours: string[], now: Date = new Date()): string | null {
  if (!hours.length) return null
  const idx = (now.getDay() + 6) % 7 // Monday = 0
  const line = hours[idx] ?? hours[0]!
  return line.replace(/^[A-Za-z]+:\s*/, '')
}

/** "https://www.example.com/" → "example.com" for a button label. */
export function websiteLabel(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '')
}

// ---- Searching ----------------------------------------------------------------

export type SearchMode = 'zip' | 'city' | 'near' | 'name'

export interface NameQuery {
  last: string
  first?: string
  /** Two-letter state, optional. */
  state?: string
}

export interface Position {
  lat: number
  lon: number
}

export interface DoctorSearch {
  specialty: Specialty
  mode: SearchMode
  /** zip mode */
  zip?: string
  /** city mode */
  city?: { city: string; state: string }
  /** near mode: the phone's fix */
  position?: Position
  /** name mode (any specialty) */
  name?: NameQuery
}

/**
 * Query parameters for a name search: the backend does a prefix match, so
 * "Ander" finds Anderson; it needs at least two letters of the last name.
 */
export function nameParams(n: NameQuery): Record<string, string> | null {
  const last = n.last.trim().replace(/[^A-Za-z' -]/g, '')
  if (last.length < 2) return null
  const out: Record<string, string> = { last }
  const first = (n.first ?? '').trim().replace(/[^A-Za-z' -]/g, '')
  if (first.length >= 2) out.first = first
  const state = (n.state ?? '').trim().toUpperCase()
  if (/^[A-Z]{2}$/.test(state)) out.state = state
  return out
}

/** The `/api/providers/search` query string for one search. Throws the same friendly errors the screen shows. */
export function searchParamsFor(kind: FinderKind, q: DoctorSearch): URLSearchParams {
  const p = new URLSearchParams({ kind, specialty: q.specialty.key })
  if (q.mode === 'name') {
    const params = q.name ? nameParams(q.name) : null
    if (!params) throw new ApiError('bad_request', 'Enter at least two letters of the last name.', { retryable: false })
    for (const [k, v] of Object.entries(params)) p.set(k, v)
  } else if (q.mode === 'city') {
    if (!q.city?.city || !q.city.state) throw new ApiError('bad_request', 'Pick a city from the list.', { retryable: false })
    p.set('city', q.city.city)
    p.set('state', q.city.state)
  } else if (q.mode === 'near') {
    if (!q.position) throw new ApiError('bad_request', 'Could not get your location. Try again, or search by ZIP or city.', { retryable: true })
    p.set('lat', q.position.lat.toFixed(5))
    p.set('lon', q.position.lon.toFixed(5))
  } else {
    const zip = (q.zip ?? '').trim()
    if (!isValidZip(zip)) throw new ApiError('bad_request', 'Enter a 5-digit ZIP code.', { retryable: false })
    p.set('zip', zip)
  }
  return p
}

export interface Origin {
  lat: number
  lon: number
  /** "San Francisco, CA 94107" or "your location" */
  label: string
  /** The ZIP the search was anchored to (nearest one for "near me"). */
  zip: string
}

export interface DoctorResults {
  doctors: Doctor[]
  origin: Origin | null
}

interface SearchResponse {
  origin: Origin | null
  results: Doctor[]
  count: number
}

function normalise(d: Doctor): Doctor {
  const g = d.google
  return {
    ...d,
    taxonomies: Array.isArray(d.taxonomies) ? d.taxonomies : [],
    distanceMiles: typeof d.distanceMiles === 'number' ? d.distanceMiles : null,
    google: g ? { rating: g.rating ?? null, ratings_count: g.ratings_count ?? null, open_now: g.open_now ?? null, hours: g.hours ?? [], website: g.website ?? '' } : null,
  }
}

/** One finder search, ranked nearest first by the backend (60-mile radius for ZIP / city / near me). */
export async function searchDoctors(kind: FinderKind, q: DoctorSearch, signal?: AbortSignal): Promise<DoctorResults> {
  const params = searchParamsFor(kind, q) // validation errors before any network
  const res = await request<SearchResponse>(`/api/providers/search?${params.toString()}`, { signal, timeoutMs: SEARCH_TIMEOUT_MS })
  const rows = Array.isArray(res.results) ? res.results.map(normalise) : []
  return { doctors: rows.slice(0, MAX_RESULTS), origin: res.origin ?? null }
}

/** The registry record plus whatever details the backend already holds (fast). */
export function providerDetails(npi: string, signal?: AbortSignal): Promise<ProviderDetails> {
  return request<ProviderDetails>(`/api/providers/${encodeURIComponent(npi)}`, { signal, timeoutMs: SEARCH_TIMEOUT_MS })
}

/** CMS + Google details; slow the first time anyone opens this provider, cached after. */
export function providerExtras(npi: string, signal?: AbortSignal): Promise<ProviderExtras> {
  return request<ProviderExtras>(`/api/providers/${encodeURIComponent(npi)}/extras`, { signal, timeoutMs: EXTRAS_TIMEOUT_MS })
}

// ---- Location -----------------------------------------------------------------

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
      mode: p.mode === 'city' || p.mode === 'near' || p.mode === 'name' ? p.mode : 'zip',
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
