import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  MAX_KEYWORD_LINKS_PER_PAGE,
  buildLinkTargets,
  linkifyHtmlContent,
  linkifyText,
} from '../linkifyUtils'

const linkTargets = buildLinkTargets({
  drugNames: ['BAXFENDY'],
  conditionLinks: [{ term: 'diabetes', slug: 'diabetes' }],
})

test('linkifyHtmlContent caps injected links at 3 and skips h1-h6 headings', () => {
  const html = [
    '<h5>BAXFENDY diabetes</h5>',
    '<p>BAXFENDY is used for diabetes and BAXFENDY follow up.</p>',
    '<h6>diabetes BAXFENDY</h6>',
    '<p>diabetes can appear again.</p>',
  ].join('')

  const output = linkifyHtmlContent(html, linkTargets)
  const linkCount = (output.match(/<a /g) ?? []).length

  assert.equal(linkCount, MAX_KEYWORD_LINKS_PER_PAGE)
  assert.match(output, /<h5>BAXFENDY diabetes<\/h5>/)
  assert.match(output, /<h6>diabetes BAXFENDY<\/h6>/)
  assert.doesNotMatch(output, /<h5>.*<a /)
  assert.doesNotMatch(output, /<h6>.*<a /)
})

test('linkifyHtmlContent enforces shared counter across multiple calls', () => {
  const counter = { count: 0 }
  const first = linkifyHtmlContent('<p>BAXFENDY diabetes</p>', linkTargets, counter)
  const second = linkifyHtmlContent('<p>BAXFENDY diabetes</p>', linkTargets, counter)
  const combined = `${first}${second}`

  assert.equal((combined.match(/<a /g) ?? []).length, MAX_KEYWORD_LINKS_PER_PAGE)
  assert.equal(counter.count, MAX_KEYWORD_LINKS_PER_PAGE)
})

test('linkifyText enforces shared counter across calls', () => {
  const counter = { count: 0 }
  const first = renderToStaticMarkup(
    <>{linkifyText('BAXFENDY helps diabetes symptoms.', 'BAXFENDY', ['diabetes'], ['BAXFENDY'], counter)}</>
  )
  const second = renderToStaticMarkup(
    <>{linkifyText('BAXFENDY and diabetes also appear here.', 'BAXFENDY', ['diabetes'], ['BAXFENDY'], counter)}</>
  )
  const combined = `${first}${second}`

  assert.equal((combined.match(/<a /g) ?? []).length, MAX_KEYWORD_LINKS_PER_PAGE)
  assert.equal(counter.count, MAX_KEYWORD_LINKS_PER_PAGE)
})
