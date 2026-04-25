'use client'

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { useState } from 'react'
import { fmtDate, fmtNumber } from '../lib/formatters'

interface TrafficPoint {
  date: string
  users: number
  sessions: number
  pageviews: number
}

type Metric = 'pageviews' | 'users' | 'sessions'

const METRICS: { key: Metric; label: string; color: string }[] = [
  { key: 'pageviews', label: 'Pageviews', color: '#10b981' },
  { key: 'users', label: 'Users', color: '#6366f1' },
  { key: 'sessions', label: 'Sessions', color: '#f59e0b' },
]

interface Props {
  data: TrafficPoint[]
}

export default function TrafficChart({ data }: Props) {
  const [active, setActive] = useState<Metric>('pageviews')
  const metric = METRICS.find(m => m.key === active)!

  const formatted = data.map(d => ({ ...d, _date: fmtDate(d.date) }))

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3 className="font-semibold text-gray-900 text-sm">Traffic Over Time</h3>
        <div className="flex gap-1.5">
          {METRICS.map(m => (
            <button
              key={m.key}
              onClick={() => setActive(m.key)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                active === m.key
                  ? 'bg-emerald-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={formatted} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={metric.color} stopOpacity={0.2} />
              <stop offset="95%" stopColor={metric.color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
          <XAxis
            dataKey="_date"
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => fmtNumber(v)}
            width={45}
          />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
            formatter={(v: any) => [fmtNumber(v), metric.label]}
            labelFormatter={l => l}
          />
          <Area
            type="monotone"
            dataKey={active}
            stroke={metric.color}
            strokeWidth={2}
            fill="url(#tg)"
            dot={false}
            activeDot={{ r: 4 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
