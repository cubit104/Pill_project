import test from 'node:test'
import assert from 'node:assert/strict'

import { shortenTocLabel } from '../shortenTocLabel.mjs'

test('maps common medication guide questions to short labels', () => {
  assert.equal(
    shortenTocLabel(
      'What is the most important information I should know about Plavix?',
      'Plavix'
    ),
    'Important info'
  )
  assert.equal(
    shortenTocLabel(
      'What should I tell my doctor before taking PRADAXA Capsules?',
      'PRADAXA'
    ),
    'Before taking'
  )
  assert.equal(
    shortenTocLabel(
      'What are the possible side effects of XARELTO?',
      'XARELTO'
    ),
    'Side effects'
  )
})

test('falls back to the first three words when no pattern matches', () => {
  assert.equal(
    shortenTocLabel('Call your doctor immediately if you feel dizzy.', 'Plavix'),
    'Call your doctor'
  )
})
