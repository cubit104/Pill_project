import test from 'node:test'
import assert from 'node:assert/strict'
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
})
