import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import TestRenderer, { act } from 'react-test-renderer'

process.env.NEXT_PUBLIC_API_BASE_URL = 'http://localhost:8000'

import PriceCard, { fetchPriceCardDownstream, resolveDownstreamNdc } from '../PriceCard'

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

test('resolveDownstreamNdc prefers matched_ndc for equivalent matches', () => {
  assert.equal(
    resolveDownstreamNdc(
      {
        ...BASE_PRICE,
        match_type: 'equivalent',
        matched_ndc: '00378-0181-01',
      },
      '00002-1401-02'
    ),
    '00378018101'
  )
})

test('resolveDownstreamNdc falls back to fallbackNdc digits for exact matches', () => {
  assert.equal(
    resolveDownstreamNdc(BASE_PRICE, '00002-1401-02'),
    '00002140102'
  )
})

test('fetchPriceCardDownstream calls /alternatives, /history, and /strengths with matched_ndc', async () => {
  const calls: string[] = []
  const fetchImpl = async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    if (url.endsWith('/alternatives')) {
      return new Response(JSON.stringify({ alternatives: [], generic_vs_brand_ratio: 4 }), { status: 200 })
    }
    if (url.endsWith('/strengths')) {
      return new Response(JSON.stringify({ ndc: '00378018101', ingredient: null, ingredient_rxcui: null, strengths: [] }), { status: 200 })
    }
    return new Response(JSON.stringify({ history: [] }), { status: 200 })
  }

  const result = await fetchPriceCardDownstream({
    apiBase: 'https://api.example.com',
    downstreamNdc: '00378018101',
    fetchImpl,
  })

  assert.deepEqual(calls, [
    'https://api.example.com/api/prices/00378018101/alternatives',
    'https://api.example.com/api/prices/00378018101/history?weeks=52',
    'https://api.example.com/api/prices/00378018101/strengths',
  ])
  assert.equal(result.genericVsBrandRatio, 4)
})

test('fetchPriceCardDownstream prefers matched_ndc over historyNdc for equivalent matches', async () => {
  const calls: string[] = []
  const fetchImpl = async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    if (url.endsWith('/alternatives')) {
      return new Response(JSON.stringify({ alternatives: [], generic_vs_brand_ratio: null }), { status: 200 })
    }
    if (url.endsWith('/strengths')) {
      return new Response(JSON.stringify({ ndc: '00378018101', ingredient: null, ingredient_rxcui: null, strengths: [] }), { status: 200 })
    }
    return new Response(JSON.stringify({ history: [] }), { status: 200 })
  }

  const result = await fetchPriceCardDownstream({
    apiBase: 'https://api.example.com',
    downstreamNdc: '00378018101',
    historyNdc: '00002140102',
    priceResponse: {
      ...BASE_PRICE,
      match_type: 'equivalent',
      matched_ndc: '00378-0181-01',
    },
    fetchImpl,
  })

  assert.equal(
    calls[1],
    'https://api.example.com/api/prices/00378018101/history?weeks=52'
  )
  assert.deepEqual(result.history, [])
})

test('fetchPriceCardDownstream skips /history when historyNdc is null', async () => {
  const calls: string[] = []
  const fetchImpl = async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    if (url.endsWith('/alternatives')) {
      return new Response(JSON.stringify({ alternatives: [], generic_vs_brand_ratio: null }), { status: 200 })
    }
    if (url.endsWith('/strengths')) {
      return new Response(JSON.stringify({ ndc: '00378018101', ingredient: null, ingredient_rxcui: null, strengths: [] }), { status: 200 })
    }
    throw new Error(`Unexpected URL ${url}`)
  }

  const result = await fetchPriceCardDownstream({
    apiBase: 'https://api.example.com',
    downstreamNdc: '00378018101',
    historyNdc: null,
    fetchImpl,
  })

  assert.deepEqual(calls, [
    'https://api.example.com/api/prices/00378018101/alternatives',
    'https://api.example.com/api/prices/00378018101/strengths',
  ])
  assert.deepEqual(result.history, [])
})

test('fetchPriceCardDownstream uses matched_ndc history URL when equivalent match has null historyNdc', async () => {
  const calls: string[] = []
  const fetchImpl = async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    if (url.endsWith('/alternatives')) {
      return new Response(JSON.stringify({ alternatives: [], generic_vs_brand_ratio: null }), { status: 200 })
    }
    if (url.endsWith('/strengths')) {
      return new Response(JSON.stringify({ ndc: '00378018101', ingredient: null, ingredient_rxcui: null, strengths: [] }), { status: 200 })
    }
    return new Response(JSON.stringify({ history: [] }), { status: 200 })
  }

  const result = await fetchPriceCardDownstream({
    apiBase: 'https://api.example.com',
    downstreamNdc: '00378018101',
    historyNdc: null,
    priceResponse: {
      ...BASE_PRICE,
      match_type: 'equivalent',
      matched_ndc: '00378-0181-01',
    },
    fetchImpl,
  })

  assert.equal(
    calls[1],
    'https://api.example.com/api/prices/00378018101/history?weeks=52'
  )
  assert.deepEqual(result.history, [])
})

test('fetchPriceCardDownstream retries history once when backend is warming', async () => {
  const calls: string[] = []
  const originalSetTimeout = globalThis.setTimeout
  globalThis.setTimeout = ((fn: (...args: any[]) => void) => {
    fn()
    return 0 as any
  }) as typeof setTimeout

  try {
    let historyCallCount = 0
    const fetchImpl = async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith('/alternatives')) {
        return new Response(JSON.stringify({ alternatives: [], generic_vs_brand_ratio: null }), { status: 200 })
      }
      if (url.endsWith('/strengths')) {
        return new Response(JSON.stringify({ ndc: '00378018101', ingredient: null, ingredient_rxcui: null, strengths: [] }), { status: 200 })
      }
      historyCallCount += 1
      if (historyCallCount === 1) {
        return new Response(JSON.stringify({ history: [] }), {
          status: 200,
          headers: { 'X-Price-History': 'warming' },
        })
      }
      return new Response(JSON.stringify({
        history: [{ ndc: '00378018101', effective_date: '2026-05-20', price_per_unit: 0.31, unit: 'EA' }],
      }), { status: 200 })
    }

    const result = await fetchPriceCardDownstream({
      apiBase: 'https://api.example.com',
      downstreamNdc: '00378018101',
      fetchImpl,
    })

    const historyCalls = calls.filter((url) => url.endsWith('/history?weeks=52'))
    assert.equal(historyCalls.length, 2)
    assert.equal(result.history.length, 1)
  } finally {
    globalThis.setTimeout = originalSetTimeout
  }
})

test('fetchPriceCardDownstream does only one warming retry before returning empty history', async () => {
  const calls: string[] = []
  const originalSetTimeout = globalThis.setTimeout
  globalThis.setTimeout = ((fn: (...args: any[]) => void) => {
    fn()
    return 0 as any
  }) as typeof setTimeout

  try {
    const fetchImpl = async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith('/alternatives')) {
        return new Response(JSON.stringify({ alternatives: [], generic_vs_brand_ratio: null }), { status: 200 })
      }
      if (url.endsWith('/strengths')) {
        return new Response(JSON.stringify({ ndc: '00378018101', ingredient: null, ingredient_rxcui: null, strengths: [] }), { status: 200 })
      }
      return new Response(JSON.stringify({ history: [] }), {
        status: 200,
        headers: { 'X-Price-History': 'warming' },
      })
    }

    const result = await fetchPriceCardDownstream({
      apiBase: 'https://api.example.com',
      downstreamNdc: '00378018101',
      fetchImpl,
    })

    const historyCalls = calls.filter((url) => url.endsWith('/history?weeks=52'))
    assert.equal(historyCalls.length, 2)
    assert.deepEqual(result.history, [])
  } finally {
    globalThis.setTimeout = originalSetTimeout
  }
})

test('PriceCard renders price immediately when initialData.price present, then fetches alternatives/history', async () => {
  const originalFetch = global.fetch
  const calls: string[] = []
  global.fetch = async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    if (url.endsWith('/alternatives')) {
      return new Response(JSON.stringify({
        alternatives: [
          {
            ndc: '00378018101',
            name: 'Equivalent Drug',
            kind: 'generic',
            price_per_unit: 0.22,
            unit: 'EA',
            effective_date: '2026-05-15',
            is_cheapest: true,
          },
        ],
      }), { status: 200 })
    }
    if (url.endsWith('/strengths')) {
      return new Response(JSON.stringify({ ndc: '00378018101', ingredient: null, ingredient_rxcui: null, strengths: [] }), { status: 200 })
    }
    return new Response(JSON.stringify({
      history: [
        { ndc: '00378018101', effective_date: '2026-05-01', price_per_unit: 0.2, unit: 'EA' },
      ],
    }), { status: 200 })
  }

  try {
    const renderer = TestRenderer.create(
      <PriceCard
        ndc="00002-1401-02"
        initialData={{ price: { ...BASE_PRICE, match_type: 'equivalent', matched_ndc: '00378018101' } }}
      />
    )

    assert.match(JSON.stringify(renderer.toJSON()), /"0\.45"/)
    assert.equal(calls.length, 0)

    await act(async () => {
      await Promise.resolve()
    })

    assert.deepEqual(calls, [
      '/api/prices/00378018101/alternatives',
      '/api/prices/00378018101/history?weeks=52',
      '/api/prices/00378018101/strengths',
    ])
    assert.match(JSON.stringify(renderer.toJSON()), /Equivalent Drug/)
    renderer.unmount()
  } finally {
    global.fetch = originalFetch
  }
})

test('PriceCard does not refetch downstream when initialData has all three fields', async () => {
  const originalFetch = global.fetch
  const calls: string[] = []
  global.fetch = async (input: RequestInfo | URL) => {
    calls.push(String(input))
    throw new Error('should not fetch')
  }

  try {
    const renderer = TestRenderer.create(
      <PriceCard
        ndc="00002-1401-02"
        initialData={{
          price: BASE_PRICE,
          alternatives: [],
          history: [],
        }}
      />
    )

    await act(async () => {
      await Promise.resolve()
    })

    assert.equal(calls.length, 0)
    renderer.unmount()
  } finally {
    global.fetch = originalFetch
  }
})

test('PriceCard accepts raw snapshot initialData without extra fetches', async () => {
  const originalFetch = global.fetch
  const calls: string[] = []
  global.fetch = async (input: RequestInfo | URL) => {
    calls.push(String(input))
    throw new Error('should not fetch')
  }

  try {
    const html = renderToStaticMarkup(
      <PriceCard
        ndc="00169-4409-13"
        initialData={{
          slug: 'Wegovy-9-mg',
          resolved_ndc11: '00169442531',
          match_type: 'equivalent',
          resolved_via: 'sibling',
          price_per_unit: 33.16,
          unit: 'EA',
          effective_date: '2026-05-14',
          total_acquisition_cost: 994.8,
          fair_retail_low: 1492.21,
          fair_retail_high: 2984.42,
          history_52w: [{ effective_date: '2026-05-01', price_per_unit: 33.16, unit: 'EA' }],
          alternatives: [],
          estimate_basis: 'Sibling family match with the same strength',
          display_disclaimer: 'Pricing resolved from a sibling NDC in the same labeler/product family.',
          schema_offers_valid: true,
        }}
      />
    )

    assert.match(html, /Pricing resolved from a sibling NDC/)
    assert.match(html, /Basis: Sibling family match with the same strength/)
    assert.match(html, /Price History/)
    assert.equal(calls.length, 0)
  } finally {
    global.fetch = originalFetch
  }
})
