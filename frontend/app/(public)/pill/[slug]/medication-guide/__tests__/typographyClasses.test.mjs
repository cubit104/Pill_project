import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function read(relativePath) {
  return readFileSync(resolve(__dirname, relativePath), 'utf8')
}

test('TOC headings and links use readable navigation classes', () => {
  const medguideToc = read('../MedguideToc.tsx')
  const professionalToc = read('../ProfessionalToc.tsx')

  assert.ok(medguideToc.includes('text-sm font-bold text-slate-700 uppercase tracking-widest mb-4'))
  assert.ok(professionalToc.includes('text-sm font-bold text-slate-700 uppercase tracking-widest mb-4'))
  assert.ok(medguideToc.includes('text-sm leading-5 text-emerald-700 transition-colors'))
  assert.ok(professionalToc.includes('text-sm leading-5 text-emerald-700 transition-colors'))
  assert.ok(medguideToc.includes('space-y-1'))
  assert.ok(professionalToc.includes('space-y-1'))
  assert.ok(medguideToc.includes('max-h-[24rem] overflow-y-auto'))
  assert.ok(professionalToc.includes('max-h-[24rem] overflow-y-auto'))
})

test('medication prose uses shared readable sizing, width, and centering classes', () => {
  const medguidePage = read('../page.tsx')
  const summaryPage = read('../../medication-summary/page.tsx')
  const professionalPage = read('../../professional-information/page.tsx')
  const layoutStyles = read('../layoutStyles.ts')

  assert.ok(layoutStyles.includes('max-w-[70ch] mx-auto text-base leading-relaxed text-slate-800'))
  assert.ok(layoutStyles.includes('[&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-slate-900 [&_h2]:mt-6 [&_h2]:mb-2'))
  assert.ok(layoutStyles.includes('[&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-slate-800 [&_h3]:mt-4 [&_h3]:mb-1'))
  assert.ok(medguidePage.includes('SHARED_READING_PROSE_CLASSES'))
  assert.ok(summaryPage.includes('SHARED_READING_PROSE_CLASSES'))
  assert.ok(professionalPage.includes('SHARED_READING_PROSE_CLASSES'))
})

test('professional highlights section headings use centered FDA-style title styling', () => {
  const layoutStyles = read('../layoutStyles.ts')

  assert.ok(layoutStyles.includes('[&_.pro-highlights-title]:text-base'))
  assert.ok(layoutStyles.includes('[&_.pro-highlights-section-title]:text-xs [&_.pro-highlights-section-title]:font-bold [&_.pro-highlights-section-title]:uppercase [&_.pro-highlights-section-title]:tracking-widest [&_.pro-highlights-section-title]:text-slate-900'))
  assert.ok(layoutStyles.includes('[&_.pro-highlights-section-title]:text-center'))
  assert.ok(layoutStyles.includes('[&_h3]:text-xs [&_h3]:font-bold [&_h3]:uppercase [&_h3]:tracking-widest [&_h3]:text-slate-900'))
  assert.ok(layoutStyles.includes('[&_h3]:text-center'))
})

test('professional pages use compact header and place metadata after tabs', () => {
  const medguidePage = read('../page.tsx')
  const professionalPage = read('../../professional-information/page.tsx')

  assert.ok(professionalPage.includes('Professional Prescribing Information'))
  assert.equal(professionalPage.includes('Professional Information — {drugName}'), false)
  assert.ok(professionalPage.indexOf('<MedicationGuideTabs') < professionalPage.indexOf('<MedguideMetaBar guide={guideData} />'))

  assert.ok(medguidePage.includes('Professional Prescribing Information'))
  assert.equal(medguidePage.includes('Professional Information — {drugName}'), false)
  assert.ok(medguidePage.indexOf('<MedicationGuideTabs') < medguidePage.indexOf('<MedguideMetaBar guide={professionalData} />'))
})

test('dosage and adverse-reactions tab hrefs use raw encoded slug across tab pages', () => {
  const medguidePage = read('../page.tsx')
  const summaryPage = read('../../medication-summary/page.tsx')
  const professionalPage = read('../../professional-information/page.tsx')
  const dosagePage = read('../../dosage/page.tsx')
  const adverseReactionsPage = read('../../adverse-reactions/page.tsx')
  const tabs = read('../MedicationGuideTabs.tsx')

  assert.ok(medguidePage.includes('dosageHref={pill?.has_dosage ? `/pill/${encodedSlug}/dosage` : null}'))
  assert.ok(medguidePage.includes('adverseReactionsHref={'))
  assert.ok(medguidePage.includes('pill?.has_adverse_reactions'))
  assert.ok(medguidePage.includes('`/pill/${encodedSlug}/adverse-reactions`'))

  assert.ok(summaryPage.includes('dosageHref={pill?.has_dosage ? `/pill/${encodedSlug}/dosage` : null}'))
  assert.ok(summaryPage.includes('pill?.has_adverse_reactions ? `/pill/${encodedSlug}/adverse-reactions` : null'))

  assert.ok(professionalPage.includes('dosageHref={pill?.has_dosage ? `/pill/${encodeURIComponent(slug)}/dosage` : null}'))
  assert.ok(professionalPage.includes('pill?.has_adverse_reactions ? `/pill/${encodeURIComponent(slug)}/adverse-reactions` : null'))

  assert.ok(dosagePage.includes('activeTab="dosage"'))
  assert.ok(dosagePage.includes('pill?.has_adverse_reactions ? `/pill/${encodedSlug}/adverse-reactions` : null'))

  assert.ok(adverseReactionsPage.includes('activeTab="adverse"'))
  assert.ok(adverseReactionsPage.includes('adverseReactionsHref={`/pill/${encodedSlug}/adverse-reactions`}'))

  assert.ok(tabs.includes("type TabId = 'consumer' | 'dosage' | 'adverse' | 'pro'"))
  assert.ok(tabs.includes('Side Effects'))
})
