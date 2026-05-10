'use client'

type GuideResponse = {
  source_url?: string | null
  fetched_at?: string | null
}

export default function MedguideMetaBar({ guide }: { guide: GuideResponse | null }) {
  const formattedDate = guide?.fetched_at
    ? new Date(guide.fetched_at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null

  if (!formattedDate && !guide?.source_url) return null

  return (
    <div className="no-print flex flex-wrap gap-2 text-xs text-slate-500">
      {formattedDate && (
        <span className="inline-flex items-center gap-1 border border-slate-200 rounded-full px-3 py-1 bg-white">
          📅 Last updated · {formattedDate}
        </span>
      )}
      {guide?.source_url && (
        <a
          href={guide.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 border border-slate-200 rounded-full px-3 py-1 bg-white hover:border-slate-400 transition-colors"
        >
          🏛 Source: DailyMed ↗
        </a>
      )}
      <button
        onClick={() => window.print()}
        className="inline-flex items-center gap-1 border border-slate-200 rounded-full px-3 py-1 bg-white hover:border-slate-400 transition-colors cursor-pointer"
      >
        🖨 Print
      </button>
    </div>
  )
}
