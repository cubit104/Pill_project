import { describe, expect, it } from 'vitest'
import type { SearchResult } from '../lib/api'
import { groupByDrug, ingredientFromStrength, strengthLabel } from '../lib/drugGroups'

function pill(over: Partial<SearchResult>): SearchResult {
  return {
    drug_name: 'Plavix',
    imprint: '',
    color: null,
    shape: null,
    ndc: null,
    rxcui: null,
    slug: null,
    strength: null,
    image_url: null,
    images: [],
    has_multiple_images: false,
    ...over,
  }
}

describe('strengthLabel / ingredientFromStrength', () => {
  it('extracts the dose and the ingredient', () => {
    expect(strengthLabel('CLOPIDOGREL BISULFATE 300 mg;')).toBe('300 mg')
    expect(strengthLabel('Amoxicillin 875 mg / Clavulanate 125 mg')).toBe('875 mg / Clavulanate')
    expect(strengthLabel('12.5 mcg/hr')).toBe('12.5 mcg/hr')
    expect(strengthLabel('  ;')).toBeNull()
    expect(strengthLabel(null)).toBeNull()
    expect(ingredientFromStrength('CLOPIDOGREL BISULFATE 300 mg;')).toBe('Clopidogrel Bisulfate')
    expect(ingredientFromStrength('300 mg')).toBeNull()
  })
})

describe('groupByDrug', () => {
  it('groups rows by drug name keeping order and distinct strengths', () => {
    const rows = [
      pill({ slug: 'plavix-300', strength: 'CLOPIDOGREL BISULFATE 300 mg;' }),
      pill({ drug_name: 'Lisinopril', slug: 'lis-10', strength: 'LISINOPRIL 10 mg' }),
      pill({ slug: 'plavix-75', strength: 'CLOPIDOGREL BISULFATE 75 mg;' }),
      pill({ slug: 'plavix-75b', strength: 'CLOPIDOGREL BISULFATE 75 mg;' }),
    ]
    const g = groupByDrug(rows)
    expect(g.map((x) => x.name)).toEqual(['Plavix', 'Lisinopril'])
    expect(g[0]?.strengths).toEqual(['300 mg', '75 mg'])
    expect(g[0]?.items).toHaveLength(3)
    expect(g[0]?.generic).toBe('Clopidogrel Bisulfate')
    expect(g[1]?.generic).toBeNull()
  })
})
