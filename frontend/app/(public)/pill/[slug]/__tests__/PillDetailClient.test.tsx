import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sourcePath = new URL('../PillDetailClient.tsx', import.meta.url)

test('detail page source uses responsive 2-column medical + price summary layout', () => {
  const source = readFileSync(sourcePath, 'utf8')

  assert.match(source, /data-testid="medical-price-grid"/)
  assert.match(source, /grid-cols-1 md:grid-cols-5/)
  assert.match(source, /md:col-span-3/)
  assert.match(source, /md:col-span-2/)
  assert.match(source, /<PriceSummaryCard/)
})

test('detail page source passes resolved slug into PriceSummaryCard for /pill\\/\\[slug\\]\\/price links', () => {
  const source = readFileSync(sourcePath, 'utf8')
  assert.match(source, /slug=\{resolvedSlug\}/)
})
