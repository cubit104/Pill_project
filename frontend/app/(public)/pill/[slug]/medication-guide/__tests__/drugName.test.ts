import test from 'node:test'
import assert from 'node:assert/strict'

import { stripDoseFromName } from '../drugName'

test('stripDoseFromName removes trailing dose strengths', () => {
  assert.equal(stripDoseFromName('Plavix 75 Mg'), 'Plavix')
  assert.equal(stripDoseFromName('Prednisone 10/20 mg'), 'Prednisone')
  assert.equal(stripDoseFromName('Levothyroxine 500 mcg'), 'Levothyroxine')
  assert.equal(stripDoseFromName('Hydrocortisone 0.5 %'), 'Hydrocortisone')
  assert.equal(stripDoseFromName('Hydrocortisone .5 mg'), 'Hydrocortisone')
  assert.equal(stripDoseFromName('Insulin 100 units'), 'Insulin')
})

test('stripDoseFromName leaves names unchanged when no trailing dose is present', () => {
  assert.equal(stripDoseFromName('Clopidogrel'), 'Clopidogrel')
  assert.equal(stripDoseFromName('Vitamin B12 injection'), 'Vitamin B12 injection')
})
