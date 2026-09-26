import test from 'node:test'
import assert from 'node:assert/strict'

import { nameCandidates, pillSeekLinks } from '../pillseek-links'

test('the names looked up: whole, first two words, first word, never a word too broad to name a medicine', () => {
  assert.deepEqual(nameCandidates(['Dexmedetomidine HCl in 0.9% Sodium Chloride']), ['dexmedetomidine hcl in 0 9 sodium chloride', 'dexmedetomidine hcl', 'dexmedetomidine'])
  assert.deepEqual(nameCandidates(['Sodium Bicarbonate', 'Zestril']), ['sodium bicarbonate', 'zestril']) // not "sodium" alone
  assert.deepEqual(nameCandidates(['', 'Tums']), []) // too short to be sure
})

test("an FDA news page links to the medicine's pills and IV guide on PillSeek, and to nothing it does not have", async () => {
  const originalFetch = global.fetch
  const index: Record<string, Array<{ name: string; pill_count: number; iv_slug: string | null }>> = {
    de: [
      { name: 'Dexmedetomidine', pill_count: 0, iv_slug: 'dexmedetomidine' },
      { name: 'Dextrose', pill_count: 0, iv_slug: 'dextrose' },
    ],
    li: [{ name: 'LISINOPRIL', pill_count: 42, iv_slug: null }],
  }
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    const prefix = url.searchParams.get('prefix') ?? ''
    return new Response(JSON.stringify({ prefix, entries: index[prefix] ?? [], letters: {}, pairs: {} }), { status: 200 })
  }) as typeof fetch
  try {
    assert.deepEqual(await pillSeekLinks(['Dexmedetomidine HCl in 0.9% Sodium Chloride Injection 400 mcg/100 mL']), [
      { label: 'Dexmedetomidine: IV and injection guide', href: '/iv/dexmedetomidine' },
    ])
    assert.deepEqual(await pillSeekLinks(['lisinopril', 'Zestril']), [{ label: 'Lisinopril: 42 pills to identify', href: '/drug/lisinopril' }])
    assert.deepEqual(await pillSeekLinks(['Brandnewmab']), [])
  } finally {
    global.fetch = originalFetch
  }
})
