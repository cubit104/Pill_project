import Link from 'next/link'

const API_BASE = (process.env.API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '')

/**
 * Minimum total views across all pills before showing the section.
 * Override with NEXT_PUBLIC_TRENDING_MIN_VIEWS env var (e.g. set to 0 on
 * preview deployments to verify the layout without waiting for organic traffic).
 * Defaults to 50 to avoid showing a "dead" list with only a handful of views.
 */
const MIN_TOTAL_VIEWS = (() => {
  const raw = process.env.NEXT_PUBLIC_TRENDING_MIN_VIEWS
  if (raw !== undefined && raw !== '') {
    const parsed = parseInt(raw, 10)
    if (Number.isFinite(parsed) && parsed >= 0) return parsed
  }
  return 50
})()

interface TrendingPill {
  slug: string
  drug_name?: string | null
  strength?: string | null
  color?: string | null
  shape?: string | null
  view_count: number
  rank: number
}

interface TrendingResponse {
  pills?: TrendingPill[]
}

function fallbackName(slug: string) {
  return slug.replace(/-/g, ' ')
}

export default async function TrendingPills() {
  let pills: TrendingPill[] = []

  try {
    const response = await fetch(`${API_BASE}/api/trending?limit=20&days=7`, {
      next: { revalidate: 600 },
    })
    if (response.ok) {
      const payload = (await response.json()) as TrendingResponse
      pills = Array.isArray(payload.pills) ? payload.pills : []
    }
  } catch {
    return null
  }

  if (!pills.length) {
    return null
  }

  // Hide the entire section when total views are too low (looks dead)
  const totalViews = pills.reduce((sum, p) => sum + (p.view_count ?? 0), 0)
  if (totalViews < MIN_TOTAL_VIEWS) {
    return null
  }

  return (
    <section className="py-12 px-4 bg-slate-50 border-t border-slate-200">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-2xl sm:text-3xl font-bold text-center text-slate-900 mb-2">
          Trending This Week
        </h2>
        <p className="text-center text-slate-600 mb-8 max-w-2xl mx-auto">
          Real searches from PillSeek users — updated every 10 minutes
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          {pills.map((pill) => {
            const label = [pill.drug_name || fallbackName(pill.slug), pill.strength]
              .filter(Boolean)
              .join(' ')
            const attributes = [pill.color, pill.shape].filter(Boolean).join(' · ')

            return (
              <Link
                key={pill.slug}
                href={`/pill/${pill.slug}`}
                className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-emerald-200 hover:bg-emerald-50/40"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span className="text-lg font-semibold tabular-nums text-emerald-700">
                    {pill.rank}.
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-bold text-slate-900">{label}</p>
                    {attributes ? (
                      <p className="mt-0.5 text-sm text-slate-500">{attributes}</p>
                    ) : null}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </section>
  )
}
