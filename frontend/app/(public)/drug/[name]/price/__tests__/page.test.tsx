import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

test('drug price page metadata is noindex when no NADAC data resolves', async () => {
  const originalFetch = global.fetch
  global.fetch = async (input) => {
    const url = String(input)
    if (url.includes('/api/search?')) {
      return new Response(JSON.stringify({
        results: [
          {
            drug_name: 'Plavix',
            imprint: '75',
            ndc: '00002140102',
            rxcui: '12345',
            slug: 'plavix-75-1171',
            strength: '75 mg',
          },
        ],
        total: 1,
        page: 1,
        per_page: 48,
        total_pages: 1,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('not found', { status: 404 })
  }

  try {
    const mod = await import('../page')
    const metadata = await mod.generateMetadata({ params: Promise.resolve({ name: 'plavix' }) })
    assert.deepEqual(metadata.robots, { index: false, follow: true })
    assert.deepEqual(metadata.alternates, { canonical: '/drug/plavix/price' })
  } finally {
    global.fetch = originalFetch
  }
})

test('drug price page renders representative pricing hub when price data resolves', async () => {
  const originalFetch = global.fetch
  global.fetch = async (input) => {
    const url = String(input)
    if (url.includes('/api/search?')) {
      return new Response(JSON.stringify({
        results: [
          {
            drug_name: 'Plavix',
            imprint: '75',
            ndc: '00002140102',
            rxcui: '12345',
            slug: 'plavix-75-1171',
            strength: '75 mg',
            color: 'Pink',
            shape: 'Round',
          },
        ],
        total: 1,
        page: 1,
        per_page: 48,
        total_pages: 1,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.endsWith('/api/prices/00002140102')) {
      return new Response(JSON.stringify({
        ndc: '00002140102',
        price_per_unit: 0.45,
        unit: 'EA',
        effective_date: '2026-05-15',
        source: 'NADAC (CMS)',
        total_acquisition_cost: 13.5,
        fair_retail_low: 20.25,
        fair_retail_high: 40.5,
        disclaimers: ['a', 'b', 'c'],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.endsWith('/api/prices/00002140102/alternatives')) {
      return new Response(JSON.stringify({ alternatives: [] }), { status: 200 })
    }
    if (url.endsWith('/api/prices/00002140102/history?weeks=52')) {
      return new Response(JSON.stringify({ history: [] }), { status: 200 })
    }
    if (url.endsWith('/api/prices/00002140102/strengths')) {
      return new Response(JSON.stringify({
        ndc: '00002140102',
        ingredient: 'clopidogrel',
        ingredient_rxcui: '123',
        strengths: [],
      }), { status: 200 })
    }
    throw new Error(`Unexpected URL ${url}`)
  }

  try {
    const mod = await import('../page')
    const element = await mod.default({ params: Promise.resolve({ name: 'plavix' }) })
    const html = renderToStaticMarkup(element)
    assert.match(html, /Plavix Price/)
    assert.match(html, /Showing benchmark pricing for a representative Plavix variant \(75 mg\)\./)
    assert.match(html, /Browse all Plavix pills/)
    assert.match(html, /Plavix variants/)
    assert.match(html, /href="\/pill\/plavix-75-1171"/)
  } finally {
    global.fetch = originalFetch
  }
})
