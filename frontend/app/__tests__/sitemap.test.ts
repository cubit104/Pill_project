import test from 'node:test'
import assert from 'node:assert/strict'

test('sitemap excludes noindexed pill subpages and includes drug hubs and price hubs', async () => {
  const originalFetch = global.fetch
  global.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/api/slugs')) {
      return new Response(JSON.stringify(['alpha-10', 'beta-20']), { status: 200 })
    }
    if (url.endsWith('/api/classes')) {
      return new Response(JSON.stringify([{ slug: 'ace-inhibitors' }]), { status: 200 })
    }
    if (url.endsWith('/api/slugs/drugs')) {
      return new Response(JSON.stringify([{ drug_name: 'Alpha' }]), { status: 200 })
    }
    if (url.endsWith('/api/slugs/drug-prices')) {
      return new Response(JSON.stringify([{ drug_name: 'Alpha' }]), { status: 200 })
    }
    if (url.endsWith('/api/conditions')) {
      return new Response(JSON.stringify({ conditions: [{ slug: 'hypertension' }] }), { status: 200 })
    }
    if (url.endsWith('/filters')) {
      return new Response(JSON.stringify({
        colors: [{ name: 'White' }],
        shapes: [{ name: 'Round' }],
      }), { status: 200 })
    }
    throw new Error(`Unexpected URL ${url}`)
  }

  try {
    const mod = await import('../sitemap')
    const entries = await mod.default()
    const urls = entries.map((entry) => entry.url)
    assert.ok(urls.includes('https://pillseek.com/pill/alpha-10'))
    assert.ok(urls.includes('https://pillseek.com/drug/alpha'))
    assert.ok(urls.includes('https://pillseek.com/drug/alpha/price'))
    assert.ok(urls.includes('https://pillseek.com/condition/hypertension'))
    assert.ok(urls.includes('https://pillseek.com/color/white'))
    assert.ok(urls.includes('https://pillseek.com/shape/round'))
    assert.ok(!urls.some((url) => url.includes('/pill/alpha-10/price')))
    assert.ok(!urls.some((url) => url.includes('/pill/alpha-10/dosage')))
    assert.ok(!urls.some((url) => url.includes('/pill/alpha-10/adverse-reactions')))
  } finally {
    global.fetch = originalFetch
  }
})
