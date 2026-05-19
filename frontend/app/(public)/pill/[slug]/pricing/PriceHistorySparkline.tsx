'use client'

import React, { useCallback, useRef, useState } from 'react'

export interface PriceHistoryPoint {
  effective_date: string
  price_per_unit: number
  unit?: string
}

const W = 500
const H = 160
const PAD_LEFT = 56
const PAD_RIGHT = 12
const PAD_TOP = 10
const PAD_BOTTOM = 28
const CW = W - PAD_LEFT - PAD_RIGHT
const CH = H - PAD_TOP - PAD_BOTTOM

function fmt4(n: number): string {
  return n.toFixed(4)
}

function formatMonthYear(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T12:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  } catch {
    return dateStr
  }
}

function formatFullDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T12:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return dateStr
  }
}

function ptX(i: number, n: number): number {
  return n <= 1 ? PAD_LEFT + CW / 2 : PAD_LEFT + (i / (n - 1)) * CW
}

function ptY(v: number, minV: number, maxV: number): number {
  return maxV === minV
    ? PAD_TOP + CH / 2
    : PAD_TOP + CH - ((v - minV) / (maxV - minV)) * CH
}

export default function PriceHistorySparkline({ history }: { history: PriceHistoryPoint[] }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  if (!history.length) return null

  const n = history.length
  const values = history.map((h) => h.price_per_unit)
  const minVal = Math.min(...values)
  const maxVal = Math.max(...values)
  const unit = history[n - 1]?.unit ?? 'unit'

  const linePoints = history
    .map((h, i) => `${ptX(i, n).toFixed(2)},${ptY(h.price_per_unit, minVal, maxVal).toFixed(2)}`)
    .join(' ')

  const areaPath = [
    `M ${PAD_LEFT},${PAD_TOP + CH}`,
    ...history.map((h, i) => `L ${ptX(i, n).toFixed(2)},${ptY(h.price_per_unit, minVal, maxVal).toFixed(2)}`),
    `L ${PAD_LEFT + CW},${PAD_TOP + CH}`,
    'Z',
  ].join(' ')

  const gridYs = [0, 0.5, 1].map((t) => ptY(minVal + t * (maxVal - minVal), minVal, maxVal))

  const firstPrice = history[0].price_per_unit
  const lastPrice = history[n - 1].price_per_unit
  const pctChange = firstPrice !== 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0

  let trendBadge: React.ReactNode
  if (Math.abs(pctChange) < 0.05) {
    trendBadge = <span className="text-slate-500">→ Stable</span>
  } else if (pctChange > 0) {
    trendBadge = (
      <span className="text-red-600">
        ▲ +{pctChange.toFixed(1)}% since {formatMonthYear(history[0].effective_date)}
      </span>
    )
  } else {
    trendBadge = (
      <span className="text-emerald-600">
        ▼ {pctChange.toFixed(1)}% since {formatMonthYear(history[0].effective_date)}
      </span>
    )
  }

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current) return
      const rect = svgRef.current.getBoundingClientRect()
      const scaleX = W / rect.width
      const mouseX = (e.clientX - rect.left) * scaleX
      let nearest = 0
      let nearestDist = Infinity
      for (let i = 0; i < n; i++) {
        const dist = Math.abs(ptX(i, n) - mouseX)
        if (dist < nearestDist) {
          nearestDist = dist
          nearest = i
        }
      }
      setHoveredIdx(nearest)
    },
    [n],
  )

  const handleMouseLeave = useCallback(() => setHoveredIdx(null), [])

  let tooltipEl: React.ReactNode = null
  if (hoveredIdx !== null) {
    const h = history[hoveredIdx]
    const tx = ptX(hoveredIdx, n)
    const ty = ptY(h.price_per_unit, minVal, maxVal)
    const tw = 164
    const th = 44
    let tooltipX = tx - tw / 2
    if (tooltipX < PAD_LEFT) tooltipX = PAD_LEFT
    if (tooltipX + tw > W - PAD_RIGHT) tooltipX = W - PAD_RIGHT - tw
    const tooltipY = ty - th - 8 < PAD_TOP ? ty + 8 : ty - th - 8
    tooltipEl = (
      <g>
        <line
          x1={tx} y1={PAD_TOP} x2={tx} y2={PAD_TOP + CH}
          stroke="#94a3b8" strokeWidth={1} strokeDasharray="3 2"
        />
        <rect
          x={tooltipX} y={tooltipY} width={tw} height={th}
          rx={5} ry={5} fill="white" stroke="#e2e8f0" strokeWidth={1}
        />
        <text
          x={tooltipX + 8} y={tooltipY + 15}
          fontSize={9} fill="#64748b" fontFamily="sans-serif"
        >
          {formatFullDate(h.effective_date)}
        </text>
        <text
          x={tooltipX + 8} y={tooltipY + 33}
          fontSize={11} fontWeight="600" fill="#0f172a" fontFamily="sans-serif"
        >
          ${fmt4(h.price_per_unit)}/{h.unit ?? unit}
        </text>
      </g>
    )
  }

  return (
    <div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="NADAC weekly price history"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Y gridlines */}
        {gridYs.map((gy, i) => (
          <line
            key={i}
            x1={PAD_LEFT} y1={gy} x2={PAD_LEFT + CW} y2={gy}
            stroke="#cbd5e1" strokeWidth={0.5} strokeDasharray="4 3"
          />
        ))}

        {/* Area fill */}
        <path d={areaPath} fill="rgba(14,165,233,0.10)" />

        {/* Line */}
        <polyline fill="none" stroke="#0ea5e9" strokeWidth={2} points={linePoints} />

        {/* Data points */}
        {history.map((h, i) => (
          <circle
            key={i}
            cx={ptX(i, n)}
            cy={ptY(h.price_per_unit, minVal, maxVal)}
            r={hoveredIdx === i ? 5 : 3}
            fill={hoveredIdx === i ? '#0284c7' : '#0ea5e9'}
            stroke="white"
            strokeWidth={1.5}
          />
        ))}

        {/* Y-axis labels */}
        <text
          x={PAD_LEFT - 4}
          y={ptY(maxVal, minVal, maxVal) + 4}
          textAnchor="end" fontSize={8} fill="#64748b" fontFamily="sans-serif"
        >
          ${fmt4(maxVal)}/{unit}
        </text>
        <text
          x={PAD_LEFT - 4}
          y={ptY(minVal, minVal, maxVal) + 4}
          textAnchor="end" fontSize={8} fill="#64748b" fontFamily="sans-serif"
        >
          ${fmt4(minVal)}/{unit}
        </text>

        {/* X-axis labels */}
        <text
          x={PAD_LEFT} y={H - 6}
          textAnchor="start" fontSize={8} fill="#64748b" fontFamily="sans-serif"
        >
          {formatMonthYear(history[0].effective_date)}
        </text>
        <text
          x={PAD_LEFT + CW} y={H - 6}
          textAnchor="end" fontSize={8} fill="#64748b" fontFamily="sans-serif"
        >
          {formatMonthYear(history[n - 1].effective_date)}
        </text>

        {/* Hover tooltip */}
        {tooltipEl}
      </svg>

      {/* Trend badge */}
      <p className="text-xs mt-1">{trendBadge}</p>
    </div>
  )
}
