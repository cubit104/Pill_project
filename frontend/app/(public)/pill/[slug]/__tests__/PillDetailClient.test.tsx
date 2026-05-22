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

test('detail page source renders guide, summary, and fallback medication sections without embedded price cards', () => {
  const source = readFileSync(sourcePath, 'utf8')

  assert.match(source, /data-testid=\{testId\}/)
  assert.match(source, /testId="medication-info-grid-guide"/)
  assert.match(source, /testId="medication-info-grid-summary"/)
  assert.match(source, /testId="medication-info-grid-fallback"/)
  assert.match(source, /function MedicationInfoCard/)
  assert.doesNotMatch(source, /function MedicationInfoWithPrice/)

  assert.match(
    source,
    /\{resolvedSlug && pill\.has_medguide === true && \(\s*<MedicationInfoCard[\s\S]*?ctaLabel="Read Medication Guide"/
  )
  assert.match(
    source,
    /\{resolvedSlug && pill\.has_medguide !== true && pill\.has_medication_summary === true && \(\s*<MedicationInfoCard[\s\S]*?ctaLabel="Read Medication Summary"/
  )
  assert.match(
    source,
    /\{resolvedSlug && pill\.has_medguide !== true && pill\.has_medication_summary !== true && \(\s*<MedicationInfoCard[\s\S]*?ctaLabel="Read Medication Information"/
  )

  assert.match(source, /Read Medication Guide/)
  assert.match(source, /Read Medication Summary/)
  assert.match(source, /Read Medication Information/)
  assert.equal((source.match(/<PriceSummaryCard/g) || []).length, 1)
})

test('detail page source passes resolved slug into hero PriceSummaryCard for /pill\\/\\[slug\\]\\/price links', () => {
  const source = readFileSync(sourcePath, 'utf8')
  assert.equal((source.match(/slug=\{resolvedSlug\}/g) || []).length, 1)
  assert.match(source, /<div className="mt-4 text-left">\s*<PriceSummaryCard/)
  assert.match(source, /max-w-4xl mx-auto px-4 py-8/)
})

test('detail page source does not render the long inline price card content', () => {
  const source = readFileSync(sourcePath, 'utf8')

  assert.doesNotMatch(source, /<PriceCard/)
  assert.doesNotMatch(source, /Important disclaimers/)
  assert.doesNotMatch(source, /PriceHistorySparkline/)
  assert.doesNotMatch(source, /AlternativesTable/)
})
