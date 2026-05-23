import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sourcePath = new URL('../PillDetailClient.tsx', import.meta.url)

test('detail rows use teal stripe option with tighter inline layout', () => {
  const source = readFileSync(sourcePath, 'utf8')

  assert.ok(source.includes('function DetailRow({ label, value, stripe }'))
  assert.ok(source.includes("py-2 px-3 flex flex-row items-start gap-2 rounded ${stripe ? 'bg-teal-50' : ''}"))
  assert.ok(source.includes('text-sm font-medium text-slate-500 w-36 shrink-0'))
})

test('pill specs heading and grid striping classes are updated', () => {
  const source = readFileSync(sourcePath, 'utf8')

  assert.match(source, />Pill Specifications<\/h2>/)
  assert.doesNotMatch(source, />Pill Specs<\/h2>/)
  assert.match(source, /const PILL_SPECS_STRIPE_CLASSES =/)
  assert.match(source, /\[\&>div:nth-child\(even\)\]:bg-teal-50/)
  assert.match(source, /sm:\[\&>div:nth-child\(4n\+3\)\]:bg-teal-50/)
  assert.match(source, /sm:\[\&>div:nth-child\(4n\+4\)\]:bg-teal-50/)
  assert.match(source, /<dl className=\{PILL_SPECS_STRIPE_CLASSES\}>/)
  assert.match(source, /className="col-span-full py-2 px-3 flex flex-row items-start gap-2 rounded"/)
})

test('target card headings include emerald left accent bar', () => {
  const source = readFileSync(sourcePath, 'utf8')
  const accentHeadingClass = 'text-base font-semibold text-slate-800 mb-4 border-l-4 border-emerald-500 pl-3'

  const mb4Headings = [
    'Pill Identification',
    'Pill Specifications',
    'Composition',
    'About this medication',
    'Frequently Asked Questions',
    'Other medications used for the same condition',
  ]
  for (const heading of mb4Headings) {
    assert.ok(source.includes(`<h2 className="${accentHeadingClass}">${heading}</h2>`))
  }
  assert.ok(source.includes('<h2 className="text-base font-semibold text-slate-800 mb-1 border-l-4 border-emerald-500 pl-3">Related Medications</h2>'))
  assert.ok(source.includes('<h2 className="text-base font-semibold text-slate-800 mb-4 border-l-4 border-emerald-500 pl-3">Similar-looking pills — double-check before taking</h2>'))
})
