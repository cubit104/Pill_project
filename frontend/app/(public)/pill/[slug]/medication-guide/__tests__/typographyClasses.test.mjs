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

test('professional highlights headings use stronger title styling', () => {
  const layoutStyles = read('../layoutStyles.ts')

  assert.ok(layoutStyles.includes('[&_.pro-highlights-title]:text-base'))
  assert.ok(layoutStyles.includes('[&_.pro-highlights-section-title]:text-slate-900'))
  assert.ok(layoutStyles.includes('[&_h3]:text-xs [&_h3]:font-bold [&_h3]:uppercase [&_h3]:tracking-widest [&_h3]:text-slate-900'))
})

test('professional pages use compact header and place metadata after tabs', () => {
  const medguidePage = read('../page.tsx')
  const professionalPage = read('../../professional-information/page.tsx')

  assert.ok(professionalPage.includes('Professional Prescribing Information'))
  assert.ok(professionalPage.includes('<h1 className="text-2xl font-bold text-slate-900">{drugName}</h1>'))
  assert.equal(professionalPage.includes('Professional Information — {drugName}'), false)
  assert.ok(professionalPage.indexOf('<MedicationGuideTabs') < professionalPage.indexOf('<MedguideMetaBar guide={guideData} />'))

  assert.ok(medguidePage.includes('Professional Prescribing Information'))
  assert.ok(medguidePage.includes('<h1 className="text-2xl font-bold text-slate-900">{drugName}</h1>'))
  assert.equal(medguidePage.includes('Professional Information — {drugName}'), false)
  assert.ok(medguidePage.indexOf('<MedicationGuideTabs') < medguidePage.indexOf('<MedguideMetaBar guide={professionalData} />'))
})
