'use client'

import React from 'react'
import { useRouter } from 'next/navigation'

export interface StrengthOption {
  ndc: string
  slug: string
  medicine_name: string
  spl_strength: string
  price_per_unit: number
  unit: string
  is_current: boolean
}

interface StrengthSelectorProps {
  strengths: StrengthOption[]
  ingredient: string | null
}

function unitLabel(unit: string): string {
  const u = unit.toUpperCase()
  if (u === 'EA') return 'tablet'
  return unit.toLowerCase()
}

export default function StrengthSelector({ strengths, ingredient }: StrengthSelectorProps) {
  const router = useRouter()

  if (strengths.length <= 1) return null

  const label = ingredient
    ? `Other strengths of ${ingredient.charAt(0).toUpperCase()}${ingredient.slice(1)}`
    : 'Other strengths'

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 mb-3">
        💊&nbsp; {label}
      </p>
      <div className="flex flex-wrap gap-2">
        {strengths.map((s) => (
          <button
            key={s.ndc}
            onClick={() => {
              if (!s.is_current) {
                router.push(`/pill/${s.slug}/price`)
              }
            }}
            disabled={s.is_current}
            aria-current={s.is_current ? 'true' : undefined}
            className={
              s.is_current
                ? 'min-w-[120px] px-3 py-2 rounded-full text-xs font-semibold bg-sky-500 text-white border border-sky-500 cursor-default'
                : 'min-w-[120px] px-3 py-2 rounded-full text-xs font-semibold bg-white text-sky-600 border border-sky-400 hover:bg-sky-50 cursor-pointer'
            }
          >
            {s.spl_strength} · ${s.price_per_unit.toFixed(2)}/{unitLabel(s.unit)}
          </button>
        ))}
      </div>
    </div>
  )
}
