import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function read(relativePath) {
  return readFileSync(resolve(__dirname, relativePath), 'utf8')
}

test('TOC headings and links use larger typography classes', () => {
  const medguideToc = read('../MedguideToc.tsx')
  const professionalToc = read('../ProfessionalToc.tsx')

  assert.ok(medguideToc.includes('text-sm font-bold text-slate-700 uppercase tracking-widest mb-4'))
  assert.ok(professionalToc.includes('text-sm font-bold text-slate-700 uppercase tracking-widest mb-4'))
  assert.ok(medguideToc.includes('text-sm leading-6'))
  assert.ok(professionalToc.includes('text-sm leading-6'))
})

test('medication prose uses leading-8 instead of leading-relaxed', () => {
  const medguidePage = read('../page.tsx')
  const summaryPage = read('../../medication-summary/page.tsx')
  const professionalPage = read('../../professional-information/page.tsx')
  const layoutStyles = read('../layoutStyles.ts')

  assert.equal(medguidePage.includes('leading-relaxed'), false)
  assert.equal(summaryPage.includes('leading-relaxed'), false)
  assert.equal(professionalPage.includes('leading-relaxed'), false)
  assert.equal(layoutStyles.includes('leading-relaxed'), false)
})
