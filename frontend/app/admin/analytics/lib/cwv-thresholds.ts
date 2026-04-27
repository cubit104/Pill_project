/** Core Web Vitals thresholds — green / orange / red */

export interface CWVThreshold {
  good: number
  needs_improvement: number
  unit: string
  label: string
  higherIsBetter?: boolean
}

export const CWV_THRESHOLDS: Record<string, CWVThreshold> = {
  lcp: { good: 2500, needs_improvement: 4000, unit: 'ms', label: 'LCP' },
  cls: { good: 0.1, needs_improvement: 0.25, unit: '', label: 'CLS' },
  fcp: { good: 1800, needs_improvement: 3000, unit: 'ms', label: 'FCP' },
  ttfb: { good: 800, needs_improvement: 1800, unit: 'ms', label: 'TTFB' },
  tbt: { good: 200, needs_improvement: 600, unit: 'ms', label: 'TBT' },
  inp: { good: 200, needs_improvement: 500, unit: 'ms', label: 'INP' },
}

export type CWVRating = 'good' | 'needs-improvement' | 'poor'

export function getCWVRating(metric: string, value: number | null): CWVRating {
  if (value == null) return 'poor'
  const t = CWV_THRESHOLDS[metric]
  if (!t) return 'poor'
  if (value <= t.good) return 'good'
  if (value <= t.needs_improvement) return 'needs-improvement'
  return 'poor'
}

export function getCWVColor(rating: CWVRating): string {
  switch (rating) {
    case 'good': return 'text-emerald-600'
    case 'needs-improvement': return 'text-amber-500'
    case 'poor': return 'text-red-500'
  }
}

export function getCWVBg(rating: CWVRating): string {
  switch (rating) {
    case 'good': return 'bg-emerald-50 text-emerald-700 border-emerald-200'
    case 'needs-improvement': return 'bg-amber-50 text-amber-700 border-amber-200'
    case 'poor': return 'bg-red-50 text-red-700 border-red-200'
  }
}
