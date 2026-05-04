import Link from 'next/link'
import { POPULAR_MEDICATIONS, type PopularMed } from '../lib/popular-medications'

function groupByCategory(meds: PopularMed[]) {
  return meds.reduce<Record<string, PopularMed[]>>((acc, med) => {
    if (!acc[med.category]) acc[med.category] = []
    acc[med.category].push(med)
    return acc
  }, {})
}

export default function PopularMedications() {
  const grouped = groupByCategory(POPULAR_MEDICATIONS)

  return (
    <section className="py-12 px-4 bg-slate-50 border-t border-slate-200">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-2xl sm:text-3xl font-bold text-center text-slate-900 mb-2">
          Popular Medications
        </h2>
        <p className="text-center text-slate-600 mb-8 max-w-2xl mx-auto">
          Quick access to the most commonly identified pills in our database.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {Object.entries(grouped).map(([category, meds]) => (
            <div key={category} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <h3 className="font-semibold text-emerald-700 text-sm uppercase tracking-wide mb-3">
                {category}
              </h3>
              <ul className="space-y-0.5">
                {meds.map((m) => (
                  <li key={m.slug}>
                    <Link
                      href={`/drug/${m.slug}`}
                      className="block text-slate-700 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg px-2 py-1 text-sm transition-colors -mx-2"
                    >
                      {m.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
