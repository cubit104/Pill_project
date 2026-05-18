import React from 'react'

export interface AlternativePrice {
  ndc: string
  name?: string
  kind?: 'brand' | 'generic' | string
  price_per_unit: number
  unit: string
  effective_date: string
}

export default function AlternativesTable({ alternatives }: { alternatives: AlternativePrice[] }) {
  if (!alternatives.length) return null

  const sorted = [...alternatives].sort((a, b) => a.price_per_unit - b.price_per_unit)
  const cheapest = sorted[0]
  const brands = sorted.filter((row) => row.kind === 'brand')
  const generics = sorted.filter((row) => row.kind !== 'brand')
  const brand = brands[0]
  const generic = generics[0]
  const savingsMultiple = brand && generic && generic.price_per_unit > 0
    ? (brand.price_per_unit / generic.price_per_unit).toFixed(1)
    : null

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6" aria-label="Compare alternatives">
      <h3 className="text-base font-semibold text-slate-900 mb-3">Compare alternatives</h3>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm" aria-label="NADAC alternative prices">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th scope="col" className="py-2 pr-3">Type</th>
              <th scope="col" className="py-2 pr-3">Product</th>
              <th scope="col" className="py-2 pr-3">NDC</th>
              <th scope="col" className="py-2 pr-3">Price / unit</th>
              <th scope="col" className="py-2">Effective</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const isCheapest = row.ndc === cheapest.ndc
              return (
                <tr key={row.ndc} className={`border-b border-slate-100 ${isCheapest ? 'bg-emerald-50/70' : ''}`}>
                  <td className="py-2 pr-3 capitalize">{row.kind || 'generic'}</td>
                  <td className="py-2 pr-3">{row.name || '—'}</td>
                  <td className="py-2 pr-3 font-mono text-xs text-slate-700">{row.ndc}</td>
                  <td className="py-2 pr-3 font-medium text-slate-900">${row.price_per_unit.toFixed(2)} / {row.unit}</td>
                  <td className="py-2 text-slate-600">{row.effective_date}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {savingsMultiple && (
        <p className="mt-3 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          Generic is {savingsMultiple}x cheaper than the brand. Ask your doctor if the generic is appropriate.
        </p>
      )}
    </section>
  )
}
