import { describe, expect, it } from 'vitest'
import { cleanLabelHtml, labelText, splitLabelSections } from '../lib/labelHtml'

describe('cleanLabelHtml', () => {
  it('drops attributes, anchors and cross-references but keeps text and structure', () => {
    const html =
      '<section><h2 id="adverse-reactions" class="x">Adverse Reactions</h2><p>Bleeding <em><a href="#w" class="pro-section-ref">[see </a><a href="#w2">Warnings (5.2)</a>]</em> occurs.</p><ul><li onclick="evil()">TTP (5.4)</li></ul></section>'
    const out = cleanLabelHtml(html, { dropLeadingHeading: true })
    expect(out).toBe('<p>Bleeding occurs.</p><ul><li>TTP</li></ul>')
  })

  it('removes scripts, images and unknown tags entirely or by unwrapping', () => {
    const out = cleanLabelHtml('<p>Hi<script>alert(1)</script><img src=x><font color="red">there</font></p>')
    expect(out).toBe('<p>Hi there</p>')
  })

  it('keeps table spans, demotes h1 and strips heading numbers', () => {
    const out = cleanLabelHtml('<h1>Medication Guide</h1><h3>2.1 General Dosing</h3><table><tr><td colspan="2" style="x">a</td></tr></table>')
    expect(out).toBe('<h2>Medication Guide</h2><h3>General Dosing</h3><table><tr><td colspan="2">a</td></tr></table>')
  })

  it('preserves parentheticals with words', () => {
    expect(cleanLabelHtml('<p>Dose (300 mg to 325 mg) once (2).</p>')).toBe('<p>Dose (300 mg to 325 mg) once.</p>')
  })

  it('returns empty for empty input', () => {
    expect(cleanLabelHtml(null)).toBe('')
    expect(labelText('<p>a  b</p>')).toBe('a b')
  })
})

describe('splitLabelSections', () => {
  it('slices by known h2 ids in document order and skips missing ones', () => {
    const html =
      '<aside><section><h2 id="boxed-warning">Boxed</h2><p>W</p></section></aside><section><h2 id="indications">1 Indications</h2><p>I</p><section><h3>1.1 Sub</h3><p>S</p></section></section><section><h2 id="dosage">2 Dosage</h2><p>D</p></section>'
    const out = splitLabelSections(html, [
      ['indications', 'Indications'],
      ['boxed-warning', 'Boxed Warning'],
      ['missing', 'Missing'],
      ['dosage', 'Dosage'],
    ])
    expect(out.map((s) => s.id)).toEqual(['boxed-warning', 'indications', 'dosage'])
    expect(out[1]?.html).toBe('<p>I</p><h3>Sub</h3><p>S</p>')
    expect(out[2]?.html).toBe('<p>D</p>')
  })
})
