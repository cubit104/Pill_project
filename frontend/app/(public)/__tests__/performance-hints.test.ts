import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const rootLayoutPath = new URL('../../layout.tsx', import.meta.url)
const googleAnalyticsPath = new URL('../../components/GoogleAnalytics.tsx', import.meta.url)
const homeSearchPath = new URL('../../components/HomeSearch.tsx', import.meta.url)

test('root layout adds third-party preconnect and dns-prefetch hints', () => {
  const source = readFileSync(rootLayoutPath, 'utf8')
  assert.match(source, /rel="preconnect" href="https:\/\/www\.googletagmanager\.com"/)
  assert.match(source, /rel="preconnect" href="https:\/\/us-assets\.i\.posthog\.com"/)
  assert.match(source, /rel="preconnect" href="https:\/\/us\.i\.posthog\.com"/)
  assert.match(source, /rel="dns-prefetch" href="\/\/www\.googletagmanager\.com"/)
  assert.match(source, /rel="dns-prefetch" href="\/\/us-assets\.i\.posthog\.com"/)
  assert.match(source, /rel="dns-prefetch" href="\/\/us\.i\.posthog\.com"/)
})

test('google analytics script is deferred with lazyOnload', () => {
  const source = readFileSync(googleAnalyticsPath, 'utf8')
  assert.match(source, /gtag\/js\?id=\$\{gaId\}/)
  assert.match(source, /strategy="lazyOnload"/)
})

test('home search lazy-loads SearchBar with an ssr:false fallback shell', () => {
  const source = readFileSync(homeSearchPath, 'utf8')
  assert.match(source, /dynamic\(\(\) => import\('\.\/SearchBar'\),/)
  assert.match(source, /ssr:\s*false/)
  assert.match(source, /min-h-\[252px\]/)
})
