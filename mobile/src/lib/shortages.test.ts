import { describe, expect, it } from 'vitest'
import { availabilityOf, isoFromUsDate, parseShortage, shortageQuery } from './shortages'

const row = (over: Record<string, unknown>) => ({
  status: 'Current',
  dosage_form: 'INJECTION',
  presentation: 'Heparin Sodium Injection, 5,000 units/mL, 1 mL vial (NDC 0409-2720-01)',
  company_name: 'Pfizer',
  availability: 'Available',
  initial_posting_date: '11/14/2017',
  update_date: '03/01/2026',
  ...over,
})

describe('FDA shortage feed', () => {
  it('reads US dates and availability words', () => {
    expect(isoFromUsDate('3/9/2026')).toBe('2026-03-09')
    expect(isoFromUsDate('2026-03-09')).toBe('')
    expect(availabilityOf('Product Unavailable')).toBe('unavailable')
    expect(availabilityOf('Limited Supply Available')).toBe('limited')
    expect(availabilityOf('Available')).toBe('available')
    expect(availabilityOf(null)).toBe('unknown')
  })

  it('keeps only current injectable records, strips the NDC from the presentation and counts what is short', () => {
    const shortage = parseShortage({
      results: [
        row({}),
        row({ availability: 'Product Unavailable', presentation: 'Heparin 25,000 units/250 mL bag', company_name: 'Baxter', update_date: '05/20/2026' }),
        row({ status: 'Resolved', availability: 'Product Unavailable' }),
        row({ dosage_form: 'TABLET', openfda: { route: ['ORAL'] }, availability: 'Product Unavailable' }),
      ],
    })
    expect(shortage).not.toBeNull()
    expect(shortage?.items.map((i) => [i.presentation, i.availability])).toEqual([
      ['Heparin 25,000 units/250 mL bag', 'unavailable'],
      ['Heparin Sodium Injection, 5,000 units/mL, 1 mL vial', 'available'],
    ])
    expect(shortage).toMatchObject({ since: '2017-11-14', updated: '2026-05-20', constrained: 1, available: 1 })
  })

  it('is null when nothing injectable is current, and the query quotes the name', () => {
    expect(parseShortage({ results: [row({ status: 'Resolved' })] })).toBeNull()
    expect(parseShortage({ error: { code: 'NOT_FOUND' } })).toBeNull()
    expect(decodeURIComponent(shortageQuery('heparin "sodium"'))).toBe('generic_name:"heparin sodium" AND status:"Current"')
    expect(shortageQuery('  ')).toBe('')
  })
})
