import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const medicationGuidePath = new URL('../medication-guide/page.tsx', import.meta.url)
const medicationSummaryPath = new URL('../medication-summary/page.tsx', import.meta.url)
const professionalInfoPath = new URL('../professional-information/page.tsx', import.meta.url)
const sharedLayoutStylesPath = new URL('../medication-guide/layoutStyles.ts', import.meta.url)

test('medication guide prose uses consistent readable body typography', () => {
  const source = readFileSync(medicationGuidePath, 'utf8')

  assert.ok(source.includes('[&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-slate-900'))
  assert.ok(source.includes('[&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-slate-900'))
  assert.ok(source.includes('[&_p]:text-sm [&_p]:leading-relaxed [&_p]:text-slate-800 [&_p]:my-4'))
  assert.ok(source.includes('[&_li]:text-sm [&_li]:leading-relaxed [&_li]:text-slate-800 [&_li]:my-2'))
  assert.ok(source.includes('my-4 whitespace-pre-line text-sm leading-relaxed text-slate-800'))
})

test('medication summary cards render answer/body copy with updated typography', () => {
  const source = readFileSync(medicationSummaryPath, 'utf8')

  assert.ok(source.includes('mb-3 text-base font-semibold text-slate-900'))
  assert.ok(source.includes('text-sm leading-relaxed text-slate-800'))
  assert.ok(source.includes('text-sm leading-relaxed text-slate-800 space-y-2'))
})

test('professional information prose wrappers use matching typography classes', () => {
  const professionalSource = readFileSync(professionalInfoPath, 'utf8')
  const layoutSource = readFileSync(sharedLayoutStylesPath, 'utf8')

  assert.ok(professionalSource.includes('[&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-slate-900'))
  assert.ok(professionalSource.includes('[&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-slate-900'))
  assert.ok(professionalSource.includes('[&_p]:text-sm [&_p]:leading-relaxed [&_p]:text-slate-800 [&_p]:my-4'))
  assert.ok(professionalSource.includes('[&_li]:text-sm [&_li]:leading-relaxed [&_li]:text-slate-800 [&_li]:my-2'))
  assert.ok(layoutSource.includes('[&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-slate-900'))
  assert.ok(layoutSource.includes('[&_p]:text-sm [&_p]:text-slate-800 [&_p]:leading-relaxed [&_p]:my-2'))
})
