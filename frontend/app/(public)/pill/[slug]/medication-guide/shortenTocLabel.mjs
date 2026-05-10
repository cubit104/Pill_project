const SHORT_LABEL_PATTERNS = [
  { test: /^what is the most important information/i, label: 'Important info' },
  { test: /^what is\b/i, label: 'About' },
  { test: /^who should (not )?take/i, label: 'Who should avoid' },
  { test: /^what should i (tell|do|not) /i, label: 'Before taking' },
  { test: /^before (taking|using|i take)/i, label: 'Before taking' },
  { test: /^how should i (take|use)/i, label: 'How to take' },
  { test: /^how (do i|to) take/i, label: 'How to take' },
  { test: /^what (are|is) the possible side effects/i, label: 'Side effects' },
  { test: /^side effects/i, label: 'Side effects' },
  { test: /^how should i store/i, label: 'Storage' },
  { test: /^how to store/i, label: 'Storage' },
  { test: /^general information/i, label: 'General info' },
  { test: /^what are the ingredients/i, label: 'Ingredients' },
  { test: /^what (are|is) the ingredients/i, label: 'Ingredients' },
  { test: /^when should i call/i, label: 'When to call' },
  { test: /^what to avoid/i, label: 'What to avoid' },
  { test: /^what should i avoid/i, label: 'What to avoid' },
]

function normalizeWhitespace(text) {
  return (text || '').replace(/\s+/g, ' ').trim()
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripDrugName(text, drugName) {
  const normalized = normalizeWhitespace(text)
  const normalizedDrugName = normalizeWhitespace(drugName)
  if (!normalizedDrugName) return normalized
  return normalizeWhitespace(
    normalized.replace(new RegExp(escapeRegex(normalizedDrugName), 'ig'), '')
  )
}

function trimTrailingPunctuation(text) {
  return text.replace(/[.,:;!?]+$/g, '').trim()
}

function capitalizeFirstWord(text) {
  return text.replace(/^\S+/, (word) => word.charAt(0).toUpperCase() + word.slice(1))
}

export function shortenTocLabel(fullText, drugName = '') {
  const original = normalizeWhitespace(fullText)
  if (!original) return ''

  const stripped = stripDrugName(original, drugName)
  for (const { test, label } of SHORT_LABEL_PATTERNS) {
    if (test.test(stripped)) return label
  }

  const fallback = trimTrailingPunctuation(
    original.split(/\s+/).slice(0, 3).join(' ').slice(0, 20)
  )
  return capitalizeFirstWord(fallback || original)
}

export { SHORT_LABEL_PATTERNS }
