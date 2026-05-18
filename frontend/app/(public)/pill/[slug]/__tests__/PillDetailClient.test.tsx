import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sourcePath = new URL('../PillDetailClient.tsx', import.meta.url)

function readSource() {
  return readFileSync(sourcePath, 'utf8')
}

test('detail page keeps the What it’s used for card separate from the 2-column medication information grid', () => {
  const source = readSource()
  const indicationIndex = source.indexOf('<DrugIndicationSection')
  const gridIndex = source.indexOf('data-testid="medication-information-grid"')

  assert.match(source, /<DrugIndicationSection/)
  assert.doesNotMatch(source, /data-testid="medical-price-grid"/)
  assert.notEqual(indicationIndex, -1)
  assert.notEqual(gridIndex, -1)
  assert.ok(indicationIndex < gridIndex)
})

test('detail page source renders Medication Information as a responsive 2-column grid with PriceSummaryCard', () => {
  const source = readSource()

  assert.match(source, /data-testid="medication-information-grid"/)
  assert.match(source, /grid grid-cols-1 gap-6 md:grid-cols-5/)
  assert.match(source, /md:col-span-3/)
  assert.match(source, /md:col-span-2/)
  assert.match(source, /Read Medication Information/)
  assert.match(source, /<PriceSummaryCard/)
})

test('detail page source includes links to the dedicated price page', () => {
  const source = readSource()

  assert.match(source, /slug=\{resolvedSlug\}/)
})

test('detail page source no longer renders the full inline PriceCard pricing sections', () => {
  const source = readSource()

  assert.doesNotMatch(source, /import PriceCard/)
  assert.doesNotMatch(source, /<PriceCard/)
  assert.doesNotMatch(source, /Important disclaimers/)
  assert.doesNotMatch(source, /Price history/)
  assert.doesNotMatch(source, /Compare alternatives/)
})
