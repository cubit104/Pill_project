import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const medicationGuidePath = new URL('../medication-guide/page.tsx', import.meta.url)
const medicationSummaryPath = new URL('../medication-summary/page.tsx', import.meta.url)
const professionalInfoPath = new URL('../professional-information/page.tsx', import.meta.url)
const sharedLayoutStylesPath = new URL('../medication-guide/layoutStyles.ts', import.meta.url)

test('medication guide prose uses SHARED_READING_PROSE_CLASSES', () => {
  const source = readFileSync(medicationGuidePath, 'utf8')
  const layoutSource = readFileSync(sharedLayoutStylesPath, 'utf8')

  // Page references the shared constant
  assert.ok(source.includes('SHARED_READING_PROSE_CLASSES'))

  // Shared constant contains the expected typography strings
  assert.ok(layoutSource.includes('max-w-[70ch] mx-auto text-base leading-relaxed text-slate-800'))
  assert.ok(layoutSource.includes('[&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-slate-900 [&_h2]:mt-6 [&_h2]:mb-2'))
  assert.ok(layoutSource.includes('[&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-slate-800 [&_h3]:mt-4 [&_h3]:mb-1'))
  assert.ok(layoutSource.includes('[&_p]:mt-0 [&_p]:mb-4 [&_p]:text-base [&_p]:leading-relaxed [&_p]:text-slate-800'))
  assert.ok(layoutSource.includes('[&_li]:text-base [&_li]:leading-relaxed [&_li]:text-slate-800'))
})

test('medication summary cards render using SHARED_READING_PROSE_CLASSES', () => {
  const source = readFileSync(medicationSummaryPath, 'utf8')
  const layoutSource = readFileSync(sharedLayoutStylesPath, 'utf8')

  // Page references the shared constant
  assert.ok(source.includes('SHARED_READING_PROSE_CLASSES'))

  // Shared constant has the base prose string
  assert.ok(layoutSource.includes('max-w-[70ch] mx-auto text-base leading-relaxed text-slate-800'))
})

test('professional information prose wrappers use SHARED_READING_PROSE_CLASSES', () => {
  const professionalSource = readFileSync(professionalInfoPath, 'utf8')
  const layoutSource = readFileSync(sharedLayoutStylesPath, 'utf8')

  // Page references the shared constant
  assert.ok(professionalSource.includes('SHARED_READING_PROSE_CLASSES'))

  // Shared constant contains expected strings
  assert.ok(layoutSource.includes('[&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-slate-900 [&_h2]:mt-6 [&_h2]:mb-2'))
  assert.ok(layoutSource.includes('[&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-slate-800 [&_h3]:mt-4 [&_h3]:mb-1'))
  assert.ok(layoutSource.includes('[&_p]:mt-0 [&_p]:mb-4 [&_p]:text-base [&_p]:leading-relaxed [&_p]:text-slate-800'))
  assert.ok(layoutSource.includes('[&_li]:text-base [&_li]:leading-relaxed [&_li]:text-slate-800'))
})
