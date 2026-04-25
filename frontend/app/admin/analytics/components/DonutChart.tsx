'use client'

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { fmtNumber } from '../lib/formatters'

const COLORS = ['#10b981', '#6366f1', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6']

interface DataItem {
  name: string
  value: number
}

interface Props {
  data: DataItem[]
  title: string
  valueLabel?: string
}

export default function DonutChart({ data, title, valueLabel = 'Sessions' }: Props) {
  const total = data.reduce((s, d) => s + d.value, 0)

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <h3 className="font-semibold text-gray-900 text-sm mb-4">{title}</h3>
      {data.length === 0 ? (
        <p className="text-center text-gray-400 text-sm py-8">No data available</p>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={80}
              dataKey="value"
              paddingAngle={3}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
              formatter={(v: any) => [
                `${fmtNumber(v)} (${total > 0 ? ((v / total) * 100).toFixed(1) : 0}%)`,
                valueLabel,
              ]}
            />
            <Legend
              formatter={(value) => <span className="text-xs text-gray-600">{value}</span>}
              iconSize={8}
            />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
