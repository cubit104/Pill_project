import type { PillResult, PillDetail } from '../types'

/**
 * Superset of all raw pill field names that may appear in API responses
 * or internal data models. Allows buildPillAlt to work across PillResult,
 * PillDetail, and raw API payloads.
 */
export interface PillLike {
  drug_name?: string
  medicine_name?: string
  imprint?: string
  splimprint?: string
  color?: string
  splcolor_text?: string
  shape?: string
  splshape_text?: string
  strength?: string
  spl_strength?: string
}

/**
 * Build a descriptive alt attribute for a pill image.
 * Prefers "{Color} {Shape} pill with imprint {Imprint} — {Drug Name} {Strength}"
 * Falls back gracefully when fields are missing.
 *
 * Examples:
 *   "White round pill with imprint M367 — Hydrocodone/Acetaminophen 10mg/325mg"
 *   "Blue oval pill — Sildenafil 50mg"
 *   "Lisinopril 10mg pill"
 */
export function buildPillAlt(
  pill: Pick<PillDetail, 'drug_name' | 'imprint' | 'color' | 'shape' | 'strength'> | PillResult | PillLike,
  opts?: { imageIndex?: number; totalImages?: number }
): string {
  const p = pill as PillLike
  const drugName = p.drug_name ?? p.medicine_name ?? 'Unknown'
  const imprint = p.imprint ?? p.splimprint
  const color = p.color ?? p.splcolor_text
  const shape = p.shape ?? p.splshape_text
  const strength = p.strength ?? p.spl_strength

  const descriptor = [color, shape].filter(Boolean).join(' ').trim()
  const drugPart = [drugName, strength].filter(Boolean).join(' ').trim()

  let result: string
  if (descriptor) {
    // "{Color} {Shape} pill [with imprint {Imprint}] — {Drug} {Strength}"
    const parts: string[] = [`${cap(descriptor)} pill`]
    if (imprint) parts.push(`with imprint ${imprint}`)
    const prefix = parts.join(' ')
    result = drugPart ? `${prefix} — ${drugPart}` : prefix
  } else {
    // No color/shape: "{Drug} {Strength} pill [with imprint {Imprint}]"
    const parts: string[] = [drugPart || 'Unknown', 'pill']
    if (imprint) parts.push(`with imprint ${imprint}`)
    result = parts.join(' ')
  }

  // Disambiguate multi-image galleries for accessibility
  if (opts?.totalImages && opts.totalImages > 1 && opts.imageIndex != null) {
    result += ` (image ${opts.imageIndex + 1} of ${opts.totalImages})`
  }
  return result
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
