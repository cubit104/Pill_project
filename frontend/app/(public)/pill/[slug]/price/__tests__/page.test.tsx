import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const pagePath = new URL('../page.tsx', import.meta.url)

test('price page source references full PriceCard component', () => {
  const source = readFileSync(pagePath, 'utf8')
  assert.match(source, /<PriceCard/)
})

test('price page snapshot-like render includes back link and wrapper', async () => {
  const originalFetch = global.fetch
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        drug_name: 'Plavix',
        strength: '75 mg',
        slug: 'plavix-75-1171',
        ndc: '00002140102',
        rxcui: '12345',
        brand_or_generic: 'brand',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  try {
    const mod = await import('../page')
    const element = await mod.default({ params: Promise.resolve({ slug: 'plavix-75-1171' }) })
    const html = renderToStaticMarkup(element)

    assert.match(html, /data-testid="pill-price-page"/)
    assert.match(html, /← Back to Plavix/)
    assert.match(html, /<h1[^>]*>💊 Plavix 75 mg<\/h1>/)
    assert.match(html, /href="\/pill\/plavix-75-1171"/)
  } finally {
    global.fetch = originalFetch
  }
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
