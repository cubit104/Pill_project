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
    <div className="no-print flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
      {formattedDate && <span>Last updated · {formattedDate}</span>}
      {guide?.source_url && (
        <>
          {formattedDate && <span aria-hidden="true">·</span>}
          <a
            href={guide.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sky-700 hover:underline"
          >
            Source: DailyMed ↗
          </a>
        </>
      )}
      {(formattedDate || guide?.source_url) && <span aria-hidden="true">·</span>}
      <button
        onClick={() => window.print()}
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 transition-colors cursor-pointer"
      >
        Print
      </button>
    </div>
  )
}
