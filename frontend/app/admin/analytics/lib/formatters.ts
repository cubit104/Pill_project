/** Utility formatters for the analytics dashboard */

export function fmtNumber(n: number | null | undefined, decimals = 0): string {
  if (n == null || isNaN(n)) return '—'
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export function fmtPercent(n: number | null | undefined, decimals = 1): string {
  if (n == null || isNaN(n)) return '—'
  return `${(n * 100).toFixed(decimals)}%`
}

export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null || isNaN(seconds)) return '—'
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

export function fmtMs(ms: number | null | undefined): string {
  if (ms == null || isNaN(ms)) return '—'
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`
  return `${Math.round(ms)}ms`
}

export function fmtDate(dateStr: string): string {
  if (!dateStr || dateStr.length !== 8) return dateStr
  const y = dateStr.slice(0, 4)
  const m = dateStr.slice(4, 6)
  const d = dateStr.slice(6, 8)
  const date = new Date(`${y}-${m}-${d}`)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function fmtPosition(pos: number | null | undefined): string {
  if (pos == null || isNaN(pos)) return '—'
  return pos.toFixed(1)
}
