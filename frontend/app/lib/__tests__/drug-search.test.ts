import test from 'node:test'
import assert from 'node:assert/strict'

import { displayDrugName, indexEntryOptions, indexPrefix, ivSearchOptions, matchOptions } from '../drug-search'
import { fetchIvList, type IvListItem } from '../iv'

const iv = (name: string, brands: string[] = []): IvListItem => ({ slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, brand_names: brands, drug_class: [], has_card: false })

test('names starting with what was typed come first, then a word, then a brand, then anywhere', () => {
  const options = ivSearchOptions([
    iv('Vancomycin'),
    iv('Piperacillin and Tazobactam', ['Zosyn']),
    iv('Ampicillin and Sulbactam', ['Unasyn']),
    iv('Tazobactam Test Drug'),
    iv('Bivalirudin'),
  ])
  assert.deepEqual(matchOptions(options, 'van').map((o) => o.label), ['Vancomycin'])
  assert.deepEqual(matchOptions(options, 'taz').map((o) => o.label), ['Tazobactam Test Drug', 'Piperacillin and Tazobactam'])
  assert.deepEqual(matchOptions(options, 'zosyn').map((o) => o.label), ['Piperacillin and Tazobactam']) // by brand
  assert.deepEqual(matchOptions(options, 'illin').map((o) => o.label), ['Ampicillin and Sulbactam', 'Piperacillin and Tazobactam']) // inside a name
  assert.deepEqual(matchOptions(options, '  '), [])
  assert.equal(options[0].href, '/iv/vancomycin')
})

test('the drug index is asked by its first letters; entries open the same page the A to Z list opens', () => {
  assert.equal(indexPrefix('Metformin'), 'me')
  assert.equal(indexPrefix('m'), 'm')
  assert.equal(indexPrefix('5-fluorouracil'), '0-9')
  assert.equal(indexPrefix('  '), null)
  const [pill, ivOnly, both] = indexEntryOptions([
    { name: 'METFORMIN HYDROCHLORIDE', pill_count: 3, iv_slug: null },
    { name: 'Meropenem', pill_count: 0, iv_slug: 'meropenem' },
    { name: 'Vancomycin', pill_count: 1, iv_slug: 'vancomycin' },
  ])
  assert.deepEqual(pill, { label: 'Metformin Hydrochloride', href: '/drug/metformin-hydrochloride', badge: '3 pills' })
  assert.deepEqual(ivOnly, { label: 'Meropenem', href: '/iv/meropenem', badge: 'IV' })
  assert.deepEqual(both, { label: 'Vancomycin', href: '/drug/vancomycin', badge: '1 pill · IV' }) // pills first, like the A to Z list
  assert.equal(displayDrugName('vardenafil'), 'Vardenafil')
  assert.equal(displayDrugName('McNeil Tylenol'), 'McNeil Tylenol') // mixed case kept
})

test('the IV list is read page by page, so it no longer stops at the 600th drug', async () => {
  const originalFetch = global.fetch
  const asked: string[] = []
  const all = Array.from({ length: 695 }, (_, i) => iv(`Drug ${String(i).padStart(3, '0')}`))
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://api.test')
    asked.push(url.search)
    const page = Number(url.searchParams.get('page'))
    const per = Number(url.searchParams.get('per_page'))
    return new Response(JSON.stringify({ results: all.slice((page - 1) * per, page * per), total: all.length, page, per_page: per }), { status: 200 })
  }) as typeof fetch
  try {
    const list = await fetchIvList()
    assert.equal(list.length, 695)
    assert.equal(list[694].name, 'Drug 694')
    assert.deepEqual(asked, ['?per_page=600&page=1', '?per_page=600&page=2'])
  } finally {
    global.fetch = originalFetch
  }
})
