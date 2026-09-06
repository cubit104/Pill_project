/**
 * FDA label HTML → app-friendly HTML. The API returns DailyMed fragments with
 * anchors, ids, classes and cross-references meant for the website. The app
 * renders them inside native-styled cards, so this strips everything except a
 * small set of structural tags and keeps text intact. Cross-references
 * ("[see Warnings and Precautions (5.1)]") stay as in-label links (href="#id")
 * that the screen turns into jumps; the "(5.1)" numbering is removed.
 *
 * String-based (no DOM) so it runs in tests and never touches document.
 */

// Structural wrappers (section/article/aside/div/span) are unwrapped: the app supplies its own
// cards, and slicing a label into sections must not leave dangling wrapper tags.
const KEEP_TAGS = new Set([
  'a', 'p', 'br', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u', 'sup', 'sub',
  'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'dl', 'dt', 'dd', 'blockquote', 'caption',
])
const DROP_WITH_CONTENT = [
  'script', 'style', 'img', 'svg', 'iframe', 'object', 'embed', 'button', 'form', 'input', 'select', 'textarea', 'nav', 'header', 'footer',
]
const ID_RE = /\bid\s*=\s*["']([A-Za-z0-9_.:-]+)["']/i
const HASH_HREF_RE = /\bhref\s*=\s*["']#([A-Za-z0-9_.:-]+)["']/i

function stripDangerousBlocks(html: string): string {
  return DROP_WITH_CONTENT.reduce((h, tag) => {
    const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>|<${tag}\\b[^>]*\\/?>`, 'gi')
    return h.replace(re, '')
  }, html).replace(/<!--[\s\S]*?-->/g, '')
}

/** External / non-anchor links become plain text; only in-label "#id" links survive. */
function unwrapExternalLinks(html: string): string {
  return html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (whole, attrs: string, text: string) => (HASH_HREF_RE.test(attrs) ? whole : text))
}

/** Drop every attribute except table spans, heading ids and in-label hrefs; unwrap tags we don't keep. */
function normaliseTags(html: string): string {
  return html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (whole, rawName: string, attrs: string) => {
    const name = rawName.toLowerCase()
    const closing = whole.startsWith('</')
    // Unwrapped tags become a space so adjacent words don't fuse ("Information</span><span>Revised").
    if (!KEEP_TAGS.has(name)) return ' '
    if (name === 'br') return '<br>'
    if (closing) return `</${name}>`
    let kept = ''
    if (name === 'td' || name === 'th') {
      const col = /\bcolspan\s*=\s*["']?(\d+)/i.exec(attrs)
      const row = /\browspan\s*=\s*["']?(\d+)/i.exec(attrs)
      if (col) kept += ` colspan="${col[1]}"`
      if (row) kept += ` rowspan="${row[1]}"`
    } else if (/^h[2-6]$/.test(name)) {
      const id = ID_RE.exec(attrs)
      if (id) kept += ` id="${id[1]}"`
    } else if (name === 'a') {
      const href = HASH_HREF_RE.exec(attrs)
      if (!href) return ' '
      kept += ` href="#${href[1]}"`
    }
    return `<${name}${kept}>`
  })
}

/** Remove FDA section numbering in cross-references: "(2.1)", "(5.1, 5.2)", bare "(7)", and "(<a>6.1</a>)". */
function stripSectionNumbers(html: string): string {
  return html
    .replace(/\s*\(\s*(?:<a href="#[^"]*">\s*\d+(?:\.\d+)?\s*<\/a>\s*,?\s*)+\)/g, '')
    .replace(/\s*\(\s*\d+(?:\.\d+)?(?:\s*,\s*\d+(?:\.\d+)?)*\s*\)/g, '')
}

export interface CleanOptions {
  /** Remove a leading title heading that repeats the screen title (h1/h2 at the very top). */
  dropLeadingHeading?: boolean
}

export function cleanLabelHtml(input: string | null | undefined, options: CleanOptions = {}): string {
  if (!input) return ''
  let html = stripDangerousBlocks(input)
  // Titles come from the API as h1 inside medguide_html; demote so the card hierarchy holds.
  html = html.replace(/<(\/?)h1\b([^>]*)>/gi, '<$1h2$2>')
  html = unwrapExternalLinks(html)
  html = normaliseTags(html)
  html = stripSectionNumbers(html)
  if (options.dropLeadingHeading) html = html.replace(/^\s*<h2[^>]*>[\s\S]*?<\/h2>/i, '')
  // "2.1 General Dosing Information" → "General Dosing Information"
  html = html.replace(/(<h[2-6][^>]*>)\s*\d+(?:\.\d+)*\s+/g, '$1')
  html = html
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/<a href="#[^"]*">\s*<\/a>/gi, '')
    .replace(/<(p|li|em|strong|i|b)>\s*<\/\1>/gi, '')
    .replace(/(?:<br>\s*){2,}/gi, '<br>')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    // Whitespace between block tags is noise; between inline tags ("[see </a><a>") it is a word gap.
    .replace(/(<\/?(?:p|ul|ol|li|h[2-6]|table|thead|tbody|tfoot|tr|td|th|dl|dt|dd|blockquote|caption|br)(?:\s[^>]*)?>)\s+</g, '$1<')
    .replace(/\s+(<\/(?:p|li|h[2-6]|td|th|dt|dd|caption|blockquote|strong|em|b|i)>)/g, '$1')
    .replace(/(<(?:p|li|h[2-6][^>]*|td|th|dt|dd|caption|blockquote)>)\s+/g, '$1')
    .trim()
  return html
}

/** Plain text (for previews / accessibility). */
export function labelText(html: string | null | undefined): string {
  return cleanLabelHtml(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export interface LabelSection {
  id: string
  title: string
  html: string
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Split a full professional label into its top-level sections using the ids the API
 * lists in `professional_sections` ([id, title] pairs). Sections whose heading can't
 * be located are skipped.
 */
export function splitLabelSections(html: string | null | undefined, ids: Array<[string, string]>): LabelSection[] {
  if (!html || ids.length === 0) return []
  const found: Array<{ id: string; title: string; start: number; headingEnd: number }> = []
  for (const [id, title] of ids) {
    const re = new RegExp(`<h2\\b[^>]*\\bid=["']${escapeRegExp(id)}["'][^>]*>[\\s\\S]*?<\\/h2>`, 'i')
    const m = re.exec(html)
    if (m) found.push({ id, title, start: m.index, headingEnd: m.index + m[0].length })
  }
  found.sort((a, b) => a.start - b.start)
  return found
    .map((s, i) => {
      const end = found[i + 1]?.start ?? html.length
      return { id: s.id, title: s.title, html: cleanLabelHtml(html.slice(s.headingEnd, end)) }
    })
    .filter((s) => s.html.length > 0)
}

/**
 * Which top-level section a cross-reference id lives in: the section itself, a
 * subsection heading inside it, or (DailyMed convention) the longest section id
 * that prefixes the reference, e.g. "warnings-precautions-bleeding" → "warnings-precautions".
 */
export function findSectionForRef(sections: LabelSection[], ref: string): LabelSection | null {
  const exact = sections.find((s) => s.id === ref)
  if (exact) return exact
  const needle = ` id="${ref}"`
  const inside = sections.find((s) => s.html.includes(needle))
  if (inside) return inside
  let best: LabelSection | null = null
  for (const s of sections) {
    if (ref.startsWith(`${s.id}-`) && (!best || s.id.length > best.id.length)) best = s
  }
  return best
}
