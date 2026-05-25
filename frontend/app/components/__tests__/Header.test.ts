import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const headerPath = new URL('../Header.tsx', import.meta.url)
const source = readFileSync(headerPath, 'utf8')

test('header uses tighter container height while keeping brand sizing classes', () => {
  assert.match(source, /className="max-w-6xl mx-auto px-4 h-12 flex items-center justify-between"/)
  assert.match(source, /className="h-9 w-9 object-contain"/)
  assert.match(source, /className="text-2xl font-extrabold tracking-tight"/)
})

test('header applies mobile-only hide on scroll behavior with smooth transform', () => {
  assert.match(source, /const \[hidden, setHidden\] = useState\(false\)/)
  assert.match(source, /const lastScrollY = useRef\(0\)/)
  assert.match(source, /const mobileBreakpoint = window\.matchMedia\('\(max-width: 639px\)'\)/)
  assert.match(source, /mobileBreakpoint\.addEventListener\('change', syncViewportState\)/)
  assert.match(source, /window\.addEventListener\('scroll', handleScroll, \{ passive: true \}\)/)
  assert.match(source, /fixed sm:sticky top-0 left-0 w-full z-40/)
  assert.match(source, /pt-\[env\(safe-area-inset-top\)\] sm:pt-0/)
  assert.match(source, /transition-transform duration-300 sm:transition-none/)
  assert.match(source, /hidden \? '-translate-y-full sm:translate-y-0' : 'translate-y-0'/)
  assert.match(source, /<div className="h-\[calc\(3rem\+env\(safe-area-inset-top\)\)\] sm:hidden" aria-hidden="true" \/>/)
})
