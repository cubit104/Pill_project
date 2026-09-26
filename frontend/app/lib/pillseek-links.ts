import { displayDrugName, indexPrefix } from './drug-search'
import { fetchDrugIndex } from './iv'
import { slugifyDrugName } from './slug'

/** A link from an FDA news page to PillSeek's own page for the same medicine. */
export interface PillSeekLink {
  label: string
  href: string
}

/**
 * "Dextrose Monohydrate", "Pentostatin Injection" -> the names to look up: the whole name, then its first two
 * words and its first word, when long enough to name a medicine (not "Sodium" or "Vitamin" alone).
 */
export function nameCandidates(names: string[]): string[] {
  const out = new Set<string>()
  for (const name of names) {
    const words = name.toLowerCase().replace(/[^a-z0-9\s-]+/g, ' ').split(/\s+/).filter(Boolean)
    for (const candidate of [words.join(' '), words.slice(0, 2).join(' '), words[0] ?? '']) {
      if (candidate.replace(/[^a-z]/g, '').length >= 6 && !/^(sodium|vitamin|potassium|calcium|insulin|magnesium|sterile|water)$/.test(candidate)) out.add(candidate)
    }
  }
  return [...out]
}

/**
 * The medicine's pages on PillSeek, looked up in the drug index like the A to Z pages: its pills (/drug/…) and its
 * IV page. Empty when it is not on PillSeek (yet), or when the index does not answer.
 */
export async function pillSeekLinks(names: string[]): Promise<PillSeekLink[]> {
  const candidates = nameCandidates(names)
  const prefixes = [...new Set(candidates.map(indexPrefix).filter((p): p is string => p !== null))]
  const indexes = await Promise.all(prefixes.map((p) => fetchDrugIndex(p).catch(() => null)))
  const entries = indexes.flatMap((index) => index?.entries ?? [])
  const links: PillSeekLink[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    for (const entry of entries.filter((e) => e.name.toLowerCase() === candidate)) {
      const name = displayDrugName(entry.name)
      if (entry.pill_count > 0 && !seen.has(`pills:${candidate}`)) {
        seen.add(`pills:${candidate}`)
        links.push({ label: `${name}: ${entry.pill_count} ${entry.pill_count === 1 ? 'pill' : 'pills'} to identify`, href: `/drug/${slugifyDrugName(entry.name)}` })
      }
      if (entry.iv_slug && !seen.has(`iv:${entry.iv_slug}`)) {
        seen.add(`iv:${entry.iv_slug}`)
        links.push({ label: `${name}: IV and injection guide`, href: `/iv/${entry.iv_slug}` })
      }
    }
  }
  return links
}
