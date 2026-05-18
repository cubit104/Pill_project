import React from 'react'

export interface PriceHistoryPoint {
  effective_date: string
  price_per_unit: number
}

const SPARKLINE_WIDTH = 420
const SPARKLINE_HEIGHT = 90

function toPoints(values: number[], width: number, height: number): string {
  if (values.length === 0) return ''
  const max = Math.max(...values)
  const min = Math.min(...values)
  const xStep = values.length > 1 ? width / (values.length - 1) : width
  const scale = max === min ? 1 : (height - 8) / (max - min)
  return values
    .map((value, index) => {
      const x = index * xStep
      const y = height - 4 - ((value - min) * scale)
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}

export default function PriceHistorySparkline({ history }: { history: PriceHistoryPoint[] }) {
  if (!history.length) return null
  const values = history.map((h) => h.price_per_unit)
  const points = toPoints(values, SPARKLINE_WIDTH, SPARKLINE_HEIGHT)

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6" aria-label="Price history">
      <h3 className="text-base font-semibold text-slate-900 mb-2">Price history (last {history.length} weeks)</h3>
      <svg
        viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
        className="w-full h-24"
        role="img"
        aria-label="NADAC weekly price history"
      >
        <polyline fill="none" stroke="currentColor" strokeWidth="2.5" className="text-sky-600" points={points} />
      </svg>
      <p className="text-xs text-slate-500 mt-2">
        {history[0]?.effective_date} → {history[history.length - 1]?.effective_date}
      </p>
    </section>
  )
}
