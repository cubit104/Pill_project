/**
 * Cleans raw adverse-reactions HTML from DailyMed:
 * - Strips section-number prefixes from headings (e.g. "6.1 Clinical Trials Experience" → "Clinical Trials Experience")
 * - Removes ALL anchor tags, keeping their inner text (unwraps hyperlinks)
 * - Removes inline section-number cross-references like (6.1) or (5.1, 5.3, 6.1)
 * - Removes plain-text cross-refs like [see Warnings and Precautions (5.2)]
 */
export function cleanAdverseReactionsHtml(html: string): string {
  let result = html

  // Remove section-number prefixes from headings: "6.1 Foo" → "Foo"
  result = result.replace(/(>)\s*\d+(\.\d+)*\s+/g, '$1')

  // Strip ALL anchor tags but preserve inner text (removes hyperlinks completely)
  result = result.replace(/<a[^>]*>([\s\S]*?)<\/a>/gi, '$1')

  // Remove inline section refs: (6.1), (5.1, 5.3, 6.1), etc.
  // Matches parenthesised groups of digits/dots/commas/spaces that look like section refs
  result = result.replace(/\(\s*\d+\.\d+(?:\s*,\s*\d+(?:\.\d+)?)*\s*\)/g, '')

  // Remove plain-text cross-refs: [see Warnings and Precautions (5.2)]
  result = result.replace(/\[see[^\]]*\]/gi, '')

  // Clean up extra whitespace left behind
  result = result.replace(/[ \t]{2,}/g, ' ').replace(/\. \./g, '.').trim()

  return result
}
