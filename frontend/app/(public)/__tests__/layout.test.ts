import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const layoutPath = new URL('../layout.tsx', import.meta.url)

test('public layout renders Header directly above main content', () => {
  const source = readFileSync(layoutPath, 'utf8')
  assert.match(source, /<Header \/>\s*<main className="flex-1">\{children\}<\/main>/)
})
