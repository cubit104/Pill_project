/**
 * "Goals" are Home tiles that need a drug first: the user picks a drug in
 * Search, then lands on that section of the pill page. Carried through the
 * URL as ?goal=… on /search and ?section=… on /pill/:slug.
 */
export const GOALS = {
  'adverse-reactions': { label: 'Side effects', prompt: 'Find a drug to see its side effects' },
  dosage: { label: 'Dosage', prompt: 'Find a drug to see how it is taken' },
  'medication-guide': { label: 'Medication guide', prompt: 'Find a drug to read its medication guide' },
  'professional-information': { label: 'Professional info', prompt: 'Find a drug to see its prescribing information' },
  price: { label: 'Price guide', prompt: 'Find a drug to see what it costs' },
} as const

export type Goal = keyof typeof GOALS

export function isGoal(v: string | null | undefined): v is Goal {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(GOALS, v)
}

/** Search-tab URL for a goal (drug-name mode, since goals are per drug). */
export function goalSearchPath(goal: Goal): string {
  return `/search?type=drug&goal=${goal}`
}

/** Pill page, or the native section screen when a goal is set. */
export function goalPillPath(slug: string, goal: Goal | null): string {
  const base = `/pill/${encodeURIComponent(slug)}`
  return goal ? `${base}/${goal}` : base
}

/** Every native section screen, in the order shown in the chip row. */
export const SECTIONS = {
  'medication-guide': { label: 'Medication guide', short: 'Med guide' },
  dosage: { label: 'Dosage', short: 'Dosage' },
  'adverse-reactions': { label: 'Side effects', short: 'Side effects' },
  'professional-information': { label: 'Prescribing information', short: 'Pro info' },
  price: { label: 'Price guide', short: 'Price' },
} as const

export type Section = keyof typeof SECTIONS

export function isSection(v: string | null | undefined): v is Section {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SECTIONS, v)
}

export function sectionPath(slug: string, section: Section): string {
  return `/pill/${encodeURIComponent(slug)}/${section}`
}

/** Parse "/pill/<slug>" or "/pill/<slug>/<section>". */
export function parsePillPath(pathname: string): { slug: string; section: Section | null } | null {
  if (!pathname.startsWith('/pill/')) return null
  const rest = pathname.slice('/pill/'.length)
  const i = rest.indexOf('/')
  const slug = decodeURIComponent(i === -1 ? rest : rest.slice(0, i))
  if (!slug) return null
  const tail = i === -1 ? '' : rest.slice(i + 1)
  return { slug, section: isSection(tail) ? tail : null }
}
