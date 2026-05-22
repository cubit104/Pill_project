import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sourcePath = new URL('../PillDetailClient.tsx', import.meta.url)

test('detail rows use teal stripe option with tighter inline layout', () => {
  const source = readFileSync(sourcePath, 'utf8')

  assert.match(source, /function DetailRow\(\{ label, value, stripe \}: \{ label: string; value\?: string; stripe\?: boolean \}\)/)
  assert.match(source, /py-2 px-3 flex flex-row items-start gap-2 rounded \$\{stripe \? 'bg-teal-50' : ''\}/)
  assert.match(source, /<dt className="text-sm font-medium text-slate-500 w-36 shrink-0">\{label\}<\/dt>/)
})

test('pill specs heading and grid striping classes are updated', () => {
  const source = readFileSync(sourcePath, 'utf8')

  assert.match(source, />Pill Specifications<\/h2>/)
  assert.doesNotMatch(source, />Pill Specs<\/h2>/)
  assert.match(source, /\[\&>div:nth-child\(even\)\]:bg-teal-50/)
  assert.match(source, /sm:\[\&>div:nth-child\(4n\+3\)\]:bg-teal-50/)
  assert.match(source, /sm:\[\&>div:nth-child\(4n\+4\)\]:bg-teal-50/)
  assert.match(source, /className="col-span-full py-2 px-3 flex flex-row items-start gap-2 rounded"/)
})

test('target card headings include emerald left accent bar', () => {
  const source = readFileSync(sourcePath, 'utf8')

  assert.match(source, />Pill Identification<\/h2>/)
  assert.match(source, />Composition<\/h2>/)
  assert.match(source, />About this medication<\/h2>/)
  assert.match(source, />Frequently Asked Questions<\/h2>/)
  assert.match(source, />Related Medications<\/h2>/)
  assert.match(source, /Other medications used for the same condition/)
  assert.match(source, /Similar-looking pills — double-check before taking/)
  assert.ok((source.match(/border-l-4 border-emerald-500 pl-3/g) || []).length >= 8)
})
