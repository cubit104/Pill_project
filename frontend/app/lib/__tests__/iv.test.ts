import test from 'node:test'
import assert from 'node:assert/strict'

import { isIntravenous, isIvPageIndexable, ivHeaderProps, ivTabHrefs, type IvDrug } from '../iv.ts'

const drug = (routes: string[], pages: Partial<IvDrug['label_pages']> = {}): IvDrug =>
  ({
    slug: 'medroxyprogesterone',
    name: 'Medroxyprogesterone',
    brand_names: ['Depo-Provera'],
    drug_class: [],
    routes,
    label_pages: { has_professional: true, has_dosage: true, has_adverse_reactions: false, has_medguide: false, has_boxed_warning: false, ...pages },
  }) as unknown as IvDrug

test('a page says IV only for a drug that is given intravenously', () => {
  assert.equal(isIntravenous(drug(['Intravenous'])), true)
  assert.equal(isIntravenous(drug(['Intramuscular', 'Intravenous'])), true)
  assert.equal(isIntravenous(drug(['Intramuscular'])), false)
  assert.equal(isIntravenous(drug(['Subcutaneous'])), false)
  assert.equal(isIntravenous(drug([])), true) // nothing on file: the section began as IV only
})

test('an intramuscular drug gets its own tab words and keeps the label tabs', () => {
  const shot = ivTabHrefs(drug(['Intramuscular']))
  assert.deepEqual(shot.ivCardLabels, { label: 'Administration', mobileLabel: 'Admin' })
  assert.equal(shot.ivCardHref, '/iv/medroxyprogesterone')
  assert.equal(shot.dosageHref, '/iv/medroxyprogesterone/dosage')
  assert.equal(shot.adverseReactionsHref, null)
  assert.equal(ivTabHrefs(drug(['Intravenous'])).ivCardLabels, undefined) // IV drugs keep "IV Administration"
  assert.equal(ivHeaderProps(drug(['Intramuscular', 'Oral'])).dosageForm, 'Injection (Intramuscular)')
})

test('the Medication Guide tab shows only when the label carries one', () => {
  assert.equal(ivTabHrefs(drug(['Subcutaneous'])).medicationGuideHref, null)
  assert.equal(ivTabHrefs(drug(['Subcutaneous'], { has_medguide: true })).medicationGuideHref, '/iv/medroxyprogesterone/medication-guide')
})

test('a page with any label content or a card is indexable, an empty one is not', () => {
  const nothing = { hasCard: false, hasProfessional: false, hasDosage: false, hasAdverseReactions: false }
  assert.equal(isIvPageIndexable(nothing), false)
  assert.equal(isIvPageIndexable({ ...nothing, hasAdverseReactions: true }), true)
  assert.equal(isIvPageIndexable({ ...nothing, hasCard: true }), true)
})
