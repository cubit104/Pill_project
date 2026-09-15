/**
 * FDA recalls and safety alerts from openFDA's drug enforcement feed (free, no
 * key at our volume, allows browser calls). Same parsing and queries as the
 * app's mobile/src/lib/recalls.ts; keep the two in step.
 *
 * Three uses on the site:
 *   - pill page section: recalls for that drug in the last 12 months (fetched on
 *     the server, cached a day per drug),
 *   - /recalls: search any medicine, plus the latest recalls nationwide,
 *   - the cabinet: a check of every saved pill in the browser, with a banner.
 */

export const OPENFDA = 'https://api.fda.gov/drug/enforcement.json'
/** How far back a "recent" recall reaches. */
export const LOOKBACK_DAYS = 365
const TIMEOUT_MS = 15_000
const CACHE_MS = 24 * 60 * 60 * 1000

export type RecallClass = 'I' | 'II' | 'III' | ''

export interface Recall {
  /** FDA recall number, e.g. D-1234-2025 (unique per product recalled). */
  id: string
  cls: RecallClass
  /** ISO date, YYYY-MM-DD. */
  date: string
  firm: string
  product: string
  lots: string
  reason: string
  status: string
  /** Product NDCs the FDA linked to this recall (labeler-product, e.g. 68462-520). */
  ndcs: string[]
  /** True when one of those NDCs is the searched pill's own product. */
  exact: boolean
}

export class RecallError extends Error {}

export function classOf(raw: unknown): RecallClass {
  const m = /class\s+(III|II|I)\b/i.exec(String(raw ?? ''))
  return m ? (m[1]!.toUpperCase() as RecallClass) : ''
}

export function classText(cls: RecallClass): string {
  if (cls === 'I') return 'Class I: could cause serious harm or death'
  if (cls === 'II') return 'Class II: could cause temporary or reversible harm'
  if (cls === 'III') return 'Class III: unlikely to cause harm'
  return 'Recall'
}

function digits(s: unknown): string {
  return String(s ?? '').replace(/\D/g, '')
}

/** 20250416 -> 2025-04-16 */
export function isoDate(yyyymmdd: unknown): string {
  const d = digits(yyyymmdd)
  return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : ''
}

/** 2025-04-16 -> "Apr 16, 2025" */
export function prettyDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * The pill's product NDC in the labeler-product form openFDA uses. Prefer the
 * 11-digit code (5-4-2): labeler + product. Otherwise take ndc9 as given.
 */
export function productNdc(pill: { ndc9?: string | null; ndc11?: string | null; ndc?: string | null }): string | null {
  const d11 = digits(pill.ndc11)
  if (d11.length === 11) return `${d11.slice(0, 5)}-${d11.slice(5, 9)}`
  const ndc9 = (pill.ndc9 ?? '').trim()
  if (/^\d{4,5}-\d{3,4}$/.test(ndc9)) return ndc9
  const d = digits(pill.ndc9) || digits(pill.ndc)
  if (d.length >= 9) return `${d.slice(0, 5)}-${d.slice(5, 9)}`
  return null
}

/** Normalise labeler-product codes to 5+4 digits so "68462-520" and "68462-0520" are the same product. */
export function normNdc9(s: string): string {
  const m = /^(\d{4,5})-(\d{3,4})$/.exec(s.trim())
  return m ? m[1]!.padStart(5, '0') + m[2]!.padStart(4, '0') : digits(s)
}

/** Every spelling the FDA might have stored for this product code. */
export function ndcVariants(ndc: string): string[] {
  const m = /^(\d{4,5})-(\d{3,4})$/.exec(ndc.trim())
  if (!m) return [ndc]
  const L = m[1]!
  const P = m[2]!
  const labelers = new Set([L.padStart(5, '0'), L.length === 5 && L.startsWith('0') ? L.slice(1) : L])
  const products = new Set([P.padStart(4, '0'), P.length === 4 && P.startsWith('0') ? P.slice(1) : P])
  const out: string[] = []
  for (const l of labelers) for (const p of products) out.push(`${l}-${p}`)
  return out
}

/** One row of the feed -> Recall; rows without a product description are skipped. */
export function parseRecalls(json: unknown, ownNdc: string | null = null): Recall[] {
  const results = (json as { results?: unknown[] } | null)?.results
  if (!Array.isArray(results)) return []
  const own = ownNdc ? normNdc9(ownNdc) : ''
  const out: Recall[] = []
  const seen = new Set<string>()
  for (const raw of results) {
    const r = raw as Record<string, unknown>
    const product = String(r.product_description ?? '').trim()
    const id = String(r.recall_number ?? '') || `${String(r.event_id ?? '')}:${product.slice(0, 40)}`
    if (!product || seen.has(id)) continue
    seen.add(id)
    const openfda = (r.openfda ?? {}) as { product_ndc?: unknown }
    const ndcs = Array.isArray(openfda.product_ndc) ? openfda.product_ndc.map(String) : []
    out.push({
      id,
      cls: classOf(r.classification),
      date: isoDate(r.report_date) || isoDate(r.recall_initiation_date),
      firm: String(r.recalling_firm ?? '').trim(),
      product,
      lots: String(r.code_info ?? '').trim(),
      reason: String(r.reason_for_recall ?? '').trim(),
      status: String(r.status ?? '').trim(),
      ndcs,
      exact: own !== '' && ndcs.some((n) => normNdc9(n) === own),
    })
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || Number(b.exact) - Number(a.exact))
}

function yyyymmdd(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

/** openFDA range clause for the lookback window. */
export function dateRange(now = new Date(), days = LOOKBACK_DAYS): string {
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  return `report_date:[${yyyymmdd(from)}+TO+${yyyymmdd(now)}]`
}

function phrase(field: string, value: string): string {
  return `${field}:%22${encodeURIComponent(value.trim())}%22`
}

function firstWord(name: string): string {
  return name.trim().split(/[\s,(]+/)[0] ?? name.trim()
}

/** Search clauses for one drug: its exact product NDC (when known) and its name. */
export function drugQueries(name: string, ndc: string | null, now = new Date()): string[] {
  const range = dateRange(now)
  const q: string[] = []
  if (ndc) q.push(`(${ndcVariants(ndc).map((v) => phrase('openfda.product_ndc', v)).join('+OR+')})+AND+${range}`)
  const n = name.trim()
  if (n) {
    const word = firstWord(n)
    const stem = word.replace(/[^A-Za-z0-9]/g, '')
    const wild = stem.length >= 4 ? `+OR+product_description:${stem}*` : ''
    q.push(`(${phrase('openfda.generic_name', n)}+OR+${phrase('openfda.brand_name', n)}+OR+${phrase('product_description', word)}${wild})+AND+${range}`)
  }
  return q
}

async function fetchFeed(search: string, limit: number, signal?: AbortSignal, timeoutMs = TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    const res = await fetch(`${OPENFDA}?search=${search}&sort=report_date:desc&limit=${limit}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      // On the server (pill pages) Next caches the answer for a day; browsers ignore this field.
      next: { revalidate: 86400 },
    } as RequestInit)
    if (res.status === 404) return { results: [] } // openFDA's way of saying "no matches"
    if (!res.ok) throw new RecallError('The FDA recall service is not responding. Try again later.')
    return await res.json()
  } catch (err) {
    if (err instanceof RecallError) throw err
    throw new RecallError('Could not reach the FDA recall service. Check your connection and try again.')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

const memo = new Map<string, { at: number; rows: Recall[] }>()

/** Recalls for one drug in the last 12 months, newest first; cached for a day in this process. */
export async function recallsForDrug(name: string, ndc: string | null, signal?: AbortSignal, timeoutMs = TIMEOUT_MS): Promise<Recall[]> {
  const key = `${name.trim().toLowerCase()}|${ndc ?? ''}`
  const hit = memo.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows
  const queries = drugQueries(name, ndc)
  if (queries.length === 0) return []
  const pages = await Promise.all(queries.map((q) => fetchFeed(q, 50, signal, timeoutMs)))
  const merged = new Map<string, Recall>()
  for (const page of pages) for (const r of parseRecalls(page, ndc)) if (!merged.has(r.id) || r.exact) merged.set(r.id, r)
  const rows = [...merged.values()].sort((a, b) => b.date.localeCompare(a.date) || Number(b.exact) - Number(a.exact))
  memo.set(key, { at: Date.now(), rows })
  return rows
}

/** The newest recalls nationwide. */
export async function latestRecalls(limit = 20, signal?: AbortSignal): Promise<Recall[]> {
  const key = `__latest__${limit}`
  const hit = memo.get(key)
  if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.rows
  const rows = parseRecalls(await fetchFeed(dateRange(), limit, signal))
  memo.set(key, { at: Date.now(), rows })
  return rows
}

/** Server-side page render: how long a pill page waits for the FDA before going out without the section. */
const SSR_TIMEOUT_MS = 4000

/**
 * For pill pages: recalls, or undefined when the FDA did not answer in time, so the
 * page omits the section instead of claiming "no recalls". Never throws, never
 * holds the page for more than a few seconds; the answer is cached a day by Next.
 */
export async function recallsForDrugSafe(name: string, ndc: string | null): Promise<Recall[] | undefined> {
  try {
    return await recallsForDrug(name, ndc, undefined, SSR_TIMEOUT_MS)
  } catch {
    return undefined
  }
}

export interface CabinetPillForRecalls {
  slug: string
  name: string
  generic?: string | null
  ndc?: string | null
}

/** Recalls per cabinet pill (slug -> recalls). Pills that fail to load are skipped. */
export async function checkCabinet(pills: CabinetPillForRecalls[]): Promise<Record<string, Recall[]>> {
  const out: Record<string, Recall[]> = {}
  const settled = await Promise.allSettled(pills.map((p) => recallsForDrug((p.generic || p.name || '').trim(), p.ndc ?? null)))
  settled.forEach((r, i) => {
    const p = pills[i]
    if (p && r.status === 'fulfilled' && r.value.length > 0) out[p.slug] = r.value
  })
  return out
}
