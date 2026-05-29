import test from 'node:test'
import assert from 'node:assert/strict'

import type { PillDetail } from '../../types'
import { imageObjectSchema } from '../structured-data'

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
