/**
 * Cleans raw adverse-reactions HTML from DailyMed:
 * - Strips section-number prefixes from headings (e.g. "6.1 Clinical Trials Experience" → "Clinical Trials Experience")
 * - Removes inline section-number cross-references like (6.1) or (6.1.2)
 * - Removes cross-reference links like [see Warnings and Precautions (5.2)] — both plain text and anchor tags
 */
export function cleanAdverseReactionsHtml(html: string): string {
  let result = html

  // Remove section-number prefixes from headings: "6.1 Foo" → "Foo"
  result = result.replace(/(>)\s*\d+(\.\d+)*\s+/g, '$1')

  // Remove inline refs like (6.1) or (6.1.2) — standalone in text
  result = result.replace(/\(\d+(\.\d+)+\)/g, '')

  // Remove cross-ref anchor links: <a ...>[see ...]</a>
  result = result.replace(/<a[^>]*>\s*\[see[^\]]*\]\s*<\/a>/gi, '')

  // Remove plain-text cross-refs: [see Warnings and Precautions (5.2)]
  result = result.replace(/\[see[^\]]*\]/gi, '')

  // Clean up extra whitespace left behind
  result = result.replace(/\s{2,}/g, ' ').replace(/>\s+</g, '><')

  return result
}
