import test from 'node:test'
import assert from 'node:assert/strict'

import type { PillDetail } from '../../types'
import { imageObjectSchema, drugSchema } from '../structured-data'

const basePill: PillDetail = {
  drug_name: 'Aspirin',
  imprint: 'A 123',
  color: 'White',
  shape: 'Round',
  strength: '81 mg',
}

test('imageObjectSchema returns ImageObject with required fields', () => {
  const schema = imageObjectSchema(
    {
      ...basePill,
      image_alt_text: 'White round Aspirin 81 mg pill imprinted A 123',
    },
    ['https://example.com/pill-1.jpg']
  )

  assert.ok(schema && !Array.isArray(schema))
  assert.equal(schema['@type'], 'ImageObject')
  assert.equal(schema.contentUrl, 'https://example.com/pill-1.jpg')
  assert.equal(schema.url, 'https://example.com/pill-1.jpg')
  assert.equal(schema.representativeOfPage, true)
})

test('imageObjectSchema marks only first image as representative', () => {
  const schema = imageObjectSchema(basePill, [
    'https://example.com/pill-1.jpg',
    'https://example.com/pill-2.jpg',
  ])

  assert.ok(Array.isArray(schema))
  assert.equal(schema.length, 2)
  assert.equal(schema[0].representativeOfPage, true)
  assert.equal(schema[1].representativeOfPage, undefined)
  assert.equal(schema[0].contentUrl, 'https://example.com/pill-1.jpg')
  assert.equal(schema[1].contentUrl, 'https://example.com/pill-2.jpg')
})

test('imageObjectSchema returns null when no images are provided', () => {
  const schema = imageObjectSchema(basePill, [])
  assert.equal(schema, null)
})

test('imageObjectSchema builds fallback caption when alt text is missing', () => {
  const schema = imageObjectSchema(basePill, ['https://example.com/pill-1.jpg'])
  assert.ok(schema && !Array.isArray(schema))
  assert.equal(schema.caption, 'White Round Aspirin 81 mg pill imprinted A 123')
  assert.equal(schema.name, 'White Round Aspirin 81 mg pill imprinted A 123')
})

// drugSchema tests

const drugPill: PillDetail = {
  drug_name: 'Metformin',
  imprint: 'M 500',
  color: 'White',
  shape: 'Oval',
  strength: '500 mg',
  rxcui: '861007',
  ndc: '0093-7267-01',
  generic_name: 'metformin hydrochloride',
  brand_names_all: ['Glucophage'],
  dosage_form: 'Tablet',
  ingredients: 'metformin hydrochloride',
  status_rx_otc: 'RX',
  manufacturer: 'Teva Pharmaceuticals',
  pharma_class: 'Biguanides',
  image_url: 'https://example.com/metformin.jpg',
}

test('drugSchema returns Drug schema with correct type and name', () => {
  const schema = drugSchema(drugPill, 'metformin-500mg')
  assert.equal(schema['@type'], 'Drug')
  assert.equal(schema.name, 'Metformin')
})

test('drugSchema maps RxCUI and NDC as identifier PropertyValue array', () => {
  const schema = drugSchema(drugPill, 'metformin-500mg')
  const identifier = schema.identifier as Array<{ '@type': string; name: string; value: string }>
  assert.ok(Array.isArray(identifier))
  assert.equal(identifier.length, 2)
  assert.deepEqual(identifier[0], { '@type': 'PropertyValue', name: 'RxCUI', value: '861007' })
  assert.deepEqual(identifier[1], { '@type': 'PropertyValue', name: 'NDC', value: '0093-7267-01' })
})

test('drugSchema omits identifier when rxcui and ndc are absent', () => {
  const schema = drugSchema({ ...drugPill, rxcui: undefined, ndc: undefined }, 'metformin-500mg')
  assert.equal(schema.identifier, undefined)
})

test('drugSchema maps RX prescriptionStatus correctly', () => {
  const schema = drugSchema({ ...drugPill, status_rx_otc: 'RX' }, 'metformin-500mg')
  assert.equal(schema.prescriptionStatus, 'PrescriptionOnly')
})

test('drugSchema maps OTC prescriptionStatus correctly', () => {
  const schema = drugSchema({ ...drugPill, status_rx_otc: 'OTC' }, 'metformin-500mg')
  assert.equal(schema.prescriptionStatus, 'OTC')
})

test('drugSchema omits prescriptionStatus for unknown status', () => {
  const schema = drugSchema({ ...drugPill, status_rx_otc: 'UNKNOWN' }, 'metformin-500mg')
  assert.equal(schema.prescriptionStatus, undefined)
})

test('drugSchema strips whitespace-only nonProprietaryName', () => {
  const schema = drugSchema({ ...drugPill, generic_name: '   ' }, 'metformin-500mg')
  assert.equal(schema.nonProprietaryName, undefined)
})

test('drugSchema strips null nonProprietaryName', () => {
  const schema = drugSchema({ ...drugPill, generic_name: null }, 'metformin-500mg')
  assert.equal(schema.nonProprietaryName, undefined)
})

test('drugSchema strips whitespace-only image url', () => {
  const schema = drugSchema({ ...drugPill, image_url: '   ' }, 'metformin-500mg')
  assert.equal(schema.image, undefined)
})

test('drugSchema strips whitespace-only manufacturer', () => {
  const schema = drugSchema({ ...drugPill, manufacturer: '   ' }, 'metformin-500mg')
  assert.equal(schema.manufacturer, undefined)
})

test('drugSchema omits undefined optional fields', () => {
  const minimalPill: PillDetail = { drug_name: 'Aspirin', imprint: 'A 81', color: 'White', shape: 'Round', strength: '81 mg' }
  const schema = drugSchema(minimalPill, 'aspirin-81mg')
  assert.equal(schema['@type'], 'Drug')
  assert.equal(schema.nonProprietaryName, undefined)
  assert.equal(schema.identifier, undefined)
  assert.equal(schema.image, undefined)
  assert.equal(schema.manufacturer, undefined)
  assert.equal(schema.prescriptionStatus, undefined)
  assert.equal(schema.drugClass, undefined)
})
