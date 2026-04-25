'use client'

import { getCWVRating, getCWVBg, getCWVColor, CWV_THRESHOLDS } from '../lib/cwv-thresholds'
import { fmtMs } from '../lib/formatters'

function displayValue(metric: string, value: number | null): string {
  if (value == null) return '—'
  const t = CWV_THRESHOLDS[metric]
  if (!t) return String(value)
  if (t.unit === 'ms') return fmtMs(value)
  return value.toFixed(3)
}

interface Props {
  url: string
  strategy: 'mobile' | 'desktop'
  scores: Record<string, number>
  metrics: Record<string, number | null>
}

const METRIC_KEYS = ['lcp', 'cls', 'fcp', 'ttfb', 'inp', 'tbt']

export default function CoreWebVitalsCard({ url, strategy, scores, metrics }: Props) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-emerald-700 hover:underline truncate block max-w-[300px]">
            {url}
          </a>
          <span className={`text-xs px-2 py-0.5 rounded-full border mt-1 inline-block font-medium ${strategy === 'mobile' ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-gray-50 text-gray-600 border-gray-200'}`}>
            {strategy}
          </span>
        </div>
        <div className="flex gap-2">
          {Object.entries(scores).map(([k, v]) => (
            <div key={k} className="text-center">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
                v >= 90 ? 'border-emerald-400 text-emerald-700 bg-emerald-50'
                : v >= 50 ? 'border-amber-400 text-amber-700 bg-amber-50'
                : 'border-red-400 text-red-700 bg-red-50'
              }`}>
                {Math.round(v)}
              </div>
              <div className="text-[10px] text-gray-400 mt-0.5 capitalize">{k.replace('_', ' ')}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {METRIC_KEYS.map(key => {
          const val = metrics[key] ?? null
          const rating = getCWVRating(key, val)
          const bg = getCWVBg(rating)
          const t = CWV_THRESHOLDS[key]
          return (
            <div key={key} className={`rounded-lg border px-3 py-2 text-center ${bg}`}>
              <div className="text-xs font-semibold uppercase tracking-wide opacity-70">{t?.label || key.toUpperCase()}</div>
              <div className="text-base font-bold mt-0.5">{displayValue(key, val)}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
