import { useEffect, useState } from 'react'

const HINTS = [
  'Reading the imprint…',
  'Matching against 14,000 pills…',
  'Checking colour and shape…',
  'Ranking the closest matches…',
  'Almost there…',
]

interface Props {
  /** Expected duration used to pace the ring (never reaches 100% on its own). */
  expectedSeconds?: number
  active: boolean
}

/** Animated ring + rotating hint for the identification wait. */
export default function ProgressRing({ expectedSeconds = 8, active }: Props) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!active) return
    setElapsed(0)
    const started = Date.now()
    const id = window.setInterval(() => setElapsed((Date.now() - started) / 1000), 200)
    return () => window.clearInterval(id)
  }, [active])

  // Ease toward 92% over expectedSeconds, then creep.
  const t = Math.min(1, elapsed / expectedSeconds)
  const eased = 1 - Math.pow(1 - t, 2)
  const pct = Math.min(0.97, 0.92 * eased + 0.05 * Math.min(1, Math.max(0, elapsed - expectedSeconds) / 20))
  const hint = HINTS[Math.min(HINTS.length - 1, Math.floor(elapsed / 2.2))] ?? HINTS[0]

  const size = 96
  const stroke = 8
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r

  return (
    <div className="flex flex-col items-center gap-4 py-4" role="status" aria-live="polite">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
          <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--border)" strokeWidth={stroke} fill="none" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke="var(--brand)"
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: 'stroke-dashoffset 220ms ease-out' }}
          />
        </svg>
        <span className="tabular absolute inset-0 flex items-center justify-center text-[17px] font-bold text-ink">
          {Math.round(pct * 100)}%
        </span>
      </div>
      <div className="text-center">
        <p className="text-[17px] font-semibold text-ink">{hint}</p>
        <p className="tabular mt-1 text-[14px] text-muted">
          Usually takes about {expectedSeconds} seconds · {Math.floor(elapsed)}s
        </p>
      </div>
    </div>
  )
}
