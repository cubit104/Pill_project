import React from 'react'

export interface AlternativePrice {
  ndc: string
  name?: string
  kind?: 'brand' | 'generic' | string
  match_scope?: 'primary_ingredient_only' | string
  price_per_unit: number
  unit: string
  effective_date: string
  is_cheapest?: boolean
}

export default function AlternativesTable({
  alternatives,
  genericVsBrandRatio,
}: {
  alternatives: AlternativePrice[]
  genericVsBrandRatio?: number | null
}) {
  if (!alternatives.length) return null

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm" aria-label="NADAC alternative prices">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th scope="col" className="py-2 pr-3">Drug</th>
              <th scope="col" className="py-2 pr-3">Per-unit cost</th>
              <th scope="col" className="py-2">30-day supply</th>
            </tr>
          </thead>
          <tbody>
            {alternatives.map((row) => (
              <tr key={row.ndc} className={`border-b border-slate-100 ${row.is_cheapest ? 'bg-emerald-50/70' : ''}`}>
                <td className="py-2 pr-3">
                  <span className="capitalize text-slate-700">{row.kind || 'generic'}</span>
                  {' — '}
                  <span className="text-slate-900">{row.name || '—'}</span>
                  {row.match_scope === 'primary_ingredient_only' && (
                    <span className="ml-2 text-xs text-slate-500">ⓘ similar</span>
                  )}
                  {row.is_cheapest && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                      ← cheapest
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 font-medium text-slate-900">${row.price_per_unit.toFixed(2)} / {row.unit}</td>
                <td className="py-2 text-slate-700">${(row.price_per_unit * 30).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {genericVsBrandRatio != null && genericVsBrandRatio >= 2 && (
        <p className="mt-3 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          💡 Generic is <strong>{genericVsBrandRatio}×</strong> cheaper than the brand. Ask your doctor if the generic is appropriate for you.
        </p>
      )}
    </div>
  )
}
