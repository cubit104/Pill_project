import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const pagePath = new URL('../page.tsx', import.meta.url)
const source = readFileSync(pagePath, 'utf8')

test('home page hero keeps a centered intro with a 70/30 search row', () => {
  assert.match(source, /title: 'PillSeek — Free Pill Identifier, Drug Price Check & Patient Guide \(FDA Data\)'/)
  assert.match(source, /Free Pill Identifier, <span className="text-emerald-700">Drug Price Check<\/span>\s*\{' '\}\s*&amp; Patient Guide/)
  assert.match(source, /Know your pill\. Know the price\. Know how to take it\./)
  assert.match(source, /grid gap-6 md:grid-cols-10 md:items-center/)
  assert.match(source, /<div className="md:col-span-7">/)
  assert.match(source, /hidden md:flex md:col-span-3 items-center justify-center/)
  assert.doesNotMatch(source, /Popular:\s*Lisinopril/)
})

test('home page links cards and lower sections to the intended components', () => {
  assert.match(source, /href: '\/pill\/plavix-75-1171'/)
  assert.match(source, /href: '\/pill\/plavix-75-1171\/price'/)
  assert.match(source, /href: '\/pill\/plavix-75-1171\/medication-guide'/)
  assert.match(source, /<TrendingPills \/>/)
  assert.match(source, /<HomeFaq \/>/)
  assert.match(source, /Medical content reviewed by licensed pharmacists · Last updated: \{HOME_LAST_UPDATED\}/)
})
