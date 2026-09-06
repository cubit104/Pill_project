import type { SearchResult } from './api'

/**
 * Drug-name and NDC searches return one row per pill (each strength / NDC).
 * The app shows those grouped by drug, like the website, with the strengths
 * listed underneath — photos only matter when matching an imprint.
 */
export interface DrugGroup {
  key: string
  name: string
  /** Ingredient text from the strength field when it differs from the drug name. */
  generic: string | null
  /** Distinct strength labels in result order, e.g. ["75 mg", "300 mg"]. */
  strengths: string[]
  items: SearchResult[]
}

const STRENGTH_RE = /(\d+(?:[.,]\d+)?\s*(?:mcg|mg|g|ml|mL|%|units?|iu|meq|mmol)\b(?:\s*\/\s*(?:\d+(?:[.,]\d+)?\s*)?\w+)?)/i

/** "CLOPIDOGREL BISULFATE 300 mg;" → "300 mg". Falls back to the trimmed text. */
export function strengthLabel(strength: string | null | undefined): string | null {
  if (!strength) return null
  const m = STRENGTH_RE.exec(strength)
  if (m?.[1]) return m[1].replace(/\s+/g, ' ').trim()
  const t = strength.replace(/[;,\s]+$/, '').trim()
  return t || null
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

/** "CLOPIDOGREL BISULFATE 300 mg;" → "Clopidogrel Bisulfate" (null when nothing precedes the number). */
export function ingredientFromStrength(strength: string | null | undefined): string | null {
  if (!strength) return null
  const m = STRENGTH_RE.exec(strength)
  const head = (m ? strength.slice(0, m.index) : '').replace(/[;,\s]+$/, '').trim()
  return head ? titleCase(head) : null
}

export function groupByDrug(results: SearchResult[]): DrugGroup[] {
  const groups: DrugGroup[] = []
  const byKey = new Map<string, DrugGroup>()
  for (const r of results) {
    const key = r.drug_name.trim().toLowerCase()
    let g = byKey.get(key)
    if (!g) {
      const ingredient = ingredientFromStrength(r.strength)
      g = {
        key,
        name: r.drug_name.trim(),
        generic: ingredient && ingredient.toLowerCase() !== key ? ingredient : null,
        strengths: [],
        items: [],
      }
      byKey.set(key, g)
      groups.push(g)
    }
    g.items.push(r)
    const label = strengthLabel(r.strength)
    if (label && !g.strengths.includes(label)) g.strengths.push(label)
  }
  return groups
}
