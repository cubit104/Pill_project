'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { fmtNumber } from '../lib/formatters'

interface DataItem {
  label: string
  value: number
}

interface Props {
  data: DataItem[]
  title: string
  color?: string
  valueLabel?: string
}

export default function SimpleBarChart({
  data,
  title,
  color = '#10b981',
  valueLabel = 'Value',
}: Props) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <h3 className="font-semibold text-gray-900 text-sm mb-4">{title}</h3>
      {data.length === 0 ? (
        <p className="text-center text-gray-400 text-sm py-8">No data available</p>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 0, right: 16, bottom: 0, left: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={v => fmtNumber(v)}
            />
            <YAxis
              type="category"
              dataKey="label"
              tick={{ fontSize: 10, fill: '#6b7280' }}
              tickLine={false}
              axisLine={false}
              width={80}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
              formatter={(v: any) => [fmtNumber(v), valueLabel]}
            />
            <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
