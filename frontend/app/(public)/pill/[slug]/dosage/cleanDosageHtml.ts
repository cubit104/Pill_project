/**
 * Clean dosage HTML for patient-facing display:
 * 1. Remove <section> wrappers (keep inner content)
 * 2. Remove the top-level <h2 id="dosage"> title (redundant with page header)
 * 3. Strip all <a> tags but keep their inner text
 * 4. Remove [see ...] bracketed cross-references (including italic <em> wrappers)
 * 5. Remove ALL FDA label section cross-references:
 *    - Single integers:    (2), (3)
 *    - Decimals:           (2.1), (5.1)
 *    - Comma-separated:    (2.1, 2.2), (5.1, 5.2), (2, 2.2)
 *    Only strips groups consisting solely of section-number tokens
 *    (digits with optional single decimal) separated by commas.
 *    Preserves parentheticals that contain letters/words, e.g.
 *    "(CH8 or greater)", "(300 mg to 325 mg)", "(ticagrelor)".
 * 6. Fix space-before-punctuation artifacts (e.g. "mg ." → "mg.")
 * 7. Collapse leftover double spaces
 */
export function cleanDosageHtml(html: string): string {
  let clean = html

  // Remove <section> wrappers (keep content)
  clean = clean.replace(/<section[^>]*>/gi, '').replace(/<\/section>/gi, '')
  // Remove the top-level dosage h2 (redundant with page header)
  clean = clean.replace(/<h2[^>]*id="dosage"[^>]*>[\s\S]*?<\/h2>/gi, '')
  // Strip <a> tags, keep inner text
  clean = clean.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1')
  // Remove [see ...] inside <em> wrappers first (e.g. <em>[see Warnings (5.1)]</em>)
  clean = clean.replace(/<em[^>]*>\s*\[see[\s\S]*?\]\s*<\/em>/gi, '')
  // Remove any remaining [see ...] patterns
  clean = clean.replace(/\[see[\s\S]*?\]/gi, '')
  // Remove empty <em> tags left over after prior strips
  clean = clean.replace(/<em[^>]*>\s*<\/em>/gi, '')
  // Remove ALL FDA section cross-refs: (2), (2.1), (5.1, 5.2), (2, 2.2), etc.
  // Pattern: optional leading whitespace + '(' + one or more section-number tokens
  //   (each token: one-or-more digits, optionally followed by '.' and more digits)
  //   separated only by ', ' or ',' (no letters allowed) + ')'
  // This will NOT match (CH8 or greater), (300 mg to 325 mg), (ticagrelor).
  clean = clean.replace(/\s*\(\d+(?:\.\d+)?(?:\s*,\s*\d+(?:\.\d+)?)*\)/g, '')
  // Fix space-before-punctuation artifacts (e.g. "daily . " → "daily.")
  clean = clean.replace(/\s+([.,;:])/g, '$1')
  // Strip leading subsection numbers from headings e.g. "2.1 General Dosing Information" → "General Dosing Information"
  clean = clean.replace(/(<h[34][^>]*>)\s*\d+(\.\d+)*\s+/gi, '$1')
  // Remove empty <p> tags that leave blank gaps
  clean = clean.replace(/<p[^>]*>\s*<\/p>/gi, '')
  // Collapse multiple consecutive spaces
  clean = clean.replace(/\s{2,}/g, ' ').trim()

  return clean
}

/**
 * Extract the maximum dose from dosage HTML for tablet medications.
 * Looks for common patterns like:
 * - "maximum dose of 40 mg"
 * - "maximum recommended dose is 40 mg"
 * - "not to exceed 40 mg"
 * - "Use 40 mg dose only"
 * - "maximum daily dose of 40 mg"
 * Returns the matched dose string or null if not found.
 */
export function extractMaxDose(html: string): string | null {
  // Strip tags first for clean text matching
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

  const patterns = [
    /maximum\s+(?:recommended\s+)?(?:daily\s+)?dose\s+(?:is\s+|of\s+)?(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?\s*mg(?:\/(?:day|kg|m²))?)/i,
    /not\s+to\s+exceed\s+(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?\s*mg(?:\/(?:day|kg|m²))?)/i,
    /(?:use\s+)?(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?\s*mg(?:\/(?:day|kg|m²))?)\s+dose\s+only/i,
    /dose\s+(?:should\s+not\s+exceed|must\s+not\s+exceed)\s+(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?\s*mg(?:\/(?:day|kg|m²))?)/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return match[1].trim()
  }
  return null
}
