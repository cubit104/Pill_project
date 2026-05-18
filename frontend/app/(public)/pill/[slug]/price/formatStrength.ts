export function formatStrength(rawStrength: string | null): string {
  if (!rawStrength?.trim()) return ''
  const parts = rawStrength
    .split(';')
    .map((part) => part.trim().replace(/[;,]+$/g, '').trim())
    .filter(Boolean)

  if (!parts.length) return ''
  if (parts.length === 1) return parts[0]
  return `${parts[0]} + others`
}
