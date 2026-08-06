import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const previewPagePath = new URL('../page.tsx', import.meta.url)
const adminEditPagePath = new URL('../../../../../admin/pills/[id]/page.tsx', import.meta.url)

test('draft preview page source shows banner and disables view tracking', () => {
  const source = readFileSync(previewPagePath, 'utf8')

  assert.match(source, /setPreviewBanner\(/)
  assert.match(source, /previewBanner && \(/)
  assert.match(source, /\/api\/pill\/preview\/\$\{encodeURIComponent\(pillId\)\}/)
  assert.match(source, /trackView=\{false\}/)
})

test('admin edit page source includes Preview Draft button', () => {
  const source = readFileSync(adminEditPagePath, 'utf8')

  assert.match(source, /Preview Draft/)
  assert.match(source, /href=\{`\/pill\/preview\/\$\{encodeURIComponent\(String\(pill\.id\)\)\}`\}/)
})
