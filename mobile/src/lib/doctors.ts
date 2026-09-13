/**
 * Find a doctor: the free NPPES NPI Registry (CMS), the official list of every
 * US clinician and health organisation. No key, no cost. Searched by specialty
 * plus ZIP; results carry name, specialty, practice address and phone.
 *
 * Natively the call goes through CapacitorHttp (no CORS in the WebView); on the
 * web it falls back to fetch.
 */
import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { ApiError } from './api'

export const NPI_API = 'https://npiregistry.cms.hhs.gov/api/'
const TIMEOUT_MS = 15_000
const KEY_DOCTOR_ZIP = 'doctors.zip'

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
}

export const SPECIALTIES: Specialty[] = [
  { key: 'family', label: 'Family doctor', taxonomy: 'Family Medicine', match: /Family/, kind: 'NPI-1' },
  { key: 'internal', label: 'Internal medicine', taxonomy: 'Internal Medicine', match: /^Internal Medicine/, kind: 'NPI-1' },
  { key: 'pediatrics', label: 'Pediatrician', taxonomy: 'Pediatrics', match: /Pediatric/, kind: 'NPI-1' },
  { key: 'obgyn', label: 'OB/GYN', taxonomy: 'Obstetrics & Gynecology', match: /Obstetric|Gynecolog/, kind: 'NPI-1' },
  { key: 'cardiology', label: 'Cardiologist', taxonomy: 'Cardiovascular Disease', match: /Cardiovascular|Cardiolog/, kind: 'NPI-1' },
  { key: 'dermatology', label: 'Dermatologist', taxonomy: 'Dermatology', match: /Dermatolog/, kind: 'NPI-1' },
  { key: 'psychiatry', label: 'Psychiatrist', taxonomy: 'Psychiatry', match: /^Psychiatry$|,\s*[^,]*Psychiatry[^,]*$/, kind: 'NPI-1' },
  { key: 'eye', label: 'Eye doctor', taxonomy: 'Ophthalmology', match: /Ophthalmolog/, kind: 'NPI-1' },
  { key: 'dentist', label: 'Dentist', taxonomy: 'Dentist*', match: /Dentist/, kind: 'NPI-1' },
  { key: 'urgent', label: 'Urgent care', taxonomy: 'Urgent Care', match: /Urgent Care/, kind: 'NPI-2' },
  { key: 'pharmacy', label: 'Pharmacy', taxonomy: 'Pharmacy*', match: /Pharmac/, kind: 'NPI-2' },
]

/** Keep only rows whose primary specialty is the one asked for. */
export function filterBySpecialty(rows: Doctor[], sp: Specialty): Doctor[] {
  return rows.filter((d) => !d.specialty || sp.match.test(d.specialty))
}

export interface Doctor {
  npi: string
  name: string
  credential: string
  specialty: string
  address: string
  city: string
  state: string
  zip: string
  phone: string
  organisation: boolean
}

export function isValidZip(zip: string): boolean {
  return /^\d{5}$/.test(zip.trim())
}

/** Digits only, for tel: links. */
export function telUrl(phone: string): string {
  return `tel:${phone.replace(/\D/g, '')}`
}

export function mapsUrl(d: Doctor, platform: 'ios' | 'android' | 'web'): string {
  const q = encodeURIComponent(`${d.address}, ${d.city}, ${d.state} ${d.zip}`)
  if (platform === 'ios') return `https://maps.apple.com/?q=${q}`
  if (platform === 'android') return `geo:0,0?q=${q}`
  return `https://www.google.com/maps/search/?api=1&query=${q}`
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bMd\b/g, 'MD')
    .replace(/\bDo\b/g, 'DO')
}

/** NPPES returns 9-digit ZIPs without a dash; show the 5-digit part. */
function shortZip(zip: string): string {
  const digits = (zip || '').replace(/\D/g, '')
  return digits.slice(0, 5)
}

/**
 * Turn one NPPES search response into display rows. Pure, so it is unit-tested:
 * prefers the practice (LOCATION) address, drops entries without one, title-cases
 * the shouted names, and dedupes by NPI.
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
    const loc = addresses.find((a) => a.address_purpose === 'LOCATION') ?? addresses[0]
    if (!loc || !loc.address_1) continue
    const basic = r.basic ?? {}
    const organisation = r.enumeration_type === 'NPI-2'
    const orgName = String(basic.organization_name ?? basic.name ?? '')
    const person = [basic.first_name, basic.last_name].filter(Boolean).map(String).join(' ')
    const name = titleCase(organisation ? orgName || person : person || orgName)
    if (!name.trim()) continue
    const taxonomies = r.taxonomies ?? []
    const primary = taxonomies.find((t) => t.primary === true) ?? taxonomies[0]
    seen.add(npi)
    out.push({
      npi,
      name,
      credential: String(basic.credential ?? '').replace(/\./g, '').toUpperCase(),
      specialty: String(primary?.desc ?? ''),
      address: titleCase([loc.address_1, loc.address_2].filter(Boolean).map(String).join(', ')),
      city: titleCase(String(loc.city ?? '')),
      state: String(loc.state ?? ''),
      zip: shortZip(String(loc.postal_code ?? '')),
      phone: String(loc.telephone_number ?? ''),
      organisation,
    })
  }
  return out
}

export interface DoctorQuery {
  specialty: Specialty
  zip: string
}

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

/** Matches for a specialty near a 5-digit ZIP (ZIP+4 entries included). */
export async function searchDoctors(q: DoctorQuery, signal?: AbortSignal): Promise<Doctor[]> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError('offline', 'No internet connection. Reconnect and try again.')
  }
  if (!isValidZip(q.zip)) throw new ApiError('bad_request', 'Enter a 5-digit ZIP code.', { retryable: false })
  const params = {
    version: '2.1',
    taxonomy_description: q.specialty.taxonomy,
    postal_code: `${q.zip.trim()}*`,
    enumeration_type: q.specialty.kind,
    limit: '100',
  }
  try {
    const json = await fetchJson(NPI_API, params, signal)
    const errors = (json as { Errors?: Array<{ description?: string }> } | null)?.Errors
    if (Array.isArray(errors) && errors.length > 0) {
      throw new ApiError('server', errors[0]?.description ?? 'The doctor directory rejected the search.')
    }
    return filterBySpecialty(parseNpiResponse(json), q.specialty)
  } catch (err) {
    if (err instanceof ApiError) throw err
    throw new ApiError('unknown', 'Could not reach the doctor directory. Check your connection and try again.', { retryable: true })
  }
}

export async function loadDoctorZip(): Promise<string> {
  try {
    const { value } = await Preferences.get({ key: KEY_DOCTOR_ZIP })
    return value ?? ''
  } catch {
    return ''
  }
}

export async function saveDoctorZip(zip: string): Promise<void> {
  try {
    await Preferences.set({ key: KEY_DOCTOR_ZIP, value: zip })
  } catch {
    /* ignore */
  }
}
