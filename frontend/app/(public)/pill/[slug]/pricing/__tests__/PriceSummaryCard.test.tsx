import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import PriceSummaryCard from '../PriceSummaryCard'

test('PriceSummaryCard snapshot-like render includes compact pricing and details link', () => {
  const html = renderToStaticMarkup(
    <PriceSummaryCard
      slug="plavix-75-1171"
      ndc="00002140102"
      initialData={{
        ndc: '00002140102',
        price_per_unit: 8.06,
        unit: 'EA',
        effective_date: '2026-05-15',
        source: 'NADAC (CMS)',
        total_acquisition_cost: 241.65,
        fair_retail_low: 320.2,
        fair_retail_high: 410.8,
        disclaimers: [],
      }}
    />
  )

  assert.match(html, /💰 Price/)
  assert.match(html, /\$8\.06/)
  assert.match(html, /30-day est:.*\$241\.65/)
  assert.match(html, /href="\/pill\/plavix-75-1171\/price"/)
  assert.match(html, /See full price details/)
})

test('PriceSummaryCard shows tiny equivalent note for fallback pricing', () => {
  const html = renderToStaticMarkup(
    <PriceSummaryCard
      slug="plavix-75-1171"
      ndc="00002140102"
      initialData={{
        ndc: '00002140102',
        price_per_unit: 8.06,
        unit: 'EA',
        effective_date: '2026-05-15',
        source: 'NADAC (CMS)',
        total_acquisition_cost: 241.65,
        fair_retail_low: 320.2,
        fair_retail_high: 410.8,
        match_type: 'equivalent',
        disclaimers: [],
      }}
    />
  )

  assert.match(html, /ⓘ Equivalent product pricing shown/)
})

test('PriceSummaryCard renders fallback content and details link when price data is unavailable', () => {
  const html = renderToStaticMarkup(
    <PriceSummaryCard slug="plavix-75-1171" />
  )

  assert.match(html, /💰 Price/)
  assert.match(html, /Price data unavailable for this NDC/)
  assert.match(html, /href="[^"]*\/pill\/plavix-75-1171\/price"/)
  assert.match(html, /See pricing details/)
})
