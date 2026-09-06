import { useId, useMemo, useState } from 'react'
import { money, shortDate } from '../lib/format'
import type { PricePoint } from '../lib/api'

const W = 320
const H = 96
const PAD_X = 6
const PAD_TOP = 14
const PAD_BOTTOM = 22

interface Geo {
  xs: number[]
  ys: number[]
  line: string
  area: string
  minIdx: number
  maxIdx: number
  baseline: number
}

function layout(points: PricePoint[]): Geo {
  const vals = points.map((p) => p.price_per_unit)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const span = max - min || max || 1
  const plotW = W - PAD_X * 2
  const plotH = H - PAD_TOP - PAD_BOTTOM
  const baseline = PAD_TOP + plotH
  const xs = points.map((_, i) => PAD_X + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW))
  const ys = vals.map((v) => baseline - ((v - min) / span) * plotH)
  const pairs = xs.map((x, i) => `${x.toFixed(1)},${(ys[i] ?? baseline).toFixed(1)}`)
  const line = pairs.join(' ')
  const x0 = (xs[0] ?? PAD_X).toFixed(1)
  const xN = (xs[xs.length - 1] ?? PAD_X).toFixed(1)
  const area = `M${x0},${baseline.toFixed(1)} L${pairs.join(' L')} L${xN},${baseline.toFixed(1)} Z`
  return { xs, ys, line, area, minIdx: vals.indexOf(min), maxIdx: vals.indexOf(max), baseline }
}

/**
 * Single-series sparkline of pharmacy cost over time. One hue (brand), 2px
 * line, min/max direct labels, and a touch/hover crosshair with a tooltip.
 */
export default function PriceSparkline({ points, className = '' }: { points: PricePoint[]; className?: string }) {
  const id = useId()
  const [active, setActive] = useState<number | null>(null)
  const geo = useMemo(() => layout(points), [points])

  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) return null

  const pick = (clientX: number, el: SVGSVGElement) => {
    const rect = el.getBoundingClientRect()
    const x = ((clientX - rect.left) / rect.width) * W
    let best = 0
    geo.xs.forEach((gx, i) => {
      if (Math.abs(gx - x) < Math.abs((geo.xs[best] ?? 0) - x)) best = i
    })
    setActive(best)
  }

  const tip = active !== null ? points[active] : undefined
  const tipX = active !== null ? (geo.xs[active] ?? 0) : 0
  const tipY = active !== null ? (geo.ys[active] ?? geo.baseline) : 0
  const tipLeft = tipX > W * 0.6
  const maxPt = points[geo.maxIdx]
  const maxX = Math.min(Math.max(geo.xs[geo.maxIdx] ?? 0, 28), W - 28)

  return (
    <div className={`relative ${className}`}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-24 w-full touch-pan-y select-none"
        role="img"
        aria-labelledby={`${id}-title`}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
        onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
        onPointerLeave={() => setActive(null)}
      >
        <title id={`${id}-title`}>
          Pharmacy cost from {shortDate(first.effective_date)} to {shortDate(last.effective_date)}, {money(first.price_per_unit)} to {money(last.price_per_unit)}
        </title>
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--brand)" stopOpacity="0.22" />
            <stop offset="1" stopColor="var(--brand)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={PAD_X} x2={W - PAD_X} y1={geo.baseline} y2={geo.baseline} stroke="var(--border)" strokeWidth="1" />
        <path d={geo.area} fill={`url(#${id}-fill)`} />
        <polyline points={geo.line} fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {/* min / max markers with a surface ring */}
        {[geo.minIdx, geo.maxIdx].map((i) => (
          <circle key={i} cx={geo.xs[i] ?? 0} cy={geo.ys[i] ?? geo.baseline} r="4" fill="var(--brand)" stroke="var(--surface)" strokeWidth="2" />
        ))}
        {geo.maxIdx !== geo.minIdx && maxPt && (
          <text x={maxX} y={PAD_TOP - 4} textAnchor="middle" fontSize="11" fill="var(--muted)">
            {money(maxPt.price_per_unit)}
          </text>
        )}
        <text x={PAD_X} y={H - 6} fontSize="11" fill="var(--muted)">
          {shortDate(first.effective_date)}
        </text>
        <text x={W - PAD_X} y={H - 6} fontSize="11" fill="var(--muted)" textAnchor="end">
          {shortDate(last.effective_date)}
        </text>
        {tip && (
          <>
            <line x1={tipX} x2={tipX} y1={PAD_TOP - 2} y2={geo.baseline} stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={tipX} cy={tipY} r="5" fill="var(--brand)" stroke="var(--surface)" strokeWidth="2" />
          </>
        )}
      </svg>
      {tip && (
        <div
          className="card pointer-events-none absolute top-0 px-2.5 py-1.5 text-[12px] leading-tight"
          style={tipLeft ? { right: `${100 - (tipX / W) * 100 + 2}%` } : { left: `${(tipX / W) * 100 + 2}%` }}
          role="status"
        >
          <p className="tabular font-semibold text-ink">{money(tip.price_per_unit)}</p>
          <p className="text-muted">{shortDate(tip.effective_date)}</p>
        </div>
      )}
    </div>
  )
}
