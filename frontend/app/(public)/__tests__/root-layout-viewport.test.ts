import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const rootLayoutPath = new URL('../../layout.tsx', import.meta.url)

test('root viewport enables iOS edge-to-edge rendering', () => {
  const source = readFileSync(rootLayoutPath, 'utf8')
  assert.match(source, /viewportFit:\s*'cover'/)
})
