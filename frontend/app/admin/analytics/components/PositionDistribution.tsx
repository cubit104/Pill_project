'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import { fmtNumber } from '../lib/formatters'

interface DataItem {
  range: string
  count: number
}

interface Props {
  data: DataItem[]
}

const RANGE_COLORS: Record<string, string> = {
  '1-3': '#10b981',
  '4-10': '#6366f1',
  '11-20': '#f59e0b',
  '21-50': '#ef4444',
  '51-100': '#6b7280',
}

export default function PositionDistribution({ data }: Props) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <h3 className="font-semibold text-gray-900 text-sm mb-4">Position Distribution</h3>
      <p className="text-xs text-gray-400 mb-4">How many queries rank in each position bracket</p>
      {data.length === 0 ? (
        <p className="text-center text-gray-400 text-sm py-8">No data available</p>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
            <XAxis
              dataKey="range"
              tick={{ fontSize: 11, fill: '#6b7280' }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={v => fmtNumber(v)}
              width={40}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
              formatter={(v: any) => [fmtNumber(v), 'Queries']}
            />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {data.map((entry) => (
                <Cell
                  key={entry.range}
                  fill={RANGE_COLORS[entry.range] ?? '#6b7280'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
