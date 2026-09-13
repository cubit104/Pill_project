import { describe, expect, it } from 'vitest'
import { classOf, classText, dateRange, drugQueries, isoDate, ndcVariants, newRecallIds, normNdc9, parseRecalls, productNdc } from './recalls'

const feed = {
  results: [
    {
      recall_number: 'D-0001-2025',
      classification: 'Class II',
      report_date: '20250416',
      status: 'Ongoing',
      recalling_firm: 'Glenmark Pharmaceuticals Inc., USA',
      product_description: 'Metformin Hydrochloride Extended-Release Tablets 1000mg, 90-count bottle',
      code_info: 'Lot # 17232088, exp. date Sep-25',
      reason_for_recall: 'CGMP Deviations',
      openfda: { product_ndc: ['68462-520', '68462-521'] },
    },
    {
      recall_number: 'D-0002-2025',
      classification: 'Class I',
      report_date: '20250416',
      status: 'Terminated',
      recalling_firm: 'Granules',
      product_description: 'Metformin HCl ER 500 mg, 1000-count',
      code_info: 'Lot 4911311A',
      reason_for_recall: 'Presence of Foreign Tablets',
      openfda: {},
    },
    { recall_number: 'D-0002-2025', product_description: 'duplicate row', report_date: '20250101' },
    { recall_number: 'D-0003-2025', product_description: '', report_date: '20250101' },
    { event_id: '99', product_description: 'No recall number but a product', classification: 'CLASS III', recall_initiation_date: '20241231' },
  ],
}

describe('parseRecalls', () => {
  it('parses, dedupes, flags the exact product and sorts newest first with exact ahead', () => {
    const rows = parseRecalls(feed, '68462-0520')
    expect(rows.map((r) => r.id)).toEqual(['D-0001-2025', 'D-0002-2025', '99:No recall number but a product'])
    const g = rows[0]!
    expect(g.cls).toBe('II')
    expect(g.date).toBe('2025-04-16')
    expect(g.firm).toBe('Glenmark Pharmaceuticals Inc., USA')
    expect(g.lots).toContain('17232088')
    expect(g.ndcs).toEqual(['68462-520', '68462-521'])
    expect(g.exact).toBe(true)
    expect(rows[1]!.exact).toBe(false)
    expect(rows[1]!.cls).toBe('I')
    expect(rows[2]!.cls).toBe('III')
    expect(rows[2]!.date).toBe('2024-12-31') // falls back to the initiation date
  })

  it('is safe on the "no matches" shape and garbage', () => {
    expect(parseRecalls({ results: [] })).toEqual([])
    expect(parseRecalls(null)).toEqual([])
    expect(parseRecalls({ error: { code: 'NOT_FOUND' } })).toEqual([])
  })
})

describe('helpers', () => {
  it('reads classes and dates', () => {
    expect(classOf('Class II')).toBe('II')
    expect(classOf('class iii')).toBe('III')
    expect(classOf('Class I')).toBe('I')
    expect(classOf('')).toBe('')
    expect(classText('I')).toContain('serious')
    expect(isoDate('20250416')).toBe('2025-04-16')
    expect(isoDate('bad')).toBe('')
  })

  it('derives the product NDC the FDA uses', () => {
    expect(productNdc({ ndc11: '68462-0520-90' })).toBe('68462-0520')
    expect(productNdc({ ndc11: '68462052090' })).toBe('68462-0520')
    expect(productNdc({ ndc9: '68462-520' })).toBe('68462-520')
    expect(productNdc({ ndc9: null, ndc11: null, ndc: '0093117401' })).toBe('00931-1740')
    expect(productNdc({})).toBeNull()
  })

  it('builds the FDA search clauses', () => {
    const now = new Date(2026, 8, 13)
    expect(dateRange(now, 365)).toBe('report_date:[20250913+TO+20260913]')
    const q = drugQueries('Metformin Hydrochloride', '68462-520', now)
    expect(q).toHaveLength(2)
    expect(q[0]).toContain('openfda.product_ndc:%2268462-520%22')
    expect(q[0]).toContain('+AND+report_date:[20250913+TO+20260913]')
    expect(drugQueries('x', '68462-0520', now)[0]).toContain('%2268462-520%22') // the FDA's spelling is tried too
    expect(q[1]).toContain('openfda.generic_name:%22Metformin%20Hydrochloride%22')
    expect(q[1]).toContain('product_description:%22Metformin%22')
    expect(q[1]).toContain('product_description:Metformin*')
    expect(drugQueries('Ola', null, now)[0]).not.toContain('*') // too short to wildcard
    expect(drugQueries('Lipitor', null, now)).toHaveLength(1)
    expect(drugQueries('', null, now)).toHaveLength(0)
  })

  it('treats NDC widths as the same product', () => {
    expect(normNdc9('68462-520')).toBe('684620520')
    expect(normNdc9('68462-0520')).toBe('684620520')
    expect(normNdc9('0093-1174')).toBe('000931174')
    expect(ndcVariants('68462-0520').sort()).toEqual(['68462-0520', '68462-520'])
    expect(ndcVariants('0093-1174').sort()).toEqual(['00093-1174', '0093-1174'])
    expect(ndcVariants('nope')).toEqual(['nope'])
  })

  it('finds the recalls not yet alerted about', () => {
    const rows = parseRecalls(feed)
    const bySlug = { 'metformin-500': rows, 'metformin-1000': [rows[0]!] }
    expect(newRecallIds(bySlug, new Set(['D-0001-2025'])).sort()).toEqual(['99:No recall number but a product', 'D-0002-2025'])
    expect(newRecallIds(bySlug, new Set(rows.map((r) => r.id)))).toEqual([])
  })
})
