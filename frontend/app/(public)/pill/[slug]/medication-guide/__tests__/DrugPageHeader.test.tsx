import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import DrugPageHeader from '../DrugPageHeader'

test('DrugPageHeader renders generic, class, and dosage lines for brand-primary drugs', () => {
  const html = renderToStaticMarkup(
    <DrugPageHeader
      pageLabel="Medication Guide"
      drugName="Plavix"
      genericName="clopidogrel bisulfate"
      brandName="Plavix, Iscover"
      drugClass="Platelet aggregation inhibitors"
      dosageForm="Tablet, film coated"
      isBrandPrimary
    />
  )

  assert.match(html, />Plavix<\/h1>/)
  assert.match(html, /Generic:<\/span>\s*<span class="text-slate-800">Clopidogrel Bisulfate<\/span>/)
  assert.match(html, /Drug class:<\/span>\s*<span class="text-slate-800">Platelet Aggregation Inhibitors<\/span>/)
  assert.match(html, /Dosage form:<\/span>\s*<span class="text-slate-800">Tablet, Film Coated<\/span>/)
  assert.doesNotMatch(html, /Brand names:/)
})

test('DrugPageHeader renders brand relationship for generic-primary drugs', () => {
  const html = renderToStaticMarkup(
    <DrugPageHeader
      pageLabel="Medication Summary"
      drugName="Clopidogrel"
      brandName="Plavix; Iscover"
      isBrandPrimary={false}
    />
  )

  assert.match(html, /Brand names:<\/span>\s*<span class="text-slate-800">Plavix, Iscover<\/span>/)
  assert.doesNotMatch(html, /Generic:/)
})
