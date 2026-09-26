/** Admin -> Drafts -> "Review one by one" and "Grid": what the pages say about a draft pill, and what the keys do. */

/** The editor's completeness score a draft is published at: brand names and RxCUI Alt are empty on drafts. */
export const READY_SCORE = 92

export interface QueueItem {
  id: string
  medicine_name: string | null
  strength: string | null
  imprint: string | null
  flagged: boolean
  missing: string[]
  /** The pill editor's completeness score, 0 to 100. */
  score: number
  /** Whether "what it's used for" is filled: publishing waits for it. */
  used_for: boolean
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
  /** The name it is kept under: a brand pill's own ("zestril"), else the generic ("lisinopril"). */
  key: string | null
  /** Where the text shown came from, when not `key`: a brand pill without its own shows the generic's. */
  shown_from: string | null
  audio_url: string | null
  /** missing: none saved; odd: notes pasted in; other_name: it spells out another name (usually the brand). */
  problem: 'missing' | 'odd' | 'other_name' | null
  checked_by: string | null
  checked_at: string | null
}

export interface ReviewItem {
  pill: ReviewPill
  photos: string[]
  score: number
  warnings: { field: string; message: string }[]
  indication: Indication | null
  pronunciation: Pronunciation
  flags: { missing: string[]; note: string | null; flagged_by: string | null; flagged_at: string | null } | null
}

/** One pill in the grid. */
export interface Card {
  id: string
  medicine_name: string | null
  strength: string | null
  imprint: string | null
  color: string | null
  shape: string | null
  size: string | null
  rxcui: string | null
  photo: string | null
  score: number
  used_for: boolean
  pronunciation: Pronunciation
  published: boolean
  updated_at: string | null
}

export type Tone = 'ok' | 'warn' | 'bad' | 'none'

export interface Check {
  tone: Tone
  text: string
}

/** The editor's score in words: green at the score drafts are published at. */
export function scoreCheck(score: number): Check {
  return { tone: score >= READY_SCORE ? 'ok' : 'warn', text: `${score}%` }
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
  if (p.problem === 'other_name') {
    const theirs = p.shown_from && p.shown_from !== p.key ? `: this is ${p.shown_from}'s, ${p.key} has none of its own` : ": another name's pronunciation?"
    return { tone: 'bad', text: `Does not sound like "${p.key}"${theirs}` }
  }
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

/** Why P needs a second press: there is no photo to check the imprint against. */
export function publishWarnings(item: ReviewItem): string[] {
  return item.photos.length === 0 ? ['This pill has no photo'] : []
}

/** What F ticks before the publisher adjusts it: what the team was told before, a missing photo or "used for". */
export function suggestedFlags(item: ReviewItem): string[] {
  const tick = new Set(item.flags?.missing ?? [])
  if (item.photos.length === 0) tick.add('images')
  if (!item.indication) tick.add('meds_use')
  return ['images', 'meds_use', 'imprint', 'other'].filter((key) => tick.has(key))
}

/** Grid: ready to publish with the rest, as the publisher does now: at the usual score, "used for" filled. */
export function isReady(item: Pick<QueueItem, 'score' | 'used_for' | 'flagged'>): boolean {
  return item.score >= READY_SCORE && item.used_for && !item.flagged
}

/** Grid: why a card cannot be ticked, or null when it can. The server refuses the same. */
export function tickBlocker(card: Pick<Card, 'published' | 'rxcui' | 'used_for'>): string | null {
  if (card.published) return 'Already published'
  if (!card.rxcui) return 'No RxCUI: fix it in the editor'
  if (!card.used_for) return '"What it\'s used for" is empty'
  return null
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
