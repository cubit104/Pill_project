'use client'

import type { RangeOption } from '../hooks/useAnalytics'

interface Props {
  value: RangeOption
  onChange: (v: RangeOption) => void
}

const OPTIONS: { value: RangeOption; label: string }[] = [
  { value: '1d', label: '24h' },
  { value: '7d', label: 'Last 7 days' },
  { value: '28d', label: 'Last 28 days' },
  { value: '90d', label: 'Last 90 days' },
]

export default function DateRangePicker({ value, onChange }: Props) {
  return (
    <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
      {OPTIONS.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
            value === opt.value
              ? 'bg-white shadow text-gray-900'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
