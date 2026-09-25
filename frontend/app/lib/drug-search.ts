import type { DrugIndexEntry, IvListItem } from './iv'
import { slugifyDrugName } from './slug'

/** One line of the search dropdown on the A to Z pages. */
export interface SearchOption {
  label: string
  href: string
  /** Brand names or other words, shown muted after the name. */
  note?: string
  /** Words that also find it without being shown (defaults to the note): every brand name, not just those shown. */
  search?: string
  badge?: string
}

/** Pill names arrive as typed on the label: "VALTREX", "vardenafil". One style reads better in a list. */
export function displayDrugName(name: string): string {
  if (name !== name.toUpperCase() && name !== name.toLowerCase()) return name
  return name.toLowerCase().replace(/(^|[\s(/-])([a-z])/g, (_, before: string, letter: string) => before + letter.toUpperCase())
}

function plain(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** How well `text` answers `q` (both plain): 0 starts with it, 1 a word starts with it, 2 contains it, -1 no. */
function score(text: string, q: string): number {
  if (!text) return -1
  if (text.startsWith(q)) return 0
  if (` ${text}`.includes(` ${q}`)) return 1
  return text.includes(q) ? 2 : -1
}

/**
 * The best `limit` options for what was typed: names starting with it first, then a word in the name, then a
 * brand name, then anywhere in the name; alphabetical within each. Needs at least one letter or digit.
 */
export function matchOptions(options: SearchOption[], query: string, limit = 8): SearchOption[] {
  const q = plain(query)
  if (!q) return []
  const ranked: Array<[number, SearchOption]> = []
  for (const option of options) {
    const byName = score(plain(option.label), q)
    const byNote = score(plain(option.search ?? option.note ?? ''), q)
    const rank = byName >= 0 && byName < 2 ? byName : byNote >= 0 && byNote < 2 ? 2 : byName === 2 ? 3 : -1
    if (rank >= 0) ranked.push([rank, option])
  }
  return ranked
    .sort(([a, x], [b, y]) => a - b || x.label.localeCompare(y.label))
    .slice(0, limit)
    .map(([, option]) => option)
}

/** The IV drugs A to Z list, searchable by generic and brand name. */
export function ivSearchOptions(drugs: IvListItem[]): SearchOption[] {
  return drugs.map((drug) => ({
    label: drug.name,
    href: `/iv/${drug.slug}`,
    note: drug.brand_names.slice(0, 3).join(', ') || undefined,
    search: drug.brand_names.join(' ') || undefined,
  }))
}

/** The drug index answers by the first one or two letters ("me" for "metformin"); digits go under "0-9". */
export function indexPrefix(query: string): string | null {
  const q = plain(query).replace(/ /g, '')
  if (!q) return null
  if (/^[0-9]/.test(q)) return '0-9'
  return /^[a-z]{2}/.test(q) ? q.slice(0, 2) : q[0]
}

/** Drug index entries as dropdown lines, opening the same page the A to Z list opens. */
export function indexEntryOptions(entries: DrugIndexEntry[]): SearchOption[] {
  return entries.map((entry) => ({
    label: displayDrugName(entry.name),
    // a name that only exists as an IV drug opens its IV page; anything with pills opens the drug page
    href: entry.pill_count > 0 ? `/drug/${slugifyDrugName(entry.name)}` : `/iv/${entry.iv_slug}`,
    badge: [entry.pill_count > 0 && `${entry.pill_count} ${entry.pill_count === 1 ? 'pill' : 'pills'}`, entry.iv_slug && 'IV'].filter(Boolean).join(' · '),
  }))
}
