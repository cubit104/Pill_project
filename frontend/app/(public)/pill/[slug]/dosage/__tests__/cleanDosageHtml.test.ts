import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanDosageHtml, extractMaxDose } from '../cleanDosageHtml'

// ── Section-reference removal ──────────────────────────────────────────────

test('removes single-integer section ref (2) at end of sentence', () => {
  const input = '<p>Use aspirin 75-100 mg. (2)</p>'
  const result = cleanDosageHtml(input)
  assert.doesNotMatch(result, /\(2\)/)
  assert.match(result, /Use aspirin 75-100 mg\./)
})

test('removes single-integer section ref (3) mid-sentence', () => {
  const input = '<p>Avoid in renal impairment (3) as described.</p>'
  const result = cleanDosageHtml(input)
  assert.doesNotMatch(result, /\(3\)/)
  assert.match(result, /Avoid in renal impairment as described\./)
})

test('removes decimal section ref (2.1)', () => {
  const input = '<p>See general instructions (2.1) for details.</p>'
  const result = cleanDosageHtml(input)
  assert.doesNotMatch(result, /\(2\.1\)/)
})

test('removes decimal section ref (5.1)', () => {
  const input = '<p>Risk of bleeding (5.1) is increased.</p>'
  const result = cleanDosageHtml(input)
  assert.doesNotMatch(result, /\(5\.1\)/)
})

test('removes comma-separated decimal refs (2.1, 2.2)', () => {
  const input = '<p>See dosing sections (2.1, 2.2) for details.</p>'
  const result = cleanDosageHtml(input)
  assert.doesNotMatch(result, /\(2\.1,\s*2\.2\)/)
  assert.doesNotMatch(result, /2\.1/)
})

test('removes comma-separated decimal refs (5.1, 5.2)', () => {
  const input = '<p>Refer to warnings (5.1, 5.2) below.</p>'
  const result = cleanDosageHtml(input)
  assert.doesNotMatch(result, /\(5\.1,\s*5\.2\)/)
})

test('removes mixed integer and decimal refs (2, 2.2)', () => {
  const input = '<p>See sections (2, 2.2) for dosing.</p>'
  const result = cleanDosageHtml(input)
  assert.doesNotMatch(result, /\(2,\s*2\.2\)/)
})

// ── Preservation of legitimate parentheticals ──────────────────────────────

test('preserves parenthetical with letters: (CH8 or greater)', () => {
  const input = '<p>Patients with Child-Pugh score (CH8 or greater) should not use.</p>'
  const result = cleanDosageHtml(input)
  assert.match(result, /\(CH8 or greater\)/)
})

test('preserves parenthetical with units: (300 mg to 325 mg)', () => {
  const input = '<p>Aspirin loading dose (300 mg to 325 mg) on the first day.</p>'
  const result = cleanDosageHtml(input)
  assert.match(result, /\(300 mg to 325 mg\)/)
})

test('preserves parenthetical with drug name: (ticagrelor)', () => {
  const input = '<p>The active ingredient (ticagrelor) inhibits ADP.</p>'
  const result = cleanDosageHtml(input)
  assert.match(result, /\(ticagrelor\)/)
})

// ── [see ...] removal ──────────────────────────────────────────────────────

test('removes [see ...] bracketed cross-reference', () => {
  const input = '<p>Use caution [see Warnings and Precautions (5.1)].</p>'
  const result = cleanDosageHtml(input)
  assert.doesNotMatch(result, /\[see/)
  assert.match(result, /Use caution\./)
})

test('removes [see ...] wrapped in <em>', () => {
  const input = '<p>Avoid combination <em>[see Drug Interactions (7)]</em> when possible.</p>'
  const result = cleanDosageHtml(input)
  assert.doesNotMatch(result, /\[see/)
  assert.doesNotMatch(result, /<em>/)
  assert.match(result, /Avoid combination when possible\./)
})

test('removes multi-section [see ...] reference', () => {
  const input = '<p>Contraindicated <em>[see Warnings and Precautions (5.1) and Clinical Studies (14)]</em>.</p>'
  const result = cleanDosageHtml(input)
  assert.doesNotMatch(result, /\[see/)
  assert.match(result, /Contraindicated\./)
})

// ── Whitespace / punctuation cleanup ──────────────────────────────────────

test('no double spaces after ref removal', () => {
  const input = '<p>Take daily (2)  with food.</p>'
  const result = cleanDosageHtml(input)
  assert.doesNotMatch(result, /  /)
})

test('no space before period after ref removal', () => {
  const input = '<p>Recommended dose is 90 mg (2.1) . Take twice daily.</p>'
  const result = cleanDosageHtml(input)
  assert.doesNotMatch(result, / \./)
  assert.match(result, /90 mg\./)
})

test('no space before comma after ref removal', () => {
  const input = '<p>Dose is 90 mg (2) , taken with food.</p>'
  const result = cleanDosageHtml(input)
  assert.doesNotMatch(result, / ,/)
})

// ── Section headings preserved ─────────────────────────────────────────────

test('strips subsection numbers from h3 headings', () => {
  const input = '<h3>2.1 General Instructions</h3><p>Text here.</p>'
  const result = cleanDosageHtml(input)
  assert.doesNotMatch(result, /2\.1 General Instructions/)
  assert.match(result, /<h3>General Instructions<\/h3>/)
})

test('strips multi-level subsection numbers from h3 headings', () => {
  const input = '<h3>2.1.3 Titration Guidance</h3>'
  const result = cleanDosageHtml(input)
  assert.match(result, /<h3>Titration Guidance<\/h3>/)
})

test('strips subsection numbers from h4 headings', () => {
  const input = '<h4>4.2 Renal Impairment</h4>'
  const result = cleanDosageHtml(input)
  assert.match(result, /<h4>Renal Impairment<\/h4>/)
})

test('removes empty paragraph tags', () => {
  const input = '<p>Keep this.</p><p>   </p><p></p>'
  const result = cleanDosageHtml(input)
  assert.match(result, /<p>Keep this\.<\/p>/)
  assert.doesNotMatch(result, /<p>\s*<\/p>/)
})

test('removes top-level h2 with id="dosage"', () => {
  const input = '<h2 id="dosage">Dosage and Administration</h2><p>Content.</p>'
  const result = cleanDosageHtml(input)
  assert.doesNotMatch(result, /<h2/)
  assert.doesNotMatch(result, /Dosage and Administration/)
  assert.match(result, /Content\./)
})

// ── <a> tag stripping ──────────────────────────────────────────────────────

test('strips <a> tags but keeps link text', () => {
  const input = '<p>See <a href="#section2">Section 2</a> for details.</p>'
  const result = cleanDosageHtml(input)
  assert.doesNotMatch(result, /<a/)
  assert.match(result, /Section 2/)
})

// ── Max dose extraction ──────────────────────────────────────────────────────

test('extracts max dose from "maximum recommended dose is"', () => {
  const html = '<p>The maximum recommended dose is 40 mg daily.</p>'
  assert.equal(extractMaxDose(html), '40 mg')
})

test('extracts max dose from "not to exceed"', () => {
  const html = '<p>Maximum total amount is not to exceed 10 mg/day.</p>'
  assert.equal(extractMaxDose(html), '10 mg/day')
})

test('extracts max dose from "Use 40 mg dose only"', () => {
  const html = '<p>For severe cases, use 40 mg dose only.</p>'
  assert.equal(extractMaxDose(html), '40 mg')
})

test('extracts max dose from "dose should not exceed"', () => {
  const html = '<p>The dose should not exceed 20 mg/kg in children.</p>'
  assert.equal(extractMaxDose(html), '20 mg/kg')
})

test('returns null when no max dose pattern is found', () => {
  const html = '<p>Initial dose is 5 mg once daily.</p>'
  assert.equal(extractMaxDose(html), null)
})
