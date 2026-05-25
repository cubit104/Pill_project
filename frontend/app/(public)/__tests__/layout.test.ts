import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const layoutPath = new URL('../layout.tsx', import.meta.url)

test('public layout includes mobile header spacer below Header', () => {
  const source = readFileSync(layoutPath, 'utf8')
  assert.match(source, /<Header \/>\s*<div className="h-12 sm:hidden" aria-hidden="true" \/>/)
})
