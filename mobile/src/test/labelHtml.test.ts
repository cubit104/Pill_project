import { describe, expect, it } from 'vitest'
import { cleanLabelHtml, findSectionForRef, labelText, splitLabelSections } from '../lib/labelHtml'

describe('cleanLabelHtml', () => {
  it('keeps in-label cross-reference links, drops numbering and attributes', () => {
    const html =
      '<section><h2 id="adverse-reactions" class="x">Adverse Reactions</h2><p>Bleeding <em><a href="#w" class="pro-section-ref">[see </a><a href="#w2">Warnings (5.2)</a>]</em> occurs.</p><ul><li onclick="evil()">TTP (5.4)</li></ul></section>'
    const out = cleanLabelHtml(html, { dropLeadingHeading: true })
    expect(out).toBe('<p>Bleeding <em><a href="#w">[see </a><a href="#w2">Warnings</a>]</em> occurs.</p><ul><li>TTP</li></ul>')
  })

  it('turns external links into text and removes scripts, images and unknown tags', () => {
    const out = cleanLabelHtml('<p>Hi<script>alert(1)</script><img src=x><font color="red">there</font> <a href="https://x.y">site</a></p>')
    expect(out).toBe('<p>Hi there site</p>')
  })

  it('keeps table spans and heading ids, demotes h1 and strips heading numbers', () => {
    const out = cleanLabelHtml('<h1>Medication Guide</h1><h3 id="dosage-general" class="c">2.1 General Dosing</h3><table><tr><td colspan="2" style="x">a</td></tr></table>')
    expect(out).toBe('<h2>Medication Guide</h2><h3 id="dosage-general">General Dosing</h3><table><tr><td colspan="2">a</td></tr></table>')
  })

  it('preserves parentheticals with words', () => {
    expect(cleanLabelHtml('<p>Dose (300 mg to 325 mg) once (2).</p>')).toBe('<p>Dose (300 mg to 325 mg) once.</p>')
  })

  it('drops linked section numbers like (<a>6.1</a>) but keeps worded links', () => {
    expect(cleanLabelHtml('<p>Common reaction. (<a href="#ar-trials">6.1</a>)</p><p>Avoid <a href="#w">Warnings</a>.</p>')).toBe(
      '<p>Common reaction.</p><p>Avoid <a href="#w">Warnings</a>.</p>',
    )
  })

  it('returns empty for empty input', () => {
    expect(cleanLabelHtml(null)).toBe('')
    expect(labelText('<p>a  b</p>')).toBe('a b')
  })
})

describe('splitLabelSections / findSectionForRef', () => {
  const html =
    '<aside><section><h2 id="boxed-warning">Boxed</h2><p>W</p></section></aside><section><h2 id="indications">1 Indications</h2><p>I</p><section><h3 id="indications-acs">1.1 Sub</h3><p>S</p></section></section><section><h2 id="dosage">2 Dosage</h2><p>D</p></section>'
  const sections = splitLabelSections(html, [
    ['indications', 'Indications'],
    ['boxed-warning', 'Boxed Warning'],
    ['missing', 'Missing'],
    ['dosage', 'Dosage'],
  ])

  it('slices by known h2 ids in document order and skips missing ones', () => {
    expect(sections.map((s) => s.id)).toEqual(['boxed-warning', 'indications', 'dosage'])
    expect(sections[1]?.html).toBe('<p>I</p><h3 id="indications-acs">Sub</h3><p>S</p>')
    expect(sections[2]?.html).toBe('<p>D</p>')
  })

  it('resolves a reference to its section by id, contained heading, or id prefix', () => {
    expect(findSectionForRef(sections, 'dosage')?.id).toBe('dosage')
    expect(findSectionForRef(sections, 'indications-acs')?.id).toBe('indications')
    expect(findSectionForRef(sections, 'dosage-renal-impairment')?.id).toBe('dosage')
    expect(findSectionForRef(sections, 'nope')).toBeNull()
  })
})
