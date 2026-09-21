import test from 'node:test'
import assert from 'node:assert/strict'

import { availabilityOf, isoFromUsDate, parseShortage, shortageQuery } from '../shortages.ts'

const row = (over: Record<string, unknown> = {}) => ({
  status: 'Current',
  generic_name: 'Heparin Sodium Injection',
  dosage_form: 'Injection',
  presentation: 'Heparin Sodium, Injection, 1,000 Units/500 mL (2 Units/mL) (NDC 0409-1005-20)',
  company_name: 'Hospira, Inc.',
  availability: 'Available',
  initial_posting_date: '11/14/2017',
  update_date: '09/11/2026',
  ...over,
})

test('dates and availability are read from the FDA wording', () => {
  assert.equal(isoFromUsDate('11/14/2017'), '2017-11-14')
  assert.equal(isoFromUsDate('3/5/2026'), '2026-03-05')
  assert.equal(isoFromUsDate('2026-03-05'), '')
  assert.equal(availabilityOf('Limited Availability'), 'limited')
  assert.equal(availabilityOf('Unavailable'), 'unavailable') // must not be read as "available"
  assert.equal(availabilityOf('Available'), 'available')
  assert.equal(availabilityOf(undefined), 'unknown')
})

test('query asks for current records of that drug and survives odd names', () => {
  assert.equal(decodeURIComponent(shortageQuery('Heparin')), 'generic_name:"Heparin" AND status:"Current"')
  assert.equal(decodeURIComponent(shortageQuery('  Bad "name"\\ ')), 'generic_name:"Bad name" AND status:"Current"')
  assert.equal(shortageQuery('  '), '')
})

test('counts what is limited or unavailable, worst first, oldest posting date, newest update', () => {
  const shortage = parseShortage({
    results: [
      row(),
      row({ availability: 'Limited Availability', presentation: 'Heparin 2,000 Units in Sodium Chloride (NDC 1-2-3)', update_date: '09/15/2026' }),
      row({ availability: 'Unavailable', presentation: 'Heparin 200 Units/100 mL (NDC 9-9-9)', initial_posting_date: '01/02/2016' }),
    ],
  })
  assert.ok(shortage)
  assert.equal(shortage.constrained, 2)
  assert.deepEqual(shortage.items.map((i) => i.availability), ['unavailable', 'limited', 'available'])
  assert.equal(shortage.items[0].presentation, 'Heparin 200 Units/100 mL') // the NDC suffix is dropped
  assert.equal(shortage.since, '2016-01-02')
  assert.equal(shortage.updated, '2026-09-15')
})

test('tablets, resolved records and empty answers are not an IV shortage', () => {
  assert.equal(parseShortage({ results: [row({ dosage_form: 'Tablet' })] }), null)
  assert.equal(parseShortage({ results: [row({ status: 'Resolved' })] }), null)
  assert.equal(parseShortage({ results: [] }), null)
  assert.equal(parseShortage(null), null)
  // an injectable listed under another form name still counts when FDA says it is given intravenously
  assert.ok(parseShortage({ results: [row({ dosage_form: 'Solution', openfda: { route: ['INTRAVENOUS'] } })] }))
})
