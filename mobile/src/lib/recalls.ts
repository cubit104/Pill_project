/**
 * FDA recalls and safety alerts, from openFDA's drug enforcement feed (free,
 * no key at our volume, allows browser calls). Three uses:
 *   - a pill page section: recalls for that drug in the last 12 months,
 *   - the FDA alerts page: search any drug, plus the latest recalls nationwide,
 *   - the cabinet: a daily check of every pill, a badge, and one notification
 *     per new recall (seen ones are remembered on the phone).
 * Pure parsing and query building are unit-tested; the network parts are thin.
 */
import { LocalNotifications } from '@capacitor/local-notifications'
import { Preferences } from '@capacitor/preferences'
import { useEffect, useSyncExternalStore } from 'react'
import { useAccount } from './account'
import { ApiError, type PillDetail } from './api'
import { tr } from './i18n'
import { isNative } from './native'

export const OPENFDA = 'https://api.fda.gov/drug/enforcement.json'
/** How far back a "recent" recall reaches. */
export const LOOKBACK_DAYS = 365
const TIMEOUT_MS = 15_000
const CACHE_MS = 24 * 60 * 60 * 1000
const KEY_SEEN = 'recalls.seen'
/** Notification ids, outside the reminder planner's windows (see lib/reminders.ts). */
const NOTIFY_FIRST = 700_000 + 300_000
const NOTIFY_SPAN = 10_000

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

export function classOf(raw: unknown): RecallClass {
  const m = /class\s+(III|II|I)\b/i.exec(String(raw ?? ''))
  return m ? (m[1]!.toUpperCase() as RecallClass) : ''
}

/** English keys, rendered through t(). */
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

/**
 * NDC labeler-product codes come in 4-4, 5-3 and 5-4 widths; the FDA keeps the
 * labeler's own spelling. Normalise to 5+4 digits so "68462-520" and
 * "68462-0520" are the same product.
 */
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
  // Labelers are 4 or 5 digits, products 3 or 4: drop a leading zero only when the shorter form is still valid.
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
  // Newest first; exact product matches ahead of same-drug ones on the same day.
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

/** The drug's first word is what appears in free-text product descriptions ("Metformin HCl ER 500mg"). */
function firstWord(name: string): string {
  return name.trim().split(/[\s,(]+/)[0] ?? name.trim()
}

/**
 * Search clauses for one drug: its exact product NDC (when known) and its
 * name, both in the FDA's structured fields and in the free-text description
 * (older recalls lack the structured mapping).
 */
export function drugQueries(name: string, ndc: string | null, now = new Date()): string[] {
  const range = dateRange(now)
  const q: string[] = []
  if (ndc) q.push(`(${ndcVariants(ndc).map((v) => phrase('openfda.product_ndc', v)).join('+OR+')})+AND+${range}`)
  const n = name.trim()
  if (n) {
    const word = firstWord(n)
    q.push(`(${phrase('openfda.generic_name', n)}+OR+${phrase('openfda.brand_name', n)}+OR+${phrase('product_description', word)})+AND+${range}`)
  }
  return q
}

async function fetchFeed(search: string, limit: number, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    const res = await fetch(`${OPENFDA}?search=${search}&sort=report_date:desc&limit=${limit}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (res.status === 404) return { results: [] } // openFDA's way of saying "no matches"
    if (!res.ok) throw new ApiError('server', 'The FDA recall service is not responding. Try again later.')
    return await res.json()
  } catch (err) {
    if (err instanceof ApiError) throw err
    throw new ApiError('unknown', 'Could not reach the FDA recall service. Check your connection and try again.', { retryable: true })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

const memo = new Map<string, { at: number; rows: Recall[] }>()

/** Recalls for one drug in the last 12 months, newest first; cached for a day. */
export async function recallsForDrug(name: string, ndc: string | null, signal?: AbortSignal): Promise<Recall[]> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError('offline', 'No internet connection. Reconnect and try again.')
  }
  const key = `${name.trim().toLowerCase()}|${ndc ?? ''}`
  const hit = memo.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows
  const queries = drugQueries(name, ndc)
  const pages = await Promise.all(queries.map((q) => fetchFeed(q, 50, signal)))
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

// ---- Cabinet watch --------------------------------------------------------------

export function drugNameOf(pill: PillDetail): string {
  return (pill.generic_name || pill.drug_name || '').trim()
}

/** Recalls per cabinet pill (slug -> recalls). Pills that fail to load are skipped. */
export async function checkCabinet(pills: PillDetail[]): Promise<Record<string, Recall[]>> {
  const out: Record<string, Recall[]> = {}
  const settled = await Promise.allSettled(pills.map((p) => recallsForDrug(drugNameOf(p), productNdc(p))))
  settled.forEach((r, i) => {
    const p = pills[i]
    if (p && r.status === 'fulfilled' && r.value.length > 0) out[p.slug] = r.value
  })
  return out
}

export async function loadSeen(): Promise<Set<string>> {
  try {
    const { value } = await Preferences.get({ key: KEY_SEEN })
    const arr = value ? (JSON.parse(value) as unknown) : []
    return new Set(Array.isArray(arr) ? arr.map(String) : [])
  } catch {
    return new Set()
  }
}

export async function saveSeen(ids: Set<string>): Promise<void> {
  try {
    await Preferences.set({ key: KEY_SEEN, value: JSON.stringify([...ids].slice(-500)) })
  } catch {
    /* ignore */
  }
}

/** Recall ids in `bySlug` the phone has not alerted about yet. */
export function newRecallIds(bySlug: Record<string, Recall[]>, seen: Set<string>): string[] {
  const ids = new Set<string>()
  for (const list of Object.values(bySlug)) for (const r of list) if (!seen.has(r.id)) ids.add(r.id)
  return [...ids]
}

function hashId(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return NOTIFY_FIRST + (h % NOTIFY_SPAN)
}

/** One local notification per new recall; returns how many were scheduled. */
export async function notifyNewRecalls(bySlug: Record<string, Recall[]>, pills: Record<string, PillDetail>): Promise<number> {
  const seen = await loadSeen()
  const fresh = new Set(newRecallIds(bySlug, seen))
  if (fresh.size === 0) return 0
  const list = []
  const at = new Date(Date.now() + 5_000)
  for (const [slug, recalls] of Object.entries(bySlug)) {
    const name = pills[slug]?.drug_name ?? slug
    for (const r of recalls) {
      if (!fresh.has(r.id)) continue
      list.push({
        id: hashId(r.id),
        title: tr('Recall: {name}', { name }),
        body: [r.firm, r.reason].filter(Boolean).join(': ') || tr('Check the lot numbers on your bottle.'),
        schedule: { at, allowWhileIdle: true },
        extra: { kind: 'recall', slug },
      })
    }
  }
  for (const id of fresh) seen.add(id)
  await saveSeen(seen)
  if (!isNative() || list.length === 0) return 0
  try {
    await LocalNotifications.schedule({ notifications: list })
  } catch {
    return 0
  }
  return list.length
}

// ---- Shared store: one check per app open, read by Home, Cabinet and the alerts page ----

export interface CabinetRecalls {
  bySlug: Record<string, Recall[]>
  /** When the last check finished, ms since epoch; null before the first. */
  checkedAt: number | null
  checking: boolean
}

let state: CabinetRecalls = { bySlug: {}, checkedAt: null, checking: false }
/** Which pills the last check covered, so adding a pill triggers a new check. */
let checkedKey = ''
const listeners = new Set<() => void>()
let inFlight: Promise<void> | null = null

function setState(next: Partial<CabinetRecalls>): void {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Run the cabinet check (at most once a day unless forced); safe to call often. */
export function refreshCabinetRecalls(pills: Record<string, PillDetail>, slugs: string[], force = false): Promise<void> {
  if (inFlight) return inFlight
  const ready = slugs.map((s) => pills[s]).filter((p): p is PillDetail => Boolean(p))
  if (ready.length === 0) {
    if (slugs.length === 0 && Object.keys(state.bySlug).length > 0) setState({ bySlug: {}, checkedAt: Date.now() })
    return Promise.resolve()
  }
  const key = ready.map((p) => p.slug).sort().join('|')
  if (!force && state.checkedAt !== null && Date.now() - state.checkedAt < CACHE_MS && key === checkedKey) {
    return Promise.resolve()
  }
  setState({ checking: true })
  inFlight = checkCabinet(ready)
    .then(async (bySlug) => {
      checkedKey = key
      setState({ bySlug, checkedAt: Date.now(), checking: false })
      await notifyNewRecalls(bySlug, pills)
    })
    .catch(() => setState({ checking: false }))
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

/** Cabinet recall status, kept fresh once per day while the app is open. */
export function useCabinetRecalls(): CabinetRecalls & { total: number; affected: string[] } {
  const account = useAccount()
  const snap = useSyncExternalStore(subscribe, () => state, () => state)
  const slugs = account.items.map((i) => i.slug)
  const loaded = slugs.every((s) => Boolean(account.pills[s]))
  useEffect(() => {
    if (!account.enabled || !loaded) return
    void refreshCabinetRecalls(account.pills, slugs)
    // slugs is derived from items; pills changes when details arrive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.enabled, loaded, slugs.join('|'), account.pills])
  const affected = Object.keys(snap.bySlug).filter((s) => slugs.includes(s))
  const total = affected.reduce((n, s) => n + (snap.bySlug[s]?.length ?? 0), 0)
  return { ...snap, total, affected }
}
