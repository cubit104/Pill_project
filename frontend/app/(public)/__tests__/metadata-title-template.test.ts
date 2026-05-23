import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const classPageSource = readFileSync(new URL('../class/[slug]/page.tsx', import.meta.url), 'utf8')
const pricePageSource = readFileSync(new URL('../pill/[slug]/price/page.tsx', import.meta.url), 'utf8')
const medicationSummarySource = readFileSync(new URL('../pill/[slug]/medication-summary/page.tsx', import.meta.url), 'utf8')

test('metadata titles in public pages do not hardcode the root title template suffix', () => {
  assert.doesNotMatch(classPageSource, /\| PillSeek/)
  assert.doesNotMatch(pricePageSource, /\| PillSeek/)
  assert.doesNotMatch(medicationSummarySource, /\| PillSeek/)
})
