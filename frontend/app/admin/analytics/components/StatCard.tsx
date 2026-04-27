'use client'

import { ReactNode } from 'react'
import { motion } from 'framer-motion'
import CountUp from 'react-countup'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface StatCardProps {
  label: string
  value: number | null
  format?: 'number' | 'percent' | 'position'
  decimals?: number
  trend?: number | null
  icon?: ReactNode
  colorClass?: string
  delay?: number
  children?: ReactNode
}

function formatValue(val: number | null, format: string, decimals: number): string {
  if (val == null) return '—'
  if (format === 'percent') return `${(val * 100).toFixed(decimals)}%`
  if (format === 'position') return val.toFixed(1)
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`
  return val.toLocaleString('en-US', { maximumFractionDigits: decimals })
}

export default function StatCard({
  label,
  value,
  format = 'number',
  decimals = 0,
  trend,
  icon,
  colorClass = 'from-white to-slate-50',
  delay = 0,
  children,
}: StatCardProps) {
  const trendPos = trend != null && trend > 0
  const trendNeg = trend != null && trend < 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
      className={`relative rounded-xl border border-gray-100 bg-gradient-to-br ${colorClass} shadow-sm p-5 hover:shadow-md transition-shadow overflow-hidden`}
    >
      {/* Subtle top gradient line */}
      <div className="absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-t-xl" />

      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
        {icon && <div className="text-gray-400">{icon}</div>}
      </div>

      <div className="text-3xl font-extrabold text-gray-900 tabular-nums leading-none">
        {value == null ? (
          <span className="text-gray-400 text-2xl">—</span>
        ) : (
          <CountUp
            end={format === 'percent' ? value * 100 : value}
            duration={1.2}
            delay={delay}
            decimals={format === 'percent' || format === 'position' ? (decimals || 1) : decimals}
            separator=","
            suffix={format === 'percent' ? '%' : ''}
          />
        )}
      </div>

      {trend != null && (
        <div className={`flex items-center gap-1 mt-1.5 text-xs font-medium ${trendPos ? 'text-emerald-600' : trendNeg ? 'text-red-500' : 'text-gray-400'}`}>
          {trendPos ? <TrendingUp className="w-3 h-3" /> : trendNeg ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
          {trendPos && '+'}
          {(trend * 100).toFixed(1)}% vs prev period
        </div>
      )}

      {children && <div className="mt-3">{children}</div>}
    </motion.div>
  )
}
