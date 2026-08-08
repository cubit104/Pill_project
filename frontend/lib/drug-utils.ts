import type { PillResult, SearchResponse } from '../types'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'

export function toTitleCase(str: string): string {
  return str
    .split(/[\s-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

export type DrugSearchResult = {
  results: PillResult[]
  fallbackUsed: boolean
  fallbackTerm: string | null
}

async function searchDrug(term: string): Promise<DrugSearchResult> {
  try {
    const params = new URLSearchParams({ q: term, type: 'drug', per_page: '48' })
    const res = await fetch(`${API_BASE}/api/search?${params}`, {
      next: { revalidate: 3600 },
    })
    if (!res.ok) return { results: [], fallbackUsed: false, fallbackTerm: null }
    const data: SearchResponse = await res.json()
    return {
      results: data.results,
      fallbackUsed: Boolean(data.fallback_used),
      fallbackTerm: data.fallback_term ?? null,
    }
  } catch {
    return { results: [], fallbackUsed: false, fallbackTerm: null }
  }
}

/**
 * Try the route param as-is first (handles legitimately hyphenated names like "co-trimoxazole").
 * If no results, fall back to replacing hyphens with spaces (handles slug-style URLs like
 * "mircette-28-dp-331" → "mircette 28 dp 331").
 */
export async function fetchPillsByDrug(name: string): Promise<DrugSearchResult> {
  const firstPass = await searchDrug(name)
  if (firstPass.results.length > 0) return firstPass
  const deSlugged = name.replace(/-/g, ' ')
  if (deSlugged === name) return firstPass
  return searchDrug(deSlugged)
}
