'use client'

import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { fmtPercent } from '../lib/formatters'

interface DataPoint {
  position: number
  ctr: number
  clicks: number
}

interface Props {
  data: DataPoint[]
}

export default function CtrScatterPlot({ data }: Props) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <h3 className="font-semibold text-gray-900 text-sm mb-4">CTR vs Position</h3>
      {data.length === 0 ? (
        <p className="text-center text-gray-400 text-sm py-8">No data available</p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <ScatterChart margin={{ top: 4, right: 8, bottom: 16, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis
              dataKey="position"
              name="Position"
              type="number"
              reversed
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              tickLine={false}
              axisLine={false}
              label={{ value: 'Avg Position', position: 'insideBottom', offset: -10, fontSize: 10, fill: '#9ca3af' }}
            />
            <YAxis
              dataKey="ctr"
              name="CTR"
              type="number"
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={v => fmtPercent(v, 0)}
              width={40}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
              formatter={(v: any, name: any) => {
                if (name === 'CTR') return [fmtPercent(v), 'CTR']
                if (name === 'Position') return [Number(v).toFixed(1), 'Position']
                return [v, name]
              }}
            />
            <Scatter
              data={data}
              fill="#10b981"
              opacity={0.7}
              name="Query"
            />
          </ScatterChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
