import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const pagePath = new URL('../page.tsx', import.meta.url)
const source = readFileSync(pagePath, 'utf8')
const faqPath = new URL('../../components/HomeFaq.tsx', import.meta.url)
const faqSource = readFileSync(faqPath, 'utf8')
const faqItemsPath = new URL('../../components/homeFaqItems.ts', import.meta.url)
const faqItemsSource = readFileSync(faqItemsPath, 'utf8')

test('home page hero keeps a centered intro with a 70/30 search row', () => {
  assert.match(source, /title: 'PillSeek — Free Pill Identifier, Drug Price Check & Patient Guide \(FDA Data\)'/)
  assert.match(source, /Free Pill Identifier, <span className="text-emerald-700">Drug Price Check<\/span>\s*\{' '\}\s*&amp; Patient Guide/)
  assert.match(source, /Know your pill\. Know the price\. Know how to take it\./)
  assert.match(source, /grid gap-6 md:grid-cols-10 md:items-center/)
  assert.match(source, /<div className="md:col-span-7">/)
  assert.match(source, /hidden md:flex md:col-span-3 items-center justify-center rounded-2xl border border-slate-200 bg-white p-4 shadow-sm/)
  assert.match(source, /aria-label="Example pill: M321 yellow oval, NADAC price \$0\.04"/)
  assert.match(source, />\s*M321\s*<\/text>/)
  assert.doesNotMatch(source, /Popular:\s*Lisinopril/)
})

test('home page links cards and lower sections to the intended components', () => {
  assert.match(source, /href: '\/pill\/plavix-75-1171'/)
  assert.match(source, /iconType: 'image'/)
  assert.match(source, /iconSrc: '\/logo-mark\.svg'/)
  assert.match(source, /href: '\/pill\/plavix-75-1171\/price'/)
  assert.match(source, /iconType: 'emoji'/)
  assert.match(source, /href: '\/pill\/plavix-75-1171\/medication-guide'/)
  assert.match(source, /card\.iconType === 'image' \? \(/)
  assert.match(source, /<TrendingPills \/>/)
  assert.match(source, /<HomeFaq \/>/)
  assert.match(source, /<PopularMedications \/>\s*<TrendingPills \/>\s*<HomeFaq \/>/)
  assert.match(source, /Medical content reviewed by licensed pharmacists · Last updated: \{HOME_LAST_UPDATED\}/)
})

test('home FAQ uses accordion +\\/− toggles with required questions', () => {
  assert.match(faqSource, /^'use client'/m)
  assert.match(faqSource, /useState<number \| null>/)
  assert.match(faqSource, /aria-expanded=\{openIndex === index\}/)
  assert.match(faqSource, /\{openIndex === index \? '−' : '\+'\}/)
  assert.match(faqItemsSource, /question: 'Is PillSeek free to use\?'/)
  assert.match(faqItemsSource, /question: 'Where does PillSeek get its data\?'/)
  assert.match(faqItemsSource, /question: 'Can I identify a pill by its imprint\?'/)
  assert.match(faqItemsSource, /question: 'Is this a substitute for medical advice\?'/)
  assert.match(faqItemsSource, /question: "What if my pill isn't in the database\?"/)
})
