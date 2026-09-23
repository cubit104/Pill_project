/**
 * Drug shortages from openFDA's shortage feed, for the injection drug screen. Same reading of the feed as the
 * website (frontend/app/lib/shortages.ts): the FDA keeps a drug "Current" on the list even when every listed
 * product is available again, so the screen says how many presentations are limited or unavailable instead of
 * just "in shortage". Fetched straight from the FDA like the recalls (lib/recalls.ts), remembered for a day.
 */

export const OPENFDA_SHORTAGES = 'https://api.fda.gov/drug/shortages.json'
export const FDA_SHORTAGE_PAGE = 'https://www.accessdata.fda.gov/scripts/drugshortages/default.cfm'
const TIMEOUT_MS = 4000 // the screen never waits longer than this for the FDA
const CACHE_MS = 24 * 60 * 60 * 1000

export type Availability = 'available' | 'limited' | 'unavailable' | 'unknown'

export interface ShortageItem {
  presentation: string
  company: string
  availability: Availability
}

export interface Shortage {
  /** ISO date the FDA first posted it. */
  since: string
  /** ISO date of the newest update among the listed presentations. */
  updated: string
  items: ShortageItem[]
  /** How many of the items are limited or unavailable right now. */
  constrained: number
  /** How many are reported available; the rest of the unconstrained ones carry a status this code could not read. */
  available: number
}

/** '11/14/2017' -> '2017-11-14' ('' when the FDA sent something else). */
export function isoFromUsDate(value: unknown): string {
  const m = typeof value === 'string' ? value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/) : null
  if (!m) return ''
  const [, month = '', day = '', year = ''] = m
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

export function availabilityOf(raw: unknown): Availability {
  const text = typeof raw === 'string' ? raw.toLowerCase() : ''
  if (text.includes('unavailable')) return 'unavailable'
  if (text.includes('limited')) return 'limited'
  if (text.includes('available')) return 'available'
  return 'unknown'
}

/** openFDA search for one drug's current shortage records. */
export function shortageQuery(name: string): string {
  const clean = name.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim()
  return clean ? encodeURIComponent(`generic_name:"${clean}" AND status:"Current"`) : ''
}

/** Current injectable shortage records of one drug, or null when there are none. */
export function parseShortage(json: unknown): Shortage | null {
  const results = (json as { results?: unknown })?.results
  if (!Array.isArray(results)) return null
  const items: ShortageItem[] = []
  let since = ''
  let updated = ''
  for (const row of results as Array<Record<string, unknown>>) {
    if (row.status !== 'Current') continue
    const routes = ((row.openfda as { route?: unknown })?.route ?? []) as unknown[]
    const injectable = /inject|infus/i.test(String(row.dosage_form ?? '')) || routes.some((r) => /intravenous/i.test(String(r)))
    if (!injectable) continue // the tablets of the same drug running short is not this screen's business
    items.push({
      presentation: String(row.presentation ?? '').replace(/\s*\(NDC [^)]*\)\s*$/i, '').trim(),
      company: String(row.company_name ?? '').trim(),
      availability: availabilityOf(row.availability),
    })
    const posted = isoFromUsDate(row.initial_posting_date)
    if (posted && (!since || posted < since)) since = posted
    const changed = isoFromUsDate(row.update_date)
    if (changed > updated) updated = changed
  }
  if (items.length === 0) return null
  const rank: Record<Availability, number> = { unavailable: 0, limited: 1, unknown: 2, available: 3 }
  items.sort((a, b) => rank[a.availability] - rank[b.availability] || a.presentation.localeCompare(b.presentation))
  const count = (...wanted: Availability[]) => items.filter((i) => wanted.includes(i.availability)).length
  return { since, updated, items, constrained: count('unavailable', 'limited'), available: count('available') }
}

const memo = new Map<string, { at: number; value: Shortage | null }>()

/**
 * `null` = not on the shortage list; `undefined` = the FDA did not answer in time, so the screen leaves the
 * line out instead of claiming "no shortage". Never throws.
 */
export async function shortageForDrug(name: string, signal?: AbortSignal): Promise<Shortage | null | undefined> {
  const query = shortageQuery(name)
  if (!query) return null
  const key = name.trim().toLowerCase()
  const hit = memo.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const onOuterAbort = () => controller.abort()
  signal?.addEventListener('abort', onOuterAbort)
  try {
    const res = await fetch(`${OPENFDA_SHORTAGES}?search=${query}&limit=100`, { headers: { Accept: 'application/json' }, signal: controller.signal })
    let value: Shortage | null
    if (res.status === 404) value = null // openFDA's way of saying "no matches"
    else if (!res.ok) return undefined
    else value = parseShortage(await res.json())
    memo.set(key, { at: Date.now(), value })
    return value
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onOuterAbort)
  }
}
