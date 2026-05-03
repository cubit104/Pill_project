import Link from 'next/link'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'

interface ConditionListItem {
  slug: string
  title: string
  tag: string
}

async function fetchAllConditions(): Promise<ConditionListItem[]> {
  try {
    const res = await fetch(`${API_BASE}/api/conditions`, { next: { revalidate: 86400 } })
    if (!res.ok) return []
    const data = await res.json()
    return data.conditions ?? []
  } catch {
    return []
  }
}

export default async function ConditionNotFound() {
  const conditions = await fetchAllConditions()

  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold text-slate-900 mb-3">Condition not found</h1>
      <p className="text-slate-600 mb-8">
        We don&apos;t have a page for that condition yet. Here are the conditions we currently cover:
      </p>

      {conditions.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {conditions.map((cond) => (
            <Link
              key={cond.slug}
              href={`/condition/${cond.slug}`}
              className="block p-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 font-medium hover:border-emerald-300 hover:bg-emerald-50 transition-colors"
            >
              {cond.title.replace(/^Medications for\s+/i, '')}
            </Link>
          ))}
        </div>
      ) : (
        <p className="text-slate-500">Unable to load condition list right now. Please try again later.</p>
      )}

      <div className="mt-10">
        <Link href="/" className="text-sky-700 hover:underline text-sm">
          ← Back to home
        </Link>
      </div>
    </div>
  )
}
