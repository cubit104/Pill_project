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

test('header uses relative mobile positioning with sticky behavior on sm+', () => {
  assert.match(source, /bg-white border-b border-slate-200 shadow-sm relative sm:sticky top-0 z-40/)
  assert.doesNotMatch(source, /const \[hidden, setHidden\] = useState\(false\)/)
  assert.doesNotMatch(source, /const lastScrollY = useRef\(0\)/)
  assert.doesNotMatch(source, /const isMobile = useRef\(false\)/)
  assert.doesNotMatch(source, /window\.addEventListener\('scroll', handleScroll, \{ passive: true \}\)/)
  assert.doesNotMatch(source, /transition-transform duration-300 sm:transition-none/)
  assert.doesNotMatch(source, /-translate-y-full sm:translate-y-0/)
  assert.doesNotMatch(source, /h-\[calc\(3rem\+env\(safe-area-inset-top\)\)\] sm:hidden/)
})
