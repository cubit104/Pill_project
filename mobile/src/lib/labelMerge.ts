/**
 * Live label scanning: a bottle is curved, so no single frame shows the whole
 * label. We OCR frame after frame while the user turns the bottle and merge
 * what each frame read. Two layers of merging, both pure and tested:
 *   - lines:  keep the best version of each printed line across frames
 *   - fields: parse every frame and keep the best value per field
 */
import { parseLabel, type OcrLine, type ParsedLabel } from './labelParse'

export interface LineMemory {
  text: string
  key: string
  seen: number
  confidence: number
  /** Average vertical position, to keep reading order stable across frames. */
  y: number
  order: number
}

function keyOf(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

/** True when `a` is a prefix of `b` or vice versa, or they differ in one short token (OCR flicker). */
function sameLine(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length >= 6 && (b.startsWith(a) || a.startsWith(b))) return true
  const ta = a.split(' ')
  const tb = b.split(' ')
  // Truncated by the curve: the shorter reading matches the start of the longer one, last token cut mid-word.
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  if (short.length >= 3 && short.slice(0, -1).every((t, i) => t === long[i])) {
    const tail = short[short.length - 1] ?? ''
    const full = long[short.length - 1] ?? ''
    if (full.startsWith(tail.slice(0, 2)) || tail.startsWith(full.slice(0, 2))) return true
  }
  if (Math.abs(ta.length - tb.length) > 1) return false
  const common = ta.filter((t) => tb.includes(t)).length
  return common >= Math.max(2, Math.min(ta.length, tb.length) - 1)
}

/** Fold one frame's lines into memory. Longer or better-confidence readings replace shorter ones. */
export function mergeLines(memory: LineMemory[], frame: OcrLine[]): LineMemory[] {
  const next = memory.map((m) => ({ ...m }))
  for (const line of frame) {
    const text = line.text.replace(/\s+/g, ' ').trim()
    if (text.length < 2) continue
    const key = keyOf(text)
    if (!key) continue
    const conf = line.confidence ?? 0.5
    const y = line.y ?? 0.5
    const hit = next.find((m) => sameLine(m.key, key))
    if (!hit) {
      next.push({ text, key, seen: 1, confidence: conf, y, order: next.length })
      continue
    }
    hit.seen++
    hit.y = (hit.y * (hit.seen - 1) + y) / hit.seen
    // Prefer the longer reading (more of the curve seen); on a tie prefer confidence.
    if (key.length > hit.key.length || (key.length === hit.key.length && conf > hit.confidence)) {
      hit.text = text
      hit.key = key
      hit.confidence = conf
    }
  }
  return next
}

/** Memory → lines in reading order (by average y, then first-seen order), for the parser. */
export function memoryLines(memory: LineMemory[]): OcrLine[] {
  return [...memory].sort((a, b) => a.y - b.y || a.order - b.order).map((m) => ({ text: m.text, y: m.y, confidence: m.confidence }))
}

const EMPTY: ParsedLabel = {
  drugName: null,
  strength: null,
  form: null,
  directions: null,
  quantity: null,
  rxNumber: null,
  refills: null,
  fillDate: null,
  pharmacyName: null,
  pharmacyPhone: null,
  prescriber: null,
}

/** Field-level merge: fill blanks; directions and pharmacy take the longest reading. */
export function mergeLabels(acc: ParsedLabel | null, next: ParsedLabel): ParsedLabel {
  const a = acc ?? EMPTY
  const longer = (x: string | null, y: string | null) => (y && (!x || y.length > x.length) ? y : x)
  return {
    drugName: a.drugName ?? next.drugName,
    strength: a.strength ?? next.strength,
    form: a.form ?? next.form,
    directions: longer(a.directions, next.directions),
    quantity: a.quantity ?? next.quantity,
    rxNumber: a.rxNumber ?? next.rxNumber,
    refills: a.refills ?? next.refills,
    fillDate: a.fillDate ?? next.fillDate,
    pharmacyName: longer(a.pharmacyName, next.pharmacyName),
    pharmacyPhone: a.pharmacyPhone ?? next.pharmacyPhone,
    prescriber: a.prescriber ?? next.prescriber,
  }
}

/** Parse one frame and the accumulated memory, and merge both into the running result. */
export function foldFrame(state: { memory: LineMemory[]; label: ParsedLabel | null }, frame: OcrLine[]): { memory: LineMemory[]; label: ParsedLabel } {
  const memory = mergeLines(state.memory, frame)
  const fromFrame = parseLabel(frame)
  const fromMemory = parseLabel(memoryLines(memory))
  return { memory, label: mergeLabels(mergeLabels(state.label, fromMemory), fromFrame) }
}

/** The directions look finished when they end in a frequency phrase rather than mid-word. */
export function directionsComplete(d: string | null): boolean {
  if (!d) return false
  const s = d.toLowerCase()
  return s.split(' ').length >= 4 && /(daily|day|hours?|bedtime|morning|evening|night|needed|meals?|weekly|week|mouth|tablets?|capsules?)\b\.?$/.test(s)
}

export type Missing = 'drug' | 'directions' | 'quantity' | 'rx'

/** What the live scanner still needs before it can stop by itself. */
export function missingFields(p: ParsedLabel | null): Missing[] {
  const out: Missing[] = []
  if (!p?.drugName || !p.strength) out.push('drug')
  if (!directionsComplete(p?.directions ?? null)) out.push('directions')
  if (!p?.quantity) out.push('quantity')
  if (!p?.rxNumber) out.push('rx')
  return out
}
