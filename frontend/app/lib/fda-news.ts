/**
 * "Latest from the FDA": the newest drug recall, new drug approval and drug shortage, from the free openFDA
 * feeds (no key needed at our volume) plus fda.gov's same-day notices (lib/fda-announcements.ts). The home
 * page shows one of each, /fda-news lists the recent ones, and every item has a short PillSeek page with the
 * FDA's own facts.
 *
 * Everything is fetched on the server and cached a day by Next, the same way lib/recalls.ts and
 * lib/shortages.ts work. A feed that does not answer in time is left out; nothing here throws into a page.
 * Headlines are built from the FDA fields with fixed rules (no guessing), and the detail pages always show
 * the FDA's full wording next to them.
 */
import {
  approvalCandidates,
  firstMatches,
  novelDrugId,
  novelDrugs,
  readAnnouncement,
  recallNotices,
  type FdaAnnouncement,
  type FdaNotice,
  type NovelDrug,
} from './fda-announcements'
import type { FdaNewsSwitches } from './fda-news-switches'
import { OPENFDA, classOf, dateRange, isoDate, type RecallClass } from './recalls'
import { OPENFDA_SHORTAGES, availabilityOf, isoFromUsDate, shortageQuery, type Availability } from './shortages'

export const OPENFDA_DRUGSFDA = 'https://api.fda.gov/drug/drugsfda.json'
export const OPENFDA_LABEL = 'https://api.fda.gov/drug/label.json'
export const FDA_RECALLS_PAGE = 'https://www.accessdata.fda.gov/scripts/ires/index.cfm'
export const FDA_NOVEL_APPROVALS_PAGE = 'https://www.fda.gov/drugs/development-approval-process-drugs/novel-drug-approvals-fda'
const TIMEOUT_MS = 4000 // a page never waits longer than this for the FDA
const DAY_MS = 24 * 60 * 60 * 1000
/** Recalls and new approvals from the last 60 days; for approvals this window fits in one openFDA page. */
export const WINDOW_DAYS = 60
const PAGE = 100 // openFDA rows per request

export type FdaNewsKind = 'recall' | 'approval' | 'shortage'

export interface FdaNewsItem {
  kind: FdaNewsKind
  /** The item's page on PillSeek. */
  href: string
  /** ISO date the FDA posted it. */
  date: string
  headline: string
  /** Short status line, e.g. "Class I · Most serious". */
  tag: string
}

/** openFDA JSON; `null` when openFDA says "no matches" (its 404), `undefined` when it did not answer in time. */
async function getJson(url: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      next: { revalidate: 86400 },
    } as RequestInit)
    if (res.status === 404) return null
    if (!res.ok) return undefined
    return await res.json()
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

function rowsOf(json: unknown): Array<Record<string, unknown>> {
  const results = (json as { results?: unknown } | null)?.results
  return Array.isArray(results) ? (results as Array<Record<string, unknown>>) : []
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').replace(/,\s*,/g, ',').trim() : ''
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : []
}

// ---------------------------------------------------------------- wording

const KEEP_UPPER = new Set(['USA', 'US', 'UK', 'LLC', 'LP', 'NJ', 'NY', 'CA', 'II', 'III', 'IV', 'HCL', 'NDC', 'USP', 'SPF'])

/**
 * FDA names often come in capitals: "OPTIMAL BALANCE PHARMACY" -> "Optimal Balance Pharmacy". Text that is
 * mostly lower case is kept as written (so "traZODone" and "HCl" keep the FDA's spelling).
 */
export function titleIfShouting(value: string): string {
  const upper = (value.match(/[A-Z]/g) ?? []).length
  const lower = (value.match(/[a-z]/g) ?? []).length
  if (upper === 0 || upper < 0.7 * (upper + lower)) return value
  return value.replace(/\b[A-Z][A-Z']*\b/g, (word) => (KEEP_UPPER.has(word) ? word : word[0] + word.slice(1).toLowerCase()))
}

const CORPORATE = /[\s,]+(inc|incorporated|llc|l\.l\.c|corp|corporation|co|company|ltd|limited|lp|l\.p|plc|gmbh|ag|s\.a)\.?$/i

/** "Hospira, Inc., a Pfizer Company" -> "Hospira"; "Empower Clinic Services, LLC dba Empower Pharmacy" -> "Empower Pharmacy". */
export function shortFirm(raw: string): string {
  let name = text(raw)
  const dba = /\bd\/?b\/?a\b\.?\s+(.+)$/i.exec(name)
  if (dba) name = dba[1]
  name = name.split(',')[0].trim()
  for (let prev = ''; prev !== name; ) {
    prev = name
    name = name.replace(CORPORATE, '').replace(/\s+(and|&)$/i, '').trim()
  }
  return titleIfShouting(name)
}

/** Where the product's own name ends in an FDA product description: legal lines, makers and codes follow. */
const PRODUCT_END = [/,?\s*\bRx\b/i, /,?\s*\bNDC\b/i, /,?\s*\b(Manufactured|Mfd|Distributed|Marketed|Packaged|Made)\b/i, /,?\s*\bFor (Office|Hospital|Institutional)\b/i]

/**
 * The product as a person would say it:
 * "Dextrose Injection, USP, 70 %, 2000 mL bags, Rx Only, Baxter …" -> "Dextrose Injection, 70 %".
 */
export function shortProduct(raw: string, firm = ''): string {
  let value = text(raw)
  let end = value.length
  for (const re of PRODUCT_END) {
    const m = re.exec(value)
    if (m && m.index > 0) end = Math.min(end, m.index)
  }
  const maker = text(firm).split(/[\s,]+/)[0]
  if (maker.length >= 4) {
    const at = value.toLowerCase().indexOf(maker.toLowerCase())
    if (at > 0) end = Math.min(end, at)
  }
  value = value
    .slice(0, end)
    .replace(/,?\s*\bUSP\b/g, '')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/,\s*,/g, ',') // "GEL, (SPF 50), 3 mL" loses its bracket, not its sense
    .replace(/[\s,.;:]+$/, '')
  const parts = value.split(/,\s+/).filter(Boolean)
  let out = parts[0] ?? ''
  if (parts[1] && out.length + parts[1].length + 2 <= 70) out = `${out}, ${parts[1]}`
  if (out.length > 90) out = `${out.slice(0, 90).replace(/\s+\S*$/, '')}…`
  return titleIfShouting(out)
}

/** The FDA's reason in plain words, for headlines; '' when it is not one of the usual kinds. The page shows the full reason. */
const REASONS: Array<[RegExp, string]> = [
  [/foreign (tablets?|capsules?)/i, 'wrong tablets or capsules found in bottles'],
  [/^labeling\b|mislabel|label mix-?up/i, 'labeling error'],
  [/particulate|particles?\b/i, 'particles found in the product'],
  [/foreign (substance|matter|material|object)/i, 'foreign material found in the product'],
  [/microbial|bacteri|endotoxin|fung|mold|yeast|contaminat/i, 'possible contamination'],
  [/sterility|sterile/i, 'sterility not assured'],
  [/nitrosamine|nitroso|ndma|ndea/i, 'nitrosamine impurity above the limit'],
  [/impurit|degradation/i, 'failed an impurity test'],
  [/subpotent|superpotent|super-potent/i, 'strength not as labeled'],
  [/dissolution/i, 'failed a dissolution test'],
  [/cgmp|good manufacturing/i, 'manufacturing problems (CGMP)'],
  [/discolou?r/i, 'discolored product'],
  [/crystal/i, 'crystals found in the product'],
  [/leak|defective (container|seal|closure)|packag/i, 'packaging problem'],
  [/stability/i, 'failed stability testing'],
  [/undeclared|unapproved|tainted/i, 'unapproved or hidden ingredient'],
]

export function plainReason(raw: string): string {
  const reason = text(raw)
  for (const [re, words] of REASONS) if (re.test(reason)) return words
  return ''
}

export function slugify(value: string): string {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// ---------------------------------------------------------------- recalls

const CLASS_RANK: Record<RecallClass, number> = { I: 0, II: 1, III: 2, '': 3 }

export function recallTag(cls: RecallClass): string {
  if (cls === 'I') return 'Class I · Most serious'
  if (cls === 'II') return 'Class II · Moderate risk'
  if (cls === 'III') return 'Class III · Low risk'
  return 'Not yet classified'
}

export interface RecallDetail {
  id: string
  event: string
  cls: RecallClass
  /** ISO date of the FDA's weekly report that listed it. */
  date: string
  initiated: string
  firm: string
  place: string
  product: string
  reason: string
  lots: string
  quantity: string
  distribution: string
  status: string
  voluntary: string
  generic: string
  headline: string
}

export function parseRecallRow(r: Record<string, unknown>): RecallDetail | null {
  const id = text(r.recall_number)
  const product = text(r.product_description)
  if (!id || !product) return null
  const firm = text(r.recalling_firm)
  const reason = text(r.reason_for_recall)
  const plain = plainReason(reason)
  const generic = list((r.openfda as { generic_name?: unknown } | undefined)?.generic_name)[0] ?? ''
  return {
    id,
    event: text(r.event_id),
    cls: classOf(r.classification),
    date: isoDate(r.report_date) || isoDate(r.recall_initiation_date),
    initiated: isoDate(r.recall_initiation_date),
    firm,
    place: [text(r.city), text(r.state), text(r.country)].filter(Boolean).join(', '),
    product,
    reason,
    lots: typeof r.code_info === 'string' ? r.code_info.trim() : '',
    quantity: text(r.product_quantity),
    distribution: text(r.distribution_pattern),
    status: text(r.status),
    voluntary: text(r.voluntary_mandated),
    generic: titleIfShouting(generic),
    headline: `${shortFirm(firm)} recalls ${shortProduct(product, firm)}${plain ? `: ${plain}` : ''}`,
  }
}

/** Newest first; on the same day the most serious first. One row per recall event (a firm often recalls many products at once). */
export function recallsForNews(json: unknown): RecallDetail[] {
  const seen = new Set<string>()
  const out: RecallDetail[] = []
  const rows = rowsOf(json)
    .map(parseRecallRow)
    .filter((r): r is RecallDetail => r !== null)
    .sort((a, b) => b.date.localeCompare(a.date) || CLASS_RANK[a.cls] - CLASS_RANK[b.cls])
  for (const r of rows) {
    const key = r.event || r.id
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}

export function recallItem(r: RecallDetail): FdaNewsItem {
  return { kind: 'recall', href: `/fda-news/recall/${encodeURIComponent(r.id)}`, date: r.date, headline: r.headline, tag: recallTag(r.cls) }
}

/** Tag of a recall the company announced and the FDA posted the same day; the FDA classifies it weeks later. */
export const NOTICE_TAG = 'Company announcement'

export function noticeItem(n: FdaNotice): FdaNewsItem {
  return { kind: 'recall', href: `/fda-news/recall/${n.item.slug}`, date: n.item.date || n.page.published, headline: n.item.title || n.page.title, tag: NOTICE_TAG }
}

/** Newest first; items of the same day keep their order (a stable sort). */
function newestFirst(items: FdaNewsItem[]): FdaNewsItem[] {
  return [...items].sort((a, b) => b.date.localeCompare(a.date))
}

/** Recalls: the drug and biologic recall notices on fda.gov (same day) and the weekly enforcement reports, newest first. */
export async function recallNews(limit = 8, now = new Date()): Promise<FdaNewsItem[] | undefined> {
  const [json, notices] = await Promise.all([
    getJson(`${OPENFDA}?search=${dateRange(now, WINDOW_DAYS)}&sort=report_date:desc&limit=${PAGE}`),
    recallNotices(limit), // the newest few are enough: older notices could not make the list
  ])
  if (json === undefined && notices === undefined) return undefined
  const reports = json === undefined ? [] : recallsForNews(json).map(recallItem)
  return newestFirst([...(notices ?? []).map(noticeItem), ...reports]).slice(0, limit)
}

/** One recall with the other products of the same recall event; `null` = no such recall, `undefined` = FDA not answering. */
export async function recallDetail(id: string): Promise<{ recall: RecallDetail; others: RecallDetail[] } | null | undefined> {
  const clean = id.replace(/[^A-Za-z0-9-]/g, '')
  if (!clean) return null
  const json = await getJson(`${OPENFDA}?search=recall_number:%22${clean}%22&limit=1`)
  if (json === undefined) return undefined
  const recall = rowsOf(json).map(parseRecallRow).find((r) => r?.id.toUpperCase() === clean.toUpperCase())
  if (!recall) return null
  let others: RecallDetail[] = []
  if (recall.event) {
    const event = await getJson(`${OPENFDA}?search=event_id:%22${encodeURIComponent(recall.event)}%22&limit=50`)
    others = rowsOf(event)
      .map(parseRecallRow)
      .filter((r): r is RecallDetail => r !== null && r.id !== recall.id)
  }
  return { recall, others }
}

// ---------------------------------------------------------------- new drug approvals

const SALTS = new Set([
  'hydrochloride', 'dihydrochloride', 'hydrobromide', 'hcl', 'sodium', 'disodium', 'potassium', 'calcium', 'magnesium',
  'acetate', 'tosylate', 'mesylate', 'dimesylate', 'besylate', 'maleate', 'citrate', 'fumarate', 'hemifumarate', 'succinate',
  'tartrate', 'bitartrate', 'sulfate', 'phosphate', 'lactate', 'gluconate', 'meglumine', 'monohydrate', 'dihydrate',
  'trihydrate', 'hemihydrate', 'sesquihydrate', 'anhydrous',
])

/** "ORFORGLIPRON CALCIUM" -> "orforglipron"; "FLORETYROSINE F 18" -> "floretyrosine F 18"; "APITEGROMAB-MSTN" -> "apitegromab-mstn". */
export function genericName(raw: string): string {
  const words = text(raw).toLowerCase().split(' ').filter(Boolean)
  const kept = words.filter((w, i) => i === 0 || !SALTS.has(w))
  // radioactive labels keep their chemistry capitals: "f 18" -> "F 18", "ga 68" -> "Ga 68"
  return kept.join(' ').replace(/\b(f|ga|tc|lu|cu|zr)([- ])(\d{1,3}m?)\b/g, (_m, el: string, sep: string, n: string) => `${el[0].toUpperCase()}${el.slice(1)}${sep}${n}`)
}

export function brandName(raw: string): string {
  return text(raw).toLowerCase().replace(/(^|[\s-])([a-z])/g, (_m, sep: string, c: string) => sep + c.toUpperCase())
}

/** What kind of medicine it is, from the FDA's form and route fields: "tablets", "injection", … ('' when unclear). */
export function formNoun(...fields: string[]): string {
  const f = fields.join(' ').toLowerCase()
  if (/tablet/.test(f)) return 'tablets'
  if (/capsule/.test(f)) return 'capsules'
  if (/inject|infus|intravenous|subcutaneous|intramuscular|intrathecal|intravitreal|intradermal|intra-?articular/.test(f)) return 'injection'
  if (/ophthalmic/.test(f)) return 'eye drops'
  if (/inhal/.test(f)) return 'inhaler'
  if (/nasal/.test(f)) return 'nasal spray'
  const topical = /cream|ointment|gel|lotion|foam/.exec(f)
  if (topical) return topical[0]
  if (/oral/.test(f) && /solution|suspension|syrup/.test(f)) return 'oral liquid'
  return ''
}

export interface Approval {
  application: string
  brand: string
  generic: string
  sponsor: string
  /** ISO date of the original approval. */
  date: string
  form: string
  novel: boolean
  products: Array<{ brand: string; ingredients: string; form: string; status: string }>
  routes: string[]
  setId: string
  headline: string
}

function yyyymmdd(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

export function parseApproval(r: Record<string, unknown>): Approval | null {
  const application = text(r.application_number)
  const subs = Array.isArray(r.submissions) ? (r.submissions as Array<Record<string, unknown>>) : []
  const original = subs.find((s) => s.submission_type === 'ORIG' && s.submission_status === 'AP')
  if (!application || !original) return null
  const products = Array.isArray(r.products) ? (r.products as Array<Record<string, unknown>>) : []
  const openfda = (r.openfda ?? {}) as Record<string, unknown>
  const routes = list(openfda.route)
  const ingredientNames = [
    ...new Set(products.flatMap((p) => (Array.isArray(p.active_ingredients) ? (p.active_ingredients as Array<{ name?: unknown }>) : []).map((a) => genericName(text(a.name))))),
  ].filter(Boolean)
  const generic = ingredientNames.join(' and ') || genericName(list(openfda.generic_name)[0] ?? '')
  const brand = brandName(text(products[0]?.brand_name) || list(openfda.brand_name)[0] || '')
  const form = formNoun(text(products[0]?.dosage_form), text(products[0]?.route), ...routes)
  const name = brand && generic && brand.toLowerCase() !== generic.toLowerCase() ? `${brand} (${generic})` : brand || generic
  return {
    application,
    brand,
    generic,
    sponsor: titleIfShouting(text(r.sponsor_name)),
    date: isoDate(original.submission_status_date),
    form,
    novel: /^TYPE 1\b/.test(text(original.submission_class_code)),
    products: products.map((p) => ({
      brand: brandName(text(p.brand_name)),
      ingredients: (Array.isArray(p.active_ingredients) ? (p.active_ingredients as Array<{ name?: unknown; strength?: unknown }>) : [])
        .map((a) => `${genericName(text(a.name))} ${text(a.strength).toLowerCase()}`.trim())
        .join(' + '),
      form: [text(p.dosage_form), text(p.route)].filter(Boolean).join(', ').toLowerCase(),
      status: text(p.marketing_status),
    })),
    routes,
    setId: list(openfda.spl_set_id)[0] ?? '',
    headline: `FDA approves ${name}${form ? ` ${form}` : ''}`,
  }
}

/** New medicines (new molecular entities) the FDA approved on or after `fromIso`, newest first. */
export function approvalsForNews(json: unknown, fromIso: string): Approval[] {
  return rowsOf(json)
    .map(parseApproval)
    .filter((a): a is Approval => a !== null && a.novel && a.date >= fromIso)
    .sort((a, b) => b.date.localeCompare(a.date) || a.brand.localeCompare(b.brand))
}

export function approvalItem(a: Approval): FdaNewsItem {
  return { kind: 'approval', href: `/fda-news/new-drug/${encodeURIComponent(a.application)}`, date: a.date, headline: a.headline, tag: 'Approved by the FDA' }
}

export function announcementItem(a: FdaAnnouncement): FdaNewsItem {
  return { kind: 'approval', href: `/fda-news/new-drug/${a.item.slug}`, date: a.item.date || a.page.date, headline: a.item.title || a.page.title, tag: 'Approved by the FDA' }
}

export function novelDrugItem(d: NovelDrug): FdaNewsItem {
  const name = d.generic && d.generic.toLowerCase() !== d.brand.toLowerCase() ? `${d.brand} (${d.generic})` : d.brand
  return { kind: 'approval', href: `/fda-news/new-drug/${novelDrugId(d)}`, date: d.date, headline: `FDA approves ${name}`, tag: 'Approved by the FDA' }
}

function windowStart(now: Date): { from: Date; fromIso: string } {
  const from = new Date(now.getTime() - WINDOW_DAYS * DAY_MS)
  return { from, fromIso: isoDate(yyyymmdd(from)) }
}

/** New molecular entities in Drugs@FDA from the last 60 days, newest first. */
async function novelApprovals(now: Date): Promise<Approval[] | undefined> {
  const { from, fromIso } = windowStart(now)
  // openFDA matches each condition against any submission, so older drugs with a recent supplement come back too;
  // the exact test (original approval, new molecular entity, inside the window) is done in approvalsForNews.
  const search = `submissions.submission_type:%22ORIG%22+AND+submissions.submission_status:%22AP%22+AND+submissions.submission_class_code:%22TYPE+1%22+AND+submissions.submission_status_date:[${yyyymmdd(from)}+TO+${yyyymmdd(now)}]`
  const first = await getJson(`${OPENFDA_DRUGSFDA}?search=${search}&limit=${PAGE}`)
  if (first === undefined) return undefined
  const total = Number((first as { meta?: { results?: { total?: unknown } } } | null)?.meta?.results?.total ?? 0)
  const pages: unknown[] = [first]
  if (total > PAGE) {
    const skips = Array.from({ length: Math.min(3, Math.ceil(total / PAGE) - 1) }, (_, i) => (i + 1) * PAGE)
    pages.push(...(await Promise.all(skips.map((skip) => getJson(`${OPENFDA_DRUGSFDA}?search=${search}&limit=${PAGE}&skip=${skip}`)))))
  }
  return approvalsForNews({ results: pages.flatMap(rowsOf) }, fromIso)
}

/** Name words long enough to tell medicines apart: "Etcamah (camizestrant)" -> ["etcamah", "camizestrant"]. */
export function nameWords(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 5)
}

/**
 * True when Drugs@FDA already had this ingredient approved before `fromIso`: the announcement is then a new use
 * of an old medicine, not a new drug. `undefined` when it cannot be told (the caller then leaves the item out).
 */
async function approvedBefore(names: { brand: string; generic: string }, fromIso: string): Promise<boolean | undefined> {
  const word = nameWords(names.generic)[0] ?? nameWords(names.brand)[0]
  if (!word) return undefined
  const query = encodeURIComponent(`products.active_ingredients.name:"${word}" OR openfda.generic_name:"${word}" OR products.brand_name:"${word}"`)
  const json = await getJson(`${OPENFDA_DRUGSFDA}?search=${query}&limit=20`)
  if (json === undefined) return undefined
  return rowsOf(json)
    .map(parseApproval)
    .some((a) => a !== null && a.date !== '' && a.date < fromIso)
}

/**
 * New drugs: the FDA's same-day approval announcements (gene therapies and other biologics too), the new
 * molecular entities in Drugs@FDA, and the drug center's table of the year's new drugs, newest first. The same
 * medicine is shown once: from Drugs@FDA when it is there (its page has the most facts), else its announcement,
 * else its table row. An announcement is also left out when the medicine was approved long before (a new use).
 */
export async function approvalNews(limit = 8, now = new Date()): Promise<FdaNewsItem[] | undefined> {
  const { from, fromIso } = windowStart(now)
  const years = [...new Set([from.getFullYear(), now.getFullYear()])] // early in a year, last year's table too
  const [novel, candidates, table] = await Promise.all([novelApprovals(now), approvalCandidates(), novelDrugs(years)])
  if (novel === undefined && candidates === undefined && table === undefined) return undefined
  const known = new Set((novel ?? []).flatMap((a) => nameWords(`${a.brand} ${a.generic}`)))
  // newest first, a few at a time, until `limit` new drugs are found: an older one could not make the list
  const fresh = await firstMatches(
    (candidates ?? []).filter((item) => item.date >= fromIso),
    async (item) => {
      const a = await readAnnouncement(item)
      if (!a?.names || nameWords(`${a.names.brand} ${a.names.generic}`).some((w) => known.has(w))) return null
      return (await approvedBefore(a.names, fromIso)) === false ? a : null
    },
    limit,
  )
  for (const a of fresh) for (const w of nameWords(`${a.names?.brand} ${a.names?.generic}`)) known.add(w)
  // the table lists a new drug the day it is approved; the feeds forget it after 20 newer posts
  const listed = (table ?? []).filter((d) => d.date >= fromIso && !nameWords(`${d.brand} ${d.generic}`).some((w) => known.has(w)))
  return newestFirst([...fresh.map(announcementItem), ...(novel ?? []).map(approvalItem), ...listed.map(novelDrugItem)]).slice(0, limit)
}

export interface LabelSummary {
  /** The label's "Indications and usage" text, without its heading. */
  uses: string
  boxedWarning: boolean
  /** The boxed warning's own words, shortened ('' when there is none). */
  boxedText: string
  /** The label's sentence on the most common side effects ('' when it has none). */
  sideEffects: string
  setId: string
}

/** Label text without its pointers to other sections: "death ( 5.1 , 5.2 , 7.1 )." -> "death."; "(≥ 20%)" stays. */
function withoutSectionNumbers(value: string): string {
  return value.replace(/\s*\(\s*\d+(?:\.\d+)*(?:\s*,\s*\d+(?:\.\d+)*)*\s*\)/g, '').replace(/\s+([.,;:])/g, '$1')
}

/** Sentences of label text: a period, a space and a capital; "2.5%" and "(≥ 20%)" do not end one. */
function sentences(value: string): string[] {
  return value.split(/(?<=\.)\s+(?=[A-Z(])/)
}

/**
 * "6 ADVERSE REACTIONS The most common adverse reactions (≥ 20%), including … were decreased neutrophils, … and
 * fatigue. The following …" -> the sentence about the most common ones, as the label words it.
 */
export function commonSideEffects(raw: string): string {
  const value = withoutSectionNumbers(text(raw).replace(/^\d*\s*ADVERSE REACTIONS\s*/i, '').replace(/\s*\[see [^\]]*\]/gi, ''))
  return sentences(value).find((s) => /\bmost common(ly reported)?\b[^.]*\b(adverse reactions|side effects)\b/i.test(s))?.slice(0, 600) ?? ''
}

/**
 * "1 INDICATIONS AND USAGE ETCAMAH is indicated … test [see Dosage and Administration ( 2.1 )] . This …"
 * -> "ETCAMAH is indicated … test. This …", cut at a sentence end. The label's cross-references point to
 * sections this page does not show.
 */
export function labelUses(raw: string, max = 900): string {
  let value = text(raw)
    .replace(/^\d*\s*INDICATIONS\s*(AND|&)\s*USAGE\s*/i, '')
    .replace(/\s*\[see [^\]]*\]/gi, '')
    .replace(/\s+([.,;:])/g, '$1')
  if (value.length > max) {
    const cut = value.slice(0, max)
    const stop = cut.lastIndexOf('. ')
    value = stop > max / 2 ? cut.slice(0, stop + 1) : `${cut.replace(/\s+\S*$/, '')}…`
  }
  return value
}

export function parseLabel(json: unknown): LabelSummary | null {
  const row = rowsOf(json)[0]
  if (!row) return null
  const openfda = (row.openfda ?? {}) as Record<string, unknown>
  const boxed = withoutSectionNumbers(text(list(row.boxed_warning).join(' ')))
  return {
    uses: labelUses(list(row.indications_and_usage).join(' ')),
    boxedWarning: boxed !== '',
    boxedText: boxed.length > 500 ? `${boxed.slice(0, 500).replace(/\s+\S*$/, '')}…` : boxed,
    sideEffects: commonSideEffects(list(row.adverse_reactions).join(' ')),
    setId: text(row.set_id) || list(openfda.spl_set_id)[0] || '',
  }
}

/**
 * The label of a new drug known only by its names (an announcement or a row of the FDA's table): by brand name,
 * else by generic name. `null` until the FDA publishes it (often a week or two after approval).
 */
export async function labelByName(brand: string, generic: string): Promise<LabelSummary | null> {
  for (const [field, name] of [['brand_name', brand], ['generic_name', generic]] as const) {
    if (!name) continue
    const json = await getJson(`${OPENFDA_LABEL}?search=openfda.${field}:%22${encodeURIComponent(name)}%22&sort=effective_time:desc&limit=1`)
    const label = json ? parseLabel(json) : null
    if (label) return label
  }
  return null
}

/** One approval and its label (when the FDA has published it); `null` = not an approved application, `undefined` = FDA not answering. */
export async function approvalDetail(id: string): Promise<{ approval: Approval; label: LabelSummary | null } | null | undefined> {
  const clean = id.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!/^(NDA|BLA|ANDA)\d+$/.test(clean)) return null
  const [json, labelJson] = await Promise.all([
    getJson(`${OPENFDA_DRUGSFDA}?search=application_number:%22${clean}%22&limit=1`),
    getJson(`${OPENFDA_LABEL}?search=openfda.application_number:%22${clean}%22&limit=1`),
  ])
  if (json === undefined) return undefined
  const approval = rowsOf(json).map(parseApproval).find((a) => a?.application === clean)
  if (!approval) return null
  return { approval, label: parseLabel(labelJson) }
}

/** The approval's page on Drugs@FDA. */
export function drugsAtFdaUrl(application: string): string {
  return `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${application.replace(/\D/g, '')}`
}

export function dailyMedUrl(setId: string): string {
  return `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${encodeURIComponent(setId)}`
}

// ---------------------------------------------------------------- shortages

export interface ShortageRow {
  presentation: string
  company: string
  availability: Availability
  reason: string
  info: string
  updated: string
}

export interface ShortageNews {
  name: string
  slug: string
  /** ISO date of the newest posting among its records: when it last made the FDA's list. */
  posted: string
  /** ISO date of the first posting. */
  since: string
  updated: string
  categories: string[]
  forms: string[]
  rows: ShortageRow[]
}

const AVAILABILITY_RANK: Record<Availability, number> = { unavailable: 0, limited: 1, unknown: 2, available: 3 }

/** Current shortage records grouped by drug, the most recently posted drug first. */
export function groupShortages(json: unknown): ShortageNews[] {
  const groups = new Map<string, ShortageNews>()
  for (const r of rowsOf(json)) {
    if (r.status !== 'Current') continue
    const name = titleIfShouting(text(r.generic_name))
    const slug = slugify(name)
    if (!slug) continue
    let g = groups.get(slug)
    if (!g) {
      g = { name, slug, posted: '', since: '', updated: '', categories: [], forms: [], rows: [] }
      groups.set(slug, g)
    }
    const posted = isoFromUsDate(r.initial_posting_date)
    const updated = isoFromUsDate(r.update_date)
    if (posted > g.posted) g.posted = posted
    if (posted && (!g.since || posted < g.since)) g.since = posted
    if (updated > g.updated) g.updated = updated
    for (const c of list(r.therapeutic_category)) if (!g.categories.includes(c)) g.categories.push(c)
    const form = text(r.dosage_form)
    if (form && !g.forms.includes(form)) g.forms.push(form)
    const row: ShortageRow = {
      presentation: text(r.presentation).replace(/\s*\(NDC [^)]*\)\s*$/i, ''),
      company: text(r.company_name),
      availability: availabilityOf(r.availability),
      reason: text(r.shortage_reason),
      info: text(r.related_info),
      updated,
    }
    // two package sizes (NDCs) of the same product read the same once the NDC is gone: list it once
    const same = (o: ShortageRow) => o.presentation === row.presentation && o.company === row.company && o.availability === row.availability && o.reason === row.reason && o.info === row.info
    if (!g.rows.some(same)) g.rows.push(row)
  }
  const out = [...groups.values()]
  for (const g of out) g.rows.sort((a, b) => AVAILABILITY_RANK[a.availability] - AVAILABILITY_RANK[b.availability] || a.presentation.localeCompare(b.presentation))
  return out.sort((a, b) => b.posted.localeCompare(a.posted) || a.name.localeCompare(b.name))
}

function worst(rows: ShortageRow[]): Availability {
  return rows.reduce<Availability>((w, r) => (AVAILABILITY_RANK[r.availability] < AVAILABILITY_RANK[w] ? r.availability : w), 'available')
}

/** Makers listed for the drug, and how many of them report limited or no supply. */
export function shortageMakers(s: ShortageNews): { makers: string[]; short: number } {
  const makers = [...new Set(s.rows.map((r) => shortFirm(r.company)).filter(Boolean))]
  const short = makers.filter((m) => s.rows.some((r) => shortFirm(r.company) === m && (r.availability === 'unavailable' || r.availability === 'limited'))).length
  return { makers, short }
}

export function shortageHeadline(s: ShortageNews): string {
  const { makers, short } = shortageMakers(s)
  if (makers.length === 1) {
    const state = { unavailable: 'unavailable', limited: 'in limited supply', available: 'available again', unknown: 'in short supply' }[worst(s.rows)]
    return `${s.name}: ${makers[0]} reports it ${state}`
  }
  if (short === 0) return `${s.name}: makers report supply is available again`
  return `${s.name} shortage: ${short} of ${makers.length} makers report limited or no supply`
}

export function shortageTag(s: ShortageNews): string {
  const w = worst(s.rows)
  if (w === 'unavailable') return shortageMakers(s).makers.length === 1 ? 'Unavailable from maker' : 'Some makers out of stock'
  if (w === 'limited') return 'Limited supply'
  return 'On the FDA shortage list'
}

export function shortageItem(s: ShortageNews): FdaNewsItem {
  return { kind: 'shortage', href: `/fda-news/shortage/${s.slug}`, date: s.posted, headline: shortageHeadline(s), tag: shortageTag(s) }
}

const SITEMAP_LIMIT = 50

/**
 * The FDA news pages for the sitemap: the recalls and new drugs of the last 60 days and the newest drugs on the
 * shortage list, of the kinds switched on. A feed that does not answer adds nothing (the sitemap is rebuilt daily).
 */
export async function fdaNewsPages(on: FdaNewsSwitches, now = new Date()): Promise<Array<{ href: string; date: string }>> {
  const [recalls, approvals, shortages] = await Promise.all([
    on.recall ? recallNews(SITEMAP_LIMIT, now) : undefined,
    on.approval ? approvalNews(SITEMAP_LIMIT, now) : undefined,
    // the list alone (one request): the page of each drug gathers all its records when it is opened
    on.shortage
      ? getJson(`${OPENFDA_SHORTAGES}?search=status:%22Current%22&sort=initial_posting_date:desc&limit=${PAGE}`).then((json) =>
          json === undefined ? undefined : groupShortages(json).slice(0, SITEMAP_LIMIT).map(shortageItem),
        )
      : undefined,
  ])
  return [...(recalls ?? []), ...(approvals ?? []), ...(shortages ?? [])].map(({ href, date }) => ({ href, date }))
}

/** All current records of the drug whose name makes `slug`, found by searching `name` (the newest-postings page may hold only some). */
async function shortageBySlug(name: string, slug: string): Promise<ShortageNews | null | undefined> {
  const query = shortageQuery(name)
  if (!query) return null
  const json = await getJson(`${OPENFDA_SHORTAGES}?search=${query}&limit=${PAGE}`)
  if (json === undefined) return undefined
  return groupShortages(json).find((g) => g.slug === slug) ?? null
}

export async function shortageNews(limit = 8): Promise<FdaNewsItem[] | undefined> {
  const json = await getJson(`${OPENFDA_SHORTAGES}?search=status:%22Current%22&sort=initial_posting_date:desc&limit=${PAGE}`)
  if (json === undefined) return undefined
  const newest = groupShortages(json).slice(0, limit)
  const full = await Promise.all(newest.map((s) => shortageBySlug(s.name, s.slug)))
  return newest.map((s, i) => shortageItem(full[i] ?? s))
}

/** One drug's shortage page, by its slug; `null` = not on the current list, `undefined` = FDA not answering. */
export async function shortageDetail(slug: string): Promise<ShortageNews | null | undefined> {
  const clean = slugify(slug)
  if (!clean) return null
  // The slug has lost the name's punctuation; openFDA's search ignores most of it too ("5%" matches "5"), so the
  // words usually find the drug at once. A name they cannot match (an apostrophe: "Ringer's") is found by its first word.
  const words = clean.split('-')
  const found = await shortageBySlug(words.join(' '), clean)
  return found === null && words.length > 1 ? shortageBySlug(words[0], clean) : found
}

// ---------------------------------------------------------------- home page

/**
 * The newest recall, new drug and shortage, in that order. A kind switched off in Admin → Settings is not
 * even fetched; a feed that did not answer is left out.
 */
export async function fdaHighlights(now = new Date(), on: FdaNewsSwitches = { recall: true, approval: true, shortage: true }): Promise<FdaNewsItem[]> {
  const [recalls, approvals, shortages] = await Promise.all([
    on.recall ? recallNews(1, now) : undefined,
    on.approval ? approvalNews(1, now) : undefined,
    on.shortage ? shortageNews(1) : undefined,
  ])
  return [recalls?.[0], approvals?.[0], shortages?.[0]].filter((item): item is FdaNewsItem => item !== undefined)
}
