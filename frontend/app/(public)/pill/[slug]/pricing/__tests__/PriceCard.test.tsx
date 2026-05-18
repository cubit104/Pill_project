import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import PriceCard from '../PriceCard'

const BASE_PRICE = {
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
}

test('PriceCard renders all four section emoji headers and gradient header', () => {
  const html = renderToStaticMarkup(
    <PriceCard
      ndc="00002140102"
      initialData={{
        price: BASE_PRICE,
        alternatives: [],
        history: [],
      }}
    />
  )

  assert.match(html, /💰/)
  assert.match(html, /🔄/)
  assert.match(html, /📈/)
  assert.match(html, /⚠️/)
  // Gradient strip on the first section header
  assert.match(html, /from-emerald-50/)
  // Section headers text
  assert.match(html, /Pharmacy Cost Benchmark/i)
  assert.match(html, /Compare Alternatives/i)
  assert.match(html, /Price History/i)
  assert.match(html, /Important/i)
  // Sections separated by border-t dividers (at least 3 dividers for 4 sections)
  const dividerCount = (html.match(/border-t border-slate-100/g) || []).length
  assert.ok(dividerCount >= 3, `Expected at least 3 border-t dividers, got ${dividerCount}`)
})

test('PriceCard renders hero price with text-4xl and unit label', () => {
  const html = renderToStaticMarkup(
    <PriceCard
      ndc="00002140102"
      initialData={{
        price: BASE_PRICE,
        alternatives: [],
        history: [],
      }}
    />
  )

  assert.match(html, /text-4xl/)
  assert.match(html, /\$0\.45/)
  assert.match(html, /\/ tablet/)
})

test('PriceCard renders equivalent fallback note when match_type is equivalent', () => {
  const html = renderToStaticMarkup(
    <PriceCard
      ndc="00002140102"
      initialData={{
        price: {
          ...BASE_PRICE,
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
          ...BASE_PRICE,
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

test('PriceCard renders cheapest badge on first alternatives row', () => {
  const html = renderToStaticMarkup(
    <PriceCard
      ndc="00002140102"
      initialData={{
        price: BASE_PRICE,
        alternatives: [
          {
            ndc: '00093102901',
            name: 'lisinopril 10 MG Oral Tablet',
            kind: 'generic',
            price_per_unit: 0.05,
            unit: 'EA',
            effective_date: '2026-05-15',
            is_cheapest: true,
          },
          {
            ndc: '00071015423',
            name: 'Prinivil 10 MG Oral Tablet',
            kind: 'brand',
            price_per_unit: 2.20,
            unit: 'EA',
            effective_date: '2026-05-15',
            is_cheapest: false,
          },
        ],
        history: [],
      }}
    />
  )

  assert.match(html, /← cheapest/)
})

test('PriceCard renders similar badge for primary ingredient fallback alternatives', () => {
  const html = renderToStaticMarkup(
    <PriceCard
      ndc="00002140102"
      initialData={{
        price: BASE_PRICE,
        alternatives: [
          {
            ndc: '00093102901',
            name: 'amoxicillin 500 MG Oral Capsule',
            kind: 'generic',
            match_scope: 'primary_ingredient_only',
            price_per_unit: 0.09,
            unit: 'EA',
            effective_date: '2026-05-15',
            is_cheapest: true,
          },
        ],
        history: [],
      }}
    />
  )

  assert.match(html, /ⓘ similar/)
})

test('PriceCard renders generic_vs_brand_ratio callout when ratio >= 2', () => {
  const html = renderToStaticMarkup(
    <PriceCard
      ndc="00002140102"
      initialData={{
        price: BASE_PRICE,
        alternatives: [
          {
            ndc: '00093102901',
            name: 'lisinopril 10 MG Oral Tablet',
            kind: 'generic',
            price_per_unit: 0.05,
            unit: 'EA',
            effective_date: '2026-05-15',
            is_cheapest: true,
          },
        ],
        history: [],
        generic_vs_brand_ratio: 44,
      }}
    />
  )

  assert.match(html, /Generic is/)
  assert.match(html, /44×/)
  assert.match(html, /cheaper than the brand/)
})

test('PriceCard renders history placeholder when no history', () => {
  const html = renderToStaticMarkup(
    <PriceCard
      ndc="00002140102"
      initialData={{
        price: BASE_PRICE,
        alternatives: [],
        history: [],
      }}
    />
  )

  assert.match(html, /Historical data starts collecting today/)
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
