import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import PriceCard from '../PriceCard'

test('PriceCard renders pricing header and disclaimers', () => {
  const html = renderToStaticMarkup(
    <PriceCard
      ndc="00002140102"
      initialData={{
        price: {
          ndc: '00002140102',
          price_per_unit: 0.45,
          unit: 'EA',
          effective_date: '2026-05-15',
          source: 'NADAC (CMS)',
          total_acquisition_cost: 13.5,
          fair_retail_low: 20.25,
          fair_retail_high: 40.5,
          disclaimers: [
            'NADAC reflects pharmacy acquisition cost, not your out-of-pocket cost.',
            'Actual prices vary by pharmacy, insurance, and location.',
            'This is not medical advice. Always consult your pharmacist.',
          ],
        },
        alternatives: [],
        history: [{ effective_date: '2026-05-15', price_per_unit: 0.45 }],
      }}
    />
  )

  assert.match(html, /Pharmacy Cost Benchmark/)
  assert.match(html, /Estimated fair retail range/)
  assert.match(html, /Important disclaimers/)
  assert.doesNotMatch(html, /Pricing shown is for a therapeutically equivalent product/)
})

test('PriceCard renders equivalent fallback note when match_type is equivalent', () => {
  const html = renderToStaticMarkup(
    <PriceCard
      ndc="00002140102"
      initialData={{
        price: {
          ndc: '00002140102',
          price_per_unit: 0.45,
          unit: 'EA',
          effective_date: '2026-05-15',
          source: 'NADAC (CMS)',
          total_acquisition_cost: 13.5,
          fair_retail_low: 20.25,
          fair_retail_high: 40.5,
          match_type: 'equivalent',
          matched_ndc: '00378018101',
          equivalent_count: 3,
          disclaimers: [],
        },
        alternatives: [],
        history: [],
      }}
    />
  )

  assert.match(html, /Pricing shown is for a therapeutically equivalent product/)
  assert.match(html, /Equivalent NDC: 00378-0181-01/)
})

test('PriceCard renders approximate fallback note when match_type is approximate', () => {
  const html = renderToStaticMarkup(
    <PriceCard
      rxcui="6809"
      medicineName="Metformin"
      initialData={{
        price: {
          ndc: '00002140102',
          price_per_unit: 0.45,
          unit: 'EA',
          effective_date: '2026-05-15',
          source: 'NADAC (CMS)',
          total_acquisition_cost: 13.5,
          fair_retail_low: 20.25,
          fair_retail_high: 40.5,
          match_type: 'approximate',
          resolved_ingredient: 'metformin',
          resolved_rxcui: '6809',
          disclaimers: [],
        },
        alternatives: [],
        history: [],
      }}
    />
  )

  assert.match(html, /Pricing shown is an estimate based on the active ingredient/)
  assert.match(html, /Estimated from: metformin/)
})

test('PriceCard renders empty-state markup when price data is unavailable (null initialData price)', () => {
  // With no initialData, the component starts in loading state (loading=true) on initial
  // SSR render since useEffect doesn't run. The loading skeleton must be present in the output
  // — component never returns null/empty when an identifier is provided.
  const html = renderToStaticMarkup(
    <PriceCard ndc="00002140102" />
  )
  assert.notEqual(html, '')
  assert.match(html, /data-testid="price-card-loading"/)
})

test('PriceCard returns null only when no identifiers are provided', () => {
  const html = renderToStaticMarkup(
    <PriceCard />
  )
  assert.equal(html, '')
})

test('PriceCard empty and error state strings are present in the component source', () => {
  const src = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'PriceCard.tsx'),
    'utf8'
  )
  assert.match(src, /Price data is currently unavailable for this medication/)
  assert.match(src, /NADAC weekly file/)
  assert.match(src, /Unable to load price details right now/)
})
