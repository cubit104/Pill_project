import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const pagePath = new URL('../page.tsx', import.meta.url)
const source = readFileSync(pagePath, 'utf8')

test('home page pillar cards use non-404 launch links', () => {
  assert.match(source, /href: '\/search\?q=lisinopril'/)
  assert.match(source, /href: '\/pill\/plavix-75-1171\/price'/)
  assert.match(source, /href: '\/search\?q=metformin'/)
})

test('home page hero uses tighter launch spacing', () => {
  assert.match(source, /section className="bg-gradient-to-b from-slate-50 to-white py-6 sm:py-8 px-4"/)
  assert.match(source, /width=\{68\}/)
  assert.match(source, /height=\{68\}/)
  assert.match(source, /h1 className="text-3xl sm:text-4xl font-bold mb-2 tracking-tight text-slate-900"/)
})
