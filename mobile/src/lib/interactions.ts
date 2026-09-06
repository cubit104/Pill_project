/** Pure helpers for the interactions checker (kept DOM-free so they're testable). */

export const MAX_DRUGS = 10

export type Severity = 'major' | 'moderate' | 'minor' | 'unknown'

export function normaliseSeverity(v: string | null | undefined): Severity {
  const s = (v ?? '').trim().toLowerCase()
  if (s === 'major' || s === 'high' || s === 'severe' || s === 'contraindicated') return 'major'
  if (s === 'moderate' || s === 'medium') return 'moderate'
  if (s === 'minor' || s === 'low' || s === 'mild') return 'minor'
  return 'unknown'
}

export const SEVERITY_ORDER: Record<Severity, number> = { major: 0, moderate: 1, minor: 2, unknown: 3 }

export const SEVERITY_LABEL: Record<Severity, string> = {
  major: 'Major',
  moderate: 'Moderate',
  minor: 'Minor',
  unknown: 'Unknown',
}

/** Trim, drop empties, dedupe case-insensitively, cap at MAX_DRUGS (order kept). */
export function normaliseDrugList(names: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of names) {
    const name = raw.trim().replace(/\s+/g, ' ')
    const key = name.toLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    out.push(name)
    if (out.length === MAX_DRUGS) break
  }
  return out
}

/** "?drugs=warfarin,aspirin" → ["warfarin", "aspirin"]. */
export function parseDrugsParam(value: string | null): string[] {
  if (!value) return []
  return normaliseDrugList(value.split(','))
}

export function drugsParam(names: string[]): string {
  return names.map((n) => n.trim()).filter(Boolean).join(',')
}

/** Route into the checker with a drug preselected. */
export function interactionsPath(...names: string[]): string {
  const list = normaliseDrugList(names)
  return list.length ? `/interactions?drugs=${encodeURIComponent(drugsParam(list))}` : '/interactions'
}
