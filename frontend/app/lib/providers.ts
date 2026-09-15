/**
 * Find a doctor: types and API helpers for the /find-a-doctor page.
 * The data comes from /api/providers/* (routes/providers.py): the NPI
 * registry for the list, the Census geocoder for pins, CMS for clinician
 * details and, when configured, Google Places for website, hours and rating.
 */

export type FinderKind = 'doctors' | 'pharmacy' | 'urgent'

export interface SpecialtyOption {
  key: string
  label: string
  blurb: string
}

/** Mirrors SPECIALTIES in services/providers.py (labels only; the matching lives on the server). */
export const SPECIALTIES: SpecialtyOption[] = [
  { key: 'all', label: 'All providers', blurb: 'Doctors, nurse practitioners, PAs, therapists' },
  { key: 'family', label: 'Family doctor', blurb: 'Check-ups, everyday care' },
  { key: 'internal', label: 'Internal medicine', blurb: 'Adult primary care' },
  { key: 'allergy', label: 'Allergist', blurb: 'Allergies, asthma' },
  { key: 'cardiology', label: 'Cardiologist', blurb: 'Heart and blood pressure' },
  { key: 'chiro', label: 'Chiropractor', blurb: 'Back and neck' },
  { key: 'dentist', label: 'Dentist', blurb: 'Teeth and gums' },
  { key: 'dermatology', label: 'Dermatologist', blurb: 'Skin, hair and nails' },
  { key: 'endo', label: 'Endocrinologist', blurb: 'Diabetes, thyroid, hormones' },
  { key: 'ent', label: 'ENT (ear, nose, throat)', blurb: 'Ears, sinuses, throat' },
  { key: 'eye', label: 'Eye doctor (ophthalmologist)', blurb: 'Eye disease and surgery' },
  { key: 'gastro', label: 'Gastroenterologist', blurb: 'Stomach and digestion' },
  { key: 'neurology', label: 'Neurologist', blurb: 'Brain and nerves' },
  { key: 'np', label: 'Nurse practitioner', blurb: 'Primary and specialty care' },
  { key: 'obgyn', label: 'OB/GYN', blurb: "Women's health, pregnancy" },
  { key: 'oncology', label: 'Oncologist', blurb: 'Cancer care' },
  { key: 'optometrist', label: 'Optometrist (glasses & contacts)', blurb: 'Eye exams, glasses' },
  { key: 'ortho', label: 'Orthopedic surgeon', blurb: 'Bones, joints, injuries' },
  { key: 'pediatrics', label: 'Pediatrician', blurb: 'Babies, children, teens' },
  { key: 'pt', label: 'Physical therapist', blurb: 'Movement and recovery' },
  { key: 'pa', label: 'Physician assistant', blurb: 'Primary and specialty care' },
  { key: 'podiatry', label: 'Podiatrist (feet)', blurb: 'Feet and ankles' },
  { key: 'psychiatry', label: 'Psychiatrist', blurb: 'Mental health, medication' },
  { key: 'psychologist', label: 'Psychologist', blurb: 'Therapy and testing' },
  { key: 'pulmo', label: 'Pulmonologist (lungs)', blurb: 'Lungs and breathing' },
  { key: 'rheum', label: 'Rheumatologist', blurb: 'Arthritis, autoimmune' },
  { key: 'counselor', label: 'Therapist / counselor', blurb: 'Talk therapy' },
  { key: 'urology', label: 'Urologist', blurb: 'Kidneys, bladder, prostate' },
]

/** The tiles under the search box. */
export const POPULAR_KEYS = ['family', 'cardiology', 'psychiatry', 'pediatrics', 'dermatology', 'ortho', 'eye', 'obgyn']

export const KIND_LABEL: Record<FinderKind, string> = { doctors: 'Doctors', pharmacy: 'Pharmacies', urgent: 'Urgent care' }

export function specialtyLabel(key: string): string {
  return SPECIALTIES.find((s) => s.key === key)?.label ?? 'Doctors'
}

/** Plural noun for the results heading: "37 cardiologists", "12 pharmacies". */
export function resultNoun(kind: FinderKind, specialtyKey: string, n: number): string {
  if (kind === 'pharmacy') return n === 1 ? 'pharmacy' : 'pharmacies'
  if (kind === 'urgent') return n === 1 ? 'urgent care clinic' : 'urgent care clinics'
  const label = specialtyLabel(specialtyKey).replace(/\s*\(.*\)$/, '')
  if (specialtyKey === 'all') return n === 1 ? 'provider' : 'providers'
  if (/doctor$/i.test(label)) return n === 1 ? 'family doctor' : 'family doctors'
  if (/medicine$/i.test(label)) return n === 1 ? 'internist' : 'internists'
  if (/y$/i.test(label) && !/ay$/i.test(label)) return n === 1 ? label.toLowerCase() : `${label.slice(0, -1).toLowerCase()}ies`
  return n === 1 ? label.toLowerCase() : `${label.toLowerCase()}s`
}

export interface Taxonomy {
  desc: string
  state: string
  license: string
  primary: boolean
}

export interface Provider {
  npi: string
  name: string
  last: string
  credential: string
  specialty: string
  organisation: boolean
  taxonomies: Taxonomy[]
  gender: string
  since: string
  address: string
  city: string
  state: string
  zip: string
  phone: string
  distanceMiles: number | null
  lat: number | null
  lon: number | null
}

export interface Origin {
  lat: number
  lon: number
  label: string
  zip: string
}

export interface SearchResponse {
  origin: Origin | null
  results: Provider[]
  count: number
}

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

export interface GoogleDetails {
  place_id: string
  name: string
  address: string
  rating: number | null
  ratings_count: number | null
  website: string
  phone: string
  maps_url: string
  open_now: boolean | null
  hours: string[]
  lat: number | null
  lon: number | null
  status: string
}

export interface ProviderDetails {
  provider: Provider
  cms: CmsDetails | null
  google: GoogleDetails | null
  extras_pending: boolean
}

export interface ProviderExtras {
  cms: CmsDetails | null
  google: GoogleDetails | null
}

export interface Position {
  lat: number
  lon: number
  approx: boolean
}

export interface CityHit {
  city: string
  state: string
  zips: number
}

export type SearchQuery =
  | { kind: FinderKind; specialty: string; mode: 'zip'; zip: string }
  | { kind: FinderKind; specialty: string; mode: 'city'; city: string; state: string }
  | { kind: FinderKind; specialty: string; mode: 'near'; lat: number; lon: number }
  | { kind: FinderKind; specialty: string; mode: 'name'; last: string; first: string; state: string }

export class ProviderApiError extends Error {}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new ProviderApiError((body && typeof body.detail === 'string' && body.detail) || 'The provider directory is not responding. Try again in a minute.')
  }
  return res.json() as Promise<T>
}

export function searchParamsFor(q: SearchQuery): URLSearchParams {
  const p = new URLSearchParams({ kind: q.kind, specialty: q.specialty })
  if (q.mode === 'zip') p.set('zip', q.zip)
  else if (q.mode === 'city') {
    p.set('city', q.city)
    p.set('state', q.state)
  } else if (q.mode === 'near') {
    p.set('lat', q.lat.toFixed(5))
    p.set('lon', q.lon.toFixed(5))
  } else {
    p.set('last', q.last)
    if (q.first) p.set('first', q.first)
    if (q.state) p.set('state', q.state)
  }
  return p
}

export function searchProviders(q: SearchQuery, signal?: AbortSignal): Promise<SearchResponse> {
  return getJson<SearchResponse>(`/api/providers/search?${searchParamsFor(q).toString()}`, signal)
}

export function suggestCities(q: string, signal?: AbortSignal): Promise<CityHit[]> {
  return getJson<{ cities: CityHit[] }>(`/api/providers/cities?q=${encodeURIComponent(q)}`, signal).then((r) => r.cities)
}

export async function geocodeProviders(items: Provider[], signal?: AbortSignal): Promise<Record<string, Position>> {
  const res = await fetch('/api/providers/geocode', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ items: items.slice(0, 100).map((d) => ({ npi: d.npi, address: d.address, city: d.city, state: d.state, zip: d.zip })) }),
  })
  if (!res.ok) return {}
  const data = (await res.json()) as { positions?: Record<string, Position> }
  return data.positions ?? {}
}

export function providerDetails(npi: string, signal?: AbortSignal): Promise<ProviderDetails> {
  return getJson<ProviderDetails>(`/api/providers/${npi}`, signal)
}

export function providerExtras(npi: string, signal?: AbortSignal): Promise<ProviderExtras> {
  return getJson<ProviderExtras>(`/api/providers/${npi}/extras`, signal)
}

export function formatMiles(miles: number): string {
  if (miles < 0.1) return '< 0.1 mi'
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`
}

export function telHref(phone: string): string {
  return `tel:${phone.replace(/\D/g, '')}`
}

export function directionsHref(d: Pick<Provider, 'address' | 'city' | 'state' | 'zip'>): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${d.address}, ${d.city}, ${d.state} ${d.zip}`)}`
}

export function isValidZip(s: string): boolean {
  return /^\d{5}$/.test(s.trim())
}

/** Initials for the avatar circle: "Anita Raman" → "AR", "Walgreens #123" → "W". */
export function initials(name: string): string {
  const parts = name.replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).filter(Boolean)
  return parts.length >= 2 ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase() : (parts[0]?.[0] ?? '?').toUpperCase()
}

/** "Today: 8 AM – 5 PM" from Google's weekdayDescriptions (Monday first). */
export function todaysHours(hours: string[]): string | null {
  if (!hours.length) return null
  const idx = (new Date().getDay() + 6) % 7 // Monday = 0
  const line = hours[idx] ?? hours[0]
  return line.replace(/^[A-Za-z]+:\s*/, '')
}
