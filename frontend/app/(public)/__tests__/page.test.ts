import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const pagePath = new URL('../page.tsx', import.meta.url)
const source = readFileSync(pagePath, 'utf8')

test('home page metadata and hero copy include pricing and guide keywords', () => {
  assert.match(source, /title: 'PillSeek — Free Pill Identifier, Drug Price Check & Patient Guide \(FDA Data\)'/)
  assert.match(source, /Free Pill Identifier, <span className="text-emerald-700">Drug Price Check<\/span> &amp; Patient Guide/)
  assert.match(source, /Know your pill\.\s*<span className="text-emerald-700">Know the price\.<\/span>\s*Know how to take it\./)
})

test('home page hero includes popular medication chips and desktop SVG illustration', () => {
  assert.match(source, /label: 'Lisinopril', href: '\/search\?q=lisinopril'/)
  assert.match(source, /label: 'Metformin', href: '\/search\?q=metformin'/)
  assert.match(source, /label: 'Atorvastatin', href: '\/search\?q=atorvastatin'/)
  assert.match(source, /label: 'Ibuprofen 800', href: '\/search\?q=ibuprofen\+800'/)
  assert.match(source, /label: 'M367', href: '\/search\?q=M367'/)
  assert.match(source, /className="hidden md:block"/)
  assert.match(source, /\$0\.04 \/ pill \(NADAC\)/)
})

test('home page includes FAQ schema and medical reviewed line', () => {
  assert.match(source, /const faqJsonLd = faqSchema/)
  assert.match(source, /<HomeFaq items=\{homeFaqs\} \/>/)
  assert.match(source, /Medical content reviewed by licensed pharmacists/)
  assert.match(source, /Last updated: November 2025/)
})

test('home page pillar cards use non-404 launch links', () => {
  assert.match(source, /href: '\/search\?q=lisinopril'/)
  assert.match(source, /href: '\/pill\/plavix-75-1171\/price'/)
  assert.match(source, /href: '\/search\?q=metformin'/)
})
