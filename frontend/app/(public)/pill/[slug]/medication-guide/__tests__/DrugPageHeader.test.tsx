import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import DrugPageHeader from '../DrugPageHeader'

test('DrugPageHeader renders generic relationship and metadata chips for brand-primary drugs', () => {
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
  assert.match(html, /Generic:<\/span> clopidogrel bisulfate/)
  assert.match(html, /Platelet aggregation inhibitors/)
  assert.match(html, /Tablet, film coated/)
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

  assert.match(html, /Brand names:<\/span> Plavix, Iscover/)
  assert.doesNotMatch(html, /Generic:/)
})
