import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveHeaderMetadata } from '../headerMetadata'

test('resolveHeaderMetadata prefers pill synonym fields for generic-primary headers', () => {
  const meta = resolveHeaderMetadata({
    drugName: 'Losartan Potassium',
    pill: {
      generic_name: 'Losartan Potassium',
      brand_names_all: ['Cozaar'],
      pharma_class: 'Angiotensin II Receptor Blockers',
      dosage_form: 'Tablet',
      brand_or_generic: 'generic',
    },
    guide: {
      generic_name: null,
      brand_name: null,
      drug_class: null,
      dosage_form: null,
    },
  })

  assert.equal(meta.genericName, 'Losartan Potassium')
  assert.equal(meta.brandName, 'Cozaar')
  assert.equal(meta.drugClass, 'Angiotensin II Receptor Blockers')
  assert.equal(meta.dosageForm, 'Tablet')
  assert.equal(meta.isBrandPrimary, false)
})

test('resolveHeaderMetadata falls back to guide values when pill values are missing', () => {
  const meta = resolveHeaderMetadata({
    drugName: 'Plavix',
    pill: {
      brand_or_generic: 'brand',
    },
    guide: {
      generic_name: 'Clopidogrel',
      brand_name: 'Plavix',
      drug_class: 'Platelet Aggregation Inhibitors',
      dosage_form: 'Tablet, Film Coated',
    },
  })

  assert.equal(meta.genericName, 'Clopidogrel')
  assert.equal(meta.brandName, 'Plavix')
  assert.equal(meta.drugClass, 'Platelet Aggregation Inhibitors')
  assert.equal(meta.dosageForm, 'Tablet, Film Coated')
  assert.equal(meta.isBrandPrimary, true)
})
