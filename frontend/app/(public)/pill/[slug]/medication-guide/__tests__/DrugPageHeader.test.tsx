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

test('DrugPageHeader trims generic-primary H1 names to the medication only', () => {
  const html = renderToStaticMarkup(
    <DrugPageHeader
      pageLabel="Professional Information"
      drugName="Clopidogrel Bisulfate Apo Cl 75"
      genericName="clopidogrel bisulfate"
      brandName="Plavix"
      isBrandPrimary={false}
    />
  )

  assert.match(html, />Clopidogrel Bisulfate<\/h1>/)
  assert.doesNotMatch(html, /Apo Cl 75/)
  assert.match(html, /Brand names:<\/span>\s*<span class="text-slate-800">Plavix<\/span>/)
})

test('DrugPageHeader trims generic-primary H1 names with manufacturer-only suffixes', () => {
  const html = renderToStaticMarkup(
    <DrugPageHeader
      pageLabel="Medication Guide"
      drugName="Clopidogrel Bisulfate Apo"
      genericName="clopidogrel bisulfate"
      brandName="Plavix"
      isBrandPrimary={false}
    />
  )

  assert.match(html, />Clopidogrel Bisulfate<\/h1>/)
  assert.doesNotMatch(html, /Apo/)
  assert.match(html, /Brand names:<\/span>\s*<span class="text-slate-800">Plavix<\/span>/)
})

test('DrugPageHeader shows brand names when generic matches H1 even if flagged brand-primary', () => {
  const html = renderToStaticMarkup(
    <DrugPageHeader
      pageLabel="Medication Guide"
      drugName="Losartan Potassium"
      genericName="Losartan Potassium"
      brandName="Cozaar"
      isBrandPrimary
    />
  )

  assert.match(html, /Brand names:<\/span>\s*<span class="text-slate-800">Cozaar<\/span>/)
  assert.doesNotMatch(html, /Generic:<\/span>\s*<span class="text-slate-800">Losartan Potassium<\/span>/)
})

test('DrugPageHeader strips numeric/imprint suffixes from H1 when no clean generic is provided', () => {
  const html = renderToStaticMarkup(
    <DrugPageHeader
      pageLabel="Medication Guide"
      drugName="Ticagrelor 90 T 00186 0777 60"
      brandName="Brilinta"
      isBrandPrimary={false}
    />
  )

  assert.match(html, />Ticagrelor<\/h1>/)
  assert.doesNotMatch(html, /90 T 00186 0777 60/)
})

test('DrugPageHeader strips simple trailing numeric strength tokens', () => {
  const html = renderToStaticMarkup(
    <DrugPageHeader
      pageLabel="Medication Guide"
      drugName="Ticagrelor 90"
      isBrandPrimary={false}
    />
  )

  assert.match(html, />Ticagrelor<\/h1>/)
  assert.doesNotMatch(html, />Ticagrelor 90<\/h1>/)
})

test('DrugPageHeader keeps names where numbers are not imprint-like suffixes', () => {
  const html = renderToStaticMarkup(
    <DrugPageHeader
      pageLabel="Medication Guide"
      drugName="Vitamin B 12 Complex"
      isBrandPrimary={false}
    />
  )

  assert.match(html, />Vitamin B 12 Complex<\/h1>/)
})

test('DrugPageHeader renders pronunciation text when provided', () => {
  const html = renderToStaticMarkup(
    <DrugPageHeader
      pageLabel="Medication Guide"
      drugName="Lisinopril"
      pronunciation="lye sin' oh pril"
      isBrandPrimary={false}
    />
  )

  assert.match(html, /Pronounced as: lye sin(?:'|&#x27;) oh pril/)
})

test('DrugPageHeader hides pronunciation text when missing', () => {
  const html = renderToStaticMarkup(
    <DrugPageHeader
      pageLabel="Medication Guide"
      drugName="Lisinopril"
      pronunciation={null}
      isBrandPrimary={false}
    />
  )

  assert.doesNotMatch(html, /Pronounced as:/)
})
