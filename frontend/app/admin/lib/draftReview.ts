/** Admin -> Drafts -> Review one by one: what the page says about a draft pill, and what the keys do. */

export interface QueueItem {
  id: string
  medicine_name: string | null
  strength: string | null
  imprint: string | null
  flagged: boolean
  missing: string[]
}

export type Verdict = 'match' | 'close' | 'partial' | 'mismatch' | 'unreadable' | 'no_imprint'

/** What the AI reader read on the pill's photo, against the imprint typed for it. */
export interface PhotoRead {
  verdict: Verdict
  read: string
  confidence: 'high' | 'medium' | 'low'
  model: string
}

export interface ReviewPill {
  id: string
  medicine_name: string | null
  brand_names: string | null
  spl_strength: string | null
  splimprint: string | null
  splcolor_text: string | null
  splshape_text: string | null
  splsize: string | null
  dosage_form: string | null
  route: string | null
  ndc11: string | null
  ndc9: string | null
  rxcui: string | null
  author: string | null
  status_rx_otc: string | null
  dea_schedule_name: string | null
  slug: string | null
  image_filename: string | null
  published: boolean
  updated_at: string | null
}

export interface Indication {
  text: string
  source: string | null
  source_url: string | null
}

export interface Pronunciation {
  text: string | null
  source: string | null
  /** The drug name it is saved under ("lisinopril" for a Lisinopril 10 mg pill). */
  key: string | null
  audio_url: string | null
  /** missing: none saved; odd: notes pasted in; other_name: it spells out another name (usually the brand). */
  problem: 'missing' | 'odd' | 'other_name' | null
  checked_by: string | null
  checked_at: string | null
}

export interface ReviewItem {
  pill: ReviewPill
  photos: string[]
  warnings: { field: string; message: string }[]
  indication: Indication | null
  pronunciation: Pronunciation
  flags: { missing: string[]; note: string | null; flagged_by: string | null; flagged_at: string | null } | null
  photo_read: PhotoRead | null
}

export type Tone = 'ok' | 'warn' | 'bad' | 'none'

export interface Check {
  tone: Tone
  text: string
}

/** The photo check in words: "Photo reads M L / 10" (ok), "Photo reads L484, not M L 10" (bad). */
export function photoCheck(read: PhotoRead | null, imprint: string | null): Check {
  if (!read) return { tone: 'none', text: 'Photo not read yet' }
  const typed = (imprint ?? '').trim()
  switch (read.verdict) {
    case 'match':
      return { tone: 'ok', text: `Photo reads ${read.read}` }
    case 'close':
      return { tone: 'warn', text: `Photo reads ${read.read}: nearly the same, look closely` }
    case 'partial':
      return { tone: 'warn', text: `Photo reads ${read.read}: only part of ${typed}` }
    case 'mismatch':
      return { tone: 'bad', text: `Photo reads ${read.read}, not ${typed}. Wrong photo?` }
    case 'no_imprint':
      return { tone: 'bad', text: `Photo reads ${read.read}, but no imprint is typed` }
    default:
      return { tone: 'warn', text: 'No imprint could be read on the photo' }
  }
}

const SOURCE_LABEL: Record<string, string> = {
  medlineplus: 'MedlinePlus (NIH)',
  manual: 'PillSeek editorial team',
  gemini: 'Gemini (AI)',
  openfda: 'FDA label',
}

export function sourceLabel(source: string | null): string {
  return source ? (SOURCE_LABEL[source] ?? source) : 'unknown source'
}

/** "Pronounced as" in words. It never blocks publishing: it is fixed right on the review screen. */
export function pronunciationCheck(p: Pronunciation): Check {
  if (!p.text) return { tone: 'warn', text: 'No pronunciation saved' }
  if (p.checked_by) return { tone: 'ok', text: `Checked by ${p.checked_by}` }
  if (p.problem === 'other_name') return { tone: 'bad', text: `Does not sound like "${p.key}": another name's pronunciation?` }
  if (p.problem === 'odd') return { tone: 'bad', text: 'Has notes pasted in with it' }
  if (p.source === 'medlineplus') return { tone: 'ok', text: 'From MedlinePlus (NIH)' }
  return { tone: 'warn', text: `${sourceLabel(p.source)}, not checked yet` }
}

/** Why P cannot publish this pill. The server refuses the same. */
export function publishBlockers(item: ReviewItem): string[] {
  if (item.pill.published) return ['Already published']
  if (!item.pill.rxcui) return ['No RxCUI, so it cannot have a "used for" text: fix it in the editor (E)']
  if (!item.indication) return ['"What it\'s used for" is empty']
  return []
}

/** Why P needs a second press: the photo does not plainly show the typed imprint. */
export function publishWarnings(item: ReviewItem, read: PhotoRead | null): string[] {
  if (item.photos.length === 0) return ['This pill has no photo']
  if (!read) return ['The photo has not been read']
  if (read.verdict !== 'match') return [photoCheck(read, item.pill.splimprint).text]
  return []
}

/** What F ticks before the publisher adjusts it, from what the checks found. */
export function suggestedFlags(item: ReviewItem, read: PhotoRead | null): string[] {
  const tick = new Set(item.flags?.missing ?? [])
  if (item.photos.length === 0 || read?.verdict === 'mismatch' || read?.verdict === 'no_imprint') tick.add('images')
  if (read && ['close', 'partial', 'mismatch', 'no_imprint'].includes(read.verdict)) tick.add('imprint')
  if (!item.indication) tick.add('meds_use')
  return ['images', 'meds_use', 'imprint', 'other'].filter((key) => tick.has(key))
}

export type ReviewKey = 'publish' | 'flag' | 'next' | 'prev' | 'edit'

interface KeyLike {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  target?: { tagName?: string; isContentEditable?: boolean } | null
}

/** The review keys; nothing while typing in a box or with a modifier held (Ctrl+P still prints). */
export function reviewKey(e: KeyLike): ReviewKey | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  const tag = e.target?.tagName?.toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return null
  switch (e.key) {
    case 'p':
    case 'P':
      return 'publish'
    case 'f':
    case 'F':
      return 'flag'
    case 'ArrowRight':
    case 'n':
    case 'N':
      return 'next'
    case 'ArrowLeft':
      return 'prev'
    case 'e':
    case 'E':
      return 'edit'
    default:
      return null
  }
}

/**
 * The position to show after `from` going `step` (1 forward, -1 back; from = -1 starts at the top), skipping pills
 * done this session and, when asked, pills already flagged back to the team. -1 when there is none.
 */
export function nextIndex(items: QueueItem[], from: number, step: 1 | -1, skipFlagged: boolean, done: ReadonlySet<string>): number {
  for (let i = from + step; i >= 0 && i < items.length; i += step) {
    const item = items[i]
    if (done.has(item.id)) continue
    if (skipFlagged && item.flagged) continue
    return i
  }
  return -1
}
