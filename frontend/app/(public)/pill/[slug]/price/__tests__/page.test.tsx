import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

process.env.NEXT_PUBLIC_API_BASE_URL = 'https://api.example.com'

const pagePath = new URL('../page.tsx', import.meta.url)

test('price page source references full PriceCard component', () => {
  const source = readFileSync(pagePath, 'utf8')
  assert.match(source, /<PriceCard/)
})

test('price page snapshot-like render includes back link and wrapper', async () => {
  const originalFetch = global.fetch
  global.fetch = async (input: URL | RequestInfo) => {
    const url = String(input)
    if (url.includes('/api/pill/plavix-75-1171')) {
      return new Response(
        JSON.stringify({
          drug_name: 'Plavix',
          strength: '75 mg',
          slug: 'plavix-75-1171',
          ndc: '00002140102',
          rxcui: '12345',
          brand_or_generic: 'brand',
          image_url: 'https://example.com/plavix.png',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }
    if (url.includes('/api/prices/00002140102')) {
      return new Response(
        JSON.stringify({
          ndc: '00002140102',
          price_per_unit: 0.03,
          unit: 'EA',
          effective_date: '2026-05-19',
          source: 'NADAC (CMS)',
          total_acquisition_cost: 0.9,
          fair_retail_low: 1.35,
          fair_retail_high: 2.7,
          disclaimers: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }
    return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } })
  }

  try {
    const mod = await import('../page')
    const element = await mod.default({ params: Promise.resolve({ slug: 'plavix-75-1171' }) })
    const html = renderToStaticMarkup(element)

    assert.match(html, /data-testid="pill-price-page"/)
    assert.match(html, /← Back to Plavix/)
    assert.match(html, /text-xl md:text-2xl font-bold/)
    assert.match(html, /<h1[^>]*>Plavix 75 mg<\/h1>/)
    assert.match(html, /src="https:\/\/example\.com\/plavix\.png"/)
    assert.match(html, /alt="Plavix pill"/)
    assert.match(html, /href="\/pill\/plavix-75-1171"/)
    assert.match(html, /\$0\.03/)
    assert.match(html, /\/ tablet/)
    assert.doesNotMatch(html, /data-testid="price-card-loading"/)
  } finally {
    global.fetch = originalFetch
  }
})

test('price page renders emoji fallback when image_url is empty', async () => {
  const originalFetch = global.fetch
  global.fetch = async (input: URL | RequestInfo) => {
    const url = String(input)
    if (url.includes('/api/pill/augmentin')) {
      return new Response(
        JSON.stringify({
          drug_name: 'Augmentin',
          strength: 'Amox 562.5 mg;clav 62.5 mg;',
          slug: 'augmentin',
          ndc: '00002140102',
          rxcui: '12345',
          brand_or_generic: 'brand',
          image_url: '',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }
    return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } })
  }

  try {
    const mod = await import('../page')
    const element = await mod.default({ params: Promise.resolve({ slug: 'augmentin' }) })
    const html = renderToStaticMarkup(element)

    assert.match(html, /text-5xl/)
    assert.match(html, /💊/)
    assert.match(html, /Augmentin Amox 562\.5 mg \+ others/)
  } finally {
    global.fetch = originalFetch
  }
})

test('formatStrength compacts strength values', async () => {
  const mod = await import('../formatStrength')
  assert.equal(mod.formatStrength(null), '')
  assert.equal(mod.formatStrength('75 mg'), '75 mg')
  assert.equal(mod.formatStrength('Amox 562.5 mg;clav 62.5 mg;'), 'Amox 562.5 mg + others')
  assert.equal(mod.formatStrength('  75 mg ; ; '), '75 mg')
})

test('price page metadata includes the drug name in the title', async () => {
  const originalFetch = global.fetch
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        drug_name: 'Plavix',
        strength: '75 mg',
        slug: 'plavix-75-1171',
        ndc: '00002140102',
        rxcui: '12345',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  try {
    const mod = await import('../page')
    const metadata = await mod.generateMetadata({ params: Promise.resolve({ slug: 'plavix-75-1171' }) })

    assert.equal(metadata.title, 'Plavix 75 mg – Price details | PillSeek')
  } finally {
    global.fetch = originalFetch
  }
})
