/**
 * Same-day FDA news from fda.gov itself (its RSS feeds and notice pages; public domain), for the days before
 * the openFDA data files catch up: company recall notices (the weekly enforcement reports list them weeks
 * later) and approval announcements (gene therapies and other biologics are not in Drugs@FDA at all).
 *
 * Only drugs and biologics are kept. Every FDA page prints what it is about ("Product Type: Drugs" on a
 * recall notice, "Regulated Product(s) Biologics" on an announcement), so food, supplements, devices,
 * cosmetics and animal products are dropped on the FDA's own word, not on guesses from the title.
 * Feeds are re-read hourly, pages daily. Nothing here throws: `undefined` means fda.gov did not answer.
 */

export const FDA_SITE = 'https://www.fda.gov'
export const FDA_RSS = {
  recalls: `${FDA_SITE}/about-fda/contact-fda/stay-informed/rss-feeds/recalls/rss.xml`,
  press: `${FDA_SITE}/about-fda/contact-fda/stay-informed/rss-feeds/press-releases/rss.xml`,
  drugs: `${FDA_SITE}/about-fda/contact-fda/stay-informed/rss-feeds/drugs/rss.xml`,
}
export const NOTICE_PATH = '/safety/recalls-market-withdrawals-safety-alerts/'
/** Where approval announcements live: FDA press releases, and the drug center's approval notes. */
export const APPROVAL_PATHS = ['/news-events/press-announcements/', '/drugs/resources-information-approved-drugs/']
const USER_AGENT = 'PillSeek/1.0 (+https://pillseek.com)'
const TIMEOUT_MS = 4000

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}

export function decodeEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(quot|apos|#39|lt|gt|nbsp|amp);/g, (_m, name: string) => ({ quot: '"', apos: "'", '#39': "'", lt: '<', gt: '>', nbsp: ' ', amp: '&' })[name] ?? '')
}

/** Plain text: tags and entities gone, spaces collapsed; the "?" boxes of badly encoded dashes become dashes. */
function clean(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, ' '))
    .replace(/\s*\uFFFD\s*/g, ' – ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** "Fri, 18 Sep 2026 17:48:00 EDT" or "September 18, 2026" -> "2026-09-18" ('' when unreadable). */
export function isoFromWords(value: string): string {
  const dayFirst = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/.exec(value)
  if (dayFirst && MONTHS[dayFirst[2].toLowerCase()]) return `${dayFirst[3]}-${MONTHS[dayFirst[2].toLowerCase()]}-${dayFirst[1].padStart(2, '0')}`
  const monthFirst = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})/.exec(value)
  if (monthFirst && MONTHS[monthFirst[1].toLowerCase()]) return `${monthFirst[3]}-${MONTHS[monthFirst[1].toLowerCase()]}-${monthFirst[2].padStart(2, '0')}`
  return ''
}

export interface RssItem {
  title: string
  /** Path on fda.gov, e.g. "/safety/recalls-market-withdrawals-safety-alerts/par-health-…". */
  path: string
  slug: string
  date: string
  description: string
}

export function parseRss(xml: string): RssItem[] {
  const out: RssItem[] = []
  for (const [, body] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const field = (name: string) => clean(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(body)?.[1] ?? '')
    const link = field('link')
    const path = /^https?:\/\/(?:www\.)?fda\.gov(\/[a-z0-9\-/]+?)\/?$/i.exec(link)?.[1] ?? ''
    const slug = path.split('/').pop() ?? ''
    const title = field('title')
    if (!title || !slug) continue
    out.push({ title, path, slug, date: isoFromWords(field('pubDate')), description: field('description') })
  }
  return out
}

export interface FdaPage {
  title: string
  /** The FDA's own one-paragraph summary (the page's description). */
  summary: string
  /** ISO date the page was published. */
  date: string
  /** What the page is about, as the FDA files it: "Drugs", "Biologics", "Food & Beverages", … */
  productType: string
  // recall notices only
  company: string
  brand: string
  product: string
  reason: string
  announced: string
  published: string
}

/** Reads the parts of an fda.gov page that are the same on every notice and announcement. */
export function parseFdaPage(html: string): FdaPage {
  const meta = (name: string) => clean(new RegExp(`<meta (?:name|property)="${name}" content="([^"]*)"`, 'i').exec(html)?.[1] ?? '')
  const text = clean(html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' '))
  const after = (re: RegExp) => clean(re.exec(text)?.[1] ?? '')
  const time = /<time[^>]*datetime="(\d{4}-\d{2}-\d{2})/.exec(html)?.[1] ?? ''
  const noticeType = after(/Product Type:\s*(.+?)\s+Reason for Announcement:/)
  const regulated = after(/Regulated Product\(s\)\s*(.{0,120}?)(?:\s+(?:Follow FDA|Feedback|Topic\(s\)|Content current)|$)/)
  return {
    // the page title is whole; og:title is cut at 70 characters on some FDA pages
    title: clean(/<title>([\s\S]*?)<\/title>/.exec(html)?.[1] ?? '').replace(/\s*\|\s*FDA$/, '') || meta('og:title'),
    summary: meta('description') || meta('og:description'),
    date: time,
    productType: noticeType || regulated,
    company: after(/Company Name:\s*(.+?)\s+Brand Name:/),
    brand: after(/Brand Name:\s*(?:Brand Name\(s\)\s*)?(.+?)\s+Product Description:/),
    product: after(/Product Description:\s*(?:Product Description\s*)?(.+?)\s+Company Announcement\b/),
    reason: after(/Reason for Announcement:\s*(?:Recall Reason Description\s*)?(.+?)\s+Company Name:/),
    announced: isoFromWords(after(/Company Announcement Date:\s*([A-Za-z]+ \d{1,2}, \d{4})/)),
    published: isoFromWords(after(/FDA Publish Date:\s*([A-Za-z]+ \d{1,2}, \d{4})/)),
  }
}

export function isDrugOrBiologic(productType: string): boolean {
  return /\b(drugs?|biologics?)\b/i.test(productType)
}

/** Approval headlines: "FDA approves …", "FDA Grants Accelerated Approval to …". Not "FDA clears" (devices) or authorizations. */
export function isApprovalTitle(title: string): boolean {
  return /^FDA\s+(approves\b|grants\b.*\bapproval\b)/i.test(title)
}

/**
 * The medicine named in an approval summary: "approved Fayuvi (rebisufligene etisparvovec-hopf), the first …",
 * "approved lirafugratinib (Lyrfigtu, Elevar Therapeutics, Inc.), a kinase inhibitor" or "granted accelerated
 * approval to Tudriqev (vusolimogene oderparepvec-wtpg)" -> its names.
 */
export function approvalNames(summary: string): { brand: string; generic: string } | null {
  const m = /\b(?:approved|approval\s+(?:for|to|of))\s+(?:the\s+)?([A-Za-z][\w'-]*(?:[ -][a-z][\w'-]*){0,3})\s*\(([^)]{2,160})\)/.exec(summary)
  if (!m) return null
  const outside = m[1].trim()
  const inside = m[2].split(',')[0].trim()
  return /^[A-Z]/.test(outside) ? { brand: outside, generic: inside } : { brand: inside, generic: outside }
}

/** Text of an fda.gov page or feed; `null` = not there, `undefined` = fda.gov did not answer in time. */
async function getText(url: string, revalidate: number): Promise<string | null | undefined> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/rss+xml,application/xml' },
      signal: controller.signal,
      next: { revalidate },
    } as RequestInit)
    if (res.status === 404) return null
    if (!res.ok) return undefined
    return await res.text()
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

async function page(path: string): Promise<FdaPage | null | undefined> {
  const html = await getText(`${FDA_SITE}${path}`, 86400)
  return typeof html === 'string' ? parseFdaPage(html) : html
}

export interface FdaNotice {
  item: RssItem
  page: FdaPage
}

/** The newest drug and biologic recall notices on fda.gov (the feed also carries food, supplements, …). */
/**
 * Reads `items` a few at a time, in order, until `enough` of them gave a result: the newest items come first,
 * so the ones after that point could not make the list anyway, and fda.gov is not asked for them.
 */
export async function firstMatches<T, R>(items: T[], read: (item: T) => Promise<R | null>, enough: number, batch = 4): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length && out.length < enough; i += batch) {
    for (const result of await Promise.all(items.slice(i, i + batch).map(read))) {
      if (result !== null && out.length < enough) out.push(result)
    }
  }
  return out
}

function newestFirst(items: RssItem[]): RssItem[] {
  return [...items].sort((a, b) => b.date.localeCompare(a.date))
}

/** The newest `limit` drug and biologic recall notices on fda.gov (the feed also carries food, supplements, …). */
export async function recallNotices(limit = Infinity): Promise<FdaNotice[] | undefined> {
  const xml = await getText(FDA_RSS.recalls, 3600)
  if (typeof xml !== 'string') return xml === null ? [] : undefined
  const items = newestFirst(parseRss(xml).filter((i) => i.path.startsWith(NOTICE_PATH)))
  return firstMatches(
    items,
    async (item) => {
      const p = await page(item.path)
      return p && isDrugOrBiologic(p.productType) ? { item, page: p } : null
    },
    limit,
  )
}

export interface FdaAnnouncement extends FdaNotice {
  names: { brand: string; generic: string } | null
}

/** Approval announcements in FDA press releases and the drug center's feed, newest first; pages not read yet. */
export async function approvalCandidates(): Promise<RssItem[] | undefined> {
  const feeds = await Promise.all([getText(FDA_RSS.press, 3600), getText(FDA_RSS.drugs, 3600)])
  if (feeds.every((f) => f === undefined)) return undefined
  const seen = new Set<string>()
  const items = feeds
    .flatMap((xml) => (typeof xml === 'string' ? parseRss(xml) : []))
    .filter((i) => isApprovalTitle(i.title) && APPROVAL_PATHS.some((p) => i.path.startsWith(p)))
    .filter((i) => !seen.has(i.slug) && Boolean(seen.add(i.slug)))
  return newestFirst(items)
}

/** One candidate's page: the announcement when it is about a drug or biologic, else `null`. */
export async function readAnnouncement(item: RssItem): Promise<FdaAnnouncement | null> {
  const p = await page(item.path)
  return p && isDrugOrBiologic(p.productType) ? { item, page: p, names: approvalNames(p.summary) } : null
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** One drug or biologic recall notice by its fda.gov slug; `null` = no such notice (or not a drug), `undefined` = fda.gov not answering. */
export async function recallNotice(slug: string): Promise<{ page: FdaPage; url: string } | null | undefined> {
  if (!SLUG.test(slug)) return null
  const p = await page(`${NOTICE_PATH}${slug}`)
  if (!p) return p
  return isDrugOrBiologic(p.productType) && p.title ? { page: p, url: `${FDA_SITE}${NOTICE_PATH}${slug}` } : null
}

/** One approval announcement by its fda.gov slug (press release or drug center note). */
export async function approvalAnnouncement(slug: string): Promise<{ page: FdaPage; url: string } | null | undefined> {
  if (!SLUG.test(slug)) return null
  let unanswered = false
  for (const base of APPROVAL_PATHS) {
    const p = await page(`${base}${slug}`)
    if (p === undefined) unanswered = true
    if (p && isApprovalTitle(p.title) && isDrugOrBiologic(p.productType)) return { page: p, url: `${FDA_SITE}${base}${slug}` }
  }
  return unanswered ? undefined : null
}
