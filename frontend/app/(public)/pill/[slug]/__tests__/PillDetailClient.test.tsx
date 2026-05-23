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
  assert.equal((source.match(/<PriceSummaryCard/g) || []).length, 2)
})

test('detail page source passes resolved slug into both hero and mobile PriceSummaryCard placements', () => {
  const source = readFileSync(sourcePath, 'utf8')
  assert.equal((source.match(/slug=\{resolvedSlug\}/g) || []).length, 2)
  assert.match(source, /<div className="mt-4 hidden sm:block text-left">\s*<PriceSummaryCard/)
  assert.match(source, /<div className="sm:hidden mb-6">\s*<PriceSummaryCard/)
  assert.match(source, /max-w-4xl mx-auto px-4 py-8/)
})

test('detail page source does not render the long inline price card content', () => {
  const source = readFileSync(sourcePath, 'utf8')

  assert.doesNotMatch(source, /<PriceCard/)
  assert.doesNotMatch(source, /Important disclaimers/)
  assert.doesNotMatch(source, /PriceHistorySparkline/)
  assert.doesNotMatch(source, /AlternativesTable/)
})

test('detail page source computes spec striping in JSX and uses emerald borders on data cards', () => {
  const source = readFileSync(sourcePath, 'utf8')

  assert.match(source, /const filteredSpecsRows = specsRows\.filter\(row => Boolean\(row\.value\)\)/)
  assert.match(source, /const specsStripeClass = \(i: number\) => \{/)
  assert.match(source, /const mobileStripe = i % 2 === 0 \? 'bg-teal-50' : ''/)
  assert.match(source, /const desktopStripe = Math\.floor\(i \/ 2\) % 2 === 0 \? 'sm:bg-teal-50' : 'sm:bg-transparent'/)
  assert.match(source, /<dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">/)
  assert.match(source, /filteredSpecsRows\.map\(\(row, index\) => \(\s*<div key=\{row\.label\} className=\{specsStripeClass\(index\)\}>/)
  assert.match(source, /className=\{`col-span-full \$\{specsStripeClass\(filteredSpecsRows\.length\)\}`\}/)
  assert.match(source, /stripe=\{idx % 2 === 0\}/)
  assert.equal((source.match(/text-sm font-semibold text-slate-600 w-36 shrink-0/g) || []).length, 3)
  assert.doesNotMatch(source, /const PILL_SPECS_STRIPE_CLASSES/)

  assert.ok((source.match(/bg-white border border-emerald-200 rounded-xl/g) || []).length >= 8)
  assert.ok((source.match(/border border-emerald-200 rounded-lg/g) || []).length >= 3)
})

test('detail page source keeps thumbnail selection separate from zoom state', () => {
  const source = readFileSync(sourcePath, 'utf8')

  assert.match(source, /const \[selectedImage, setSelectedImage\] = useState<string>\(images\[0\] \?\? ''\)/)
  assert.match(source, /useEffect\(\(\) => \{\s*setSelectedImage\(\(current\) => \(current && images\.includes\(current\) \? current : \(images\[0\] \?\? ''\)\)\)\s*\}, \[pill\.image_url, pill\.images\]\)/)
  assert.match(source, /onClick=\{\(\) => setZoomImage\(selectedImage\)\}/)
  assert.match(source, /src=\{selectedImage\}/)
  assert.match(source, /\{images\.map\(\(img, idx\) => \(/)
  assert.doesNotMatch(source, /images\.slice\(1\)\.map/)
  assert.match(source, /onClick=\{\(\) => setSelectedImage\(img\)\}/)
  assert.match(source, /selectedImage === img \? 'border-emerald-400 ring-2 ring-emerald-300' : 'border-slate-100'/)
})
