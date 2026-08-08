import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sourcePath = new URL('../ReviewedBy.tsx', import.meta.url)

test('ReviewedBy source uses API_BASE_URL fallback and cached reviewer fetch', () => {
  const source = readFileSync(sourcePath, 'utf8')
  assert.match(source, /process\.env\.API_BASE_URL \|\| 'http:\/\/localhost:8000'/)
  assert.match(source, /fetchPublicReviewers\(API_BASE, \{ next: \{ revalidate: 3600 \} \}\)/)
})

test('ReviewedBy source prefers medical reviewers and keeps team fallback', () => {
  const source = readFileSync(sourcePath, 'utf8')
  assert.match(source, /reviewer\.role\?\.toLowerCase\(\) === 'medical_reviewer'/)
  assert.match(source, /reviewers\[0\]/)
  assert.match(source, /'PillSeek Editorial Team'/)
  assert.match(source, /href = reviewerSlug \? `\/editorial-team\/\$\{reviewerSlug\}` : '\/editorial-team'/)
})

