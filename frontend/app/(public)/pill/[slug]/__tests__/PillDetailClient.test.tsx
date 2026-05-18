import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sourcePath = new URL('../PillDetailClient.tsx', import.meta.url)

test('detail page source keeps What it’s used for as a full-width section outside the medication grid', () => {
  const source = readFileSync(sourcePath, 'utf8')

  assert.match(
    source,
    /\{pill\.indication && \(\s*<DrugIndicationSection[\s\S]*?conditionTags=\{conditionTags\}[\s\S]*?\)\}/
  )
  assert.doesNotMatch(source, /data-testid="medical-price-grid"/)
})

test('detail page source renders Medication Information as a responsive grid with button and PriceSummaryCard', () => {
  const source = readFileSync(sourcePath, 'utf8')

  assert.match(source, /data-testid="medication-info-grid"/)
  assert.match(source, /grid grid-cols-1 gap-6 md:grid-cols-5/)
  assert.match(source, /md:col-span-3/)
  assert.match(source, /md:col-span-2/)
  assert.match(source, /Read Medication Information/)
  assert.match(source, /<PriceSummaryCard/)
})

test('detail page source passes resolved slug into PriceSummaryCard for /pill\\/\\[slug\\]\\/price links', () => {
  const source = readFileSync(sourcePath, 'utf8')
  assert.match(source, /slug=\{resolvedSlug\}/)
})

test('detail page source does not render the long inline price card content', () => {
  const source = readFileSync(sourcePath, 'utf8')

  assert.doesNotMatch(source, /<PriceCard/)
  assert.doesNotMatch(source, /Important disclaimers/)
  assert.doesNotMatch(source, /PriceHistorySparkline/)
  assert.doesNotMatch(source, /AlternativesTable/)
})
