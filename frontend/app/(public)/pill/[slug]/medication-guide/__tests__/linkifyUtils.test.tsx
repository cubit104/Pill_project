import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  MAX_LINKS_PER_TERM,
  buildLinkTargets,
  createTermCounter,
  linkifyHtmlContent,
  linkifyText,
} from '../linkifyUtils'

const linkTargets = buildLinkTargets({
  drugNames: ['BAXFENDY'],
  conditionLinks: [{ term: 'diabetes', slug: 'diabetes' }],
})

test('linkifyHtmlContent caps injected links at MAX_LINKS_PER_TERM per term and skips h1-h6 headings', () => {
  const html = [
    '<h5>BAXFENDY diabetes</h5>',
    '<p>BAXFENDY is used for diabetes and BAXFENDY follow up.</p>',
    '<h6>diabetes BAXFENDY</h6>',
    '<p>BAXFENDY BAXFENDY BAXFENDY BAXFENDY</p>',
  ].join('')

  const counter = createTermCounter()
  const output = linkifyHtmlContent(html, linkTargets, counter)

  assert.equal(counter.get('baxfendy'), MAX_LINKS_PER_TERM)
  assert.match(output, /<h5>BAXFENDY diabetes<\/h5>/)
  assert.match(output, /<h6>diabetes BAXFENDY<\/h6>/)
})

test('linkifyHtmlContent enforces shared counter across multiple calls', () => {
  const counter = createTermCounter()
  const first = linkifyHtmlContent('<p>BAXFENDY diabetes</p>', linkTargets, counter)
  const second = linkifyHtmlContent('<p>BAXFENDY diabetes</p>', linkTargets, counter)
  const third = linkifyHtmlContent('<p>BAXFENDY diabetes</p>', linkTargets, counter)
  const fourth = linkifyHtmlContent('<p>BAXFENDY diabetes</p>', linkTargets, counter)
  const combined = `${first}${second}${third}${fourth}`

  assert.equal(counter.get('baxfendy'), MAX_LINKS_PER_TERM)
  assert.equal(counter.get('diabetes'), MAX_LINKS_PER_TERM)
  assert.equal((combined.match(/<a /g) ?? []).length, MAX_LINKS_PER_TERM * 2)
})

test('linkifyText enforces shared counter across calls', () => {
  const counter = createTermCounter()
  const first = renderToStaticMarkup(
    <>{linkifyText('BAXFENDY helps diabetes symptoms.', 'BAXFENDY', ['diabetes'], ['BAXFENDY'], counter)}</>
  )
  const second = renderToStaticMarkup(
    <>{linkifyText('BAXFENDY and diabetes also appear here.', 'BAXFENDY', ['diabetes'], ['BAXFENDY'], counter)}</>
  )
  const third = renderToStaticMarkup(
    <>{linkifyText('BAXFENDY and diabetes again.', 'BAXFENDY', ['diabetes'], ['BAXFENDY'], counter)}</>
  )
  const fourth = renderToStaticMarkup(
    <>{linkifyText('BAXFENDY and diabetes once more.', 'BAXFENDY', ['diabetes'], ['BAXFENDY'], counter)}</>
  )
  const combined = `${first}${second}${third}${fourth}`

  assert.equal(counter.get('baxfendy'), MAX_LINKS_PER_TERM)
  assert.equal(counter.get('diabetes'), MAX_LINKS_PER_TERM)
  assert.equal((combined.match(/<a /g) ?? []).length, MAX_LINKS_PER_TERM * 2)
})
