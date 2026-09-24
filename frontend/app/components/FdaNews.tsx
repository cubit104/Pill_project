import Link from 'next/link'
import type { FdaNewsItem, FdaNewsKind } from '../lib/fda-news'
import { prettyDate } from '../lib/recalls'

/** Colors per kind, in the site's own palette: a light tint for the banner, the deeper shade for words. */
export const FDA_NEWS_LOOK: Record<FdaNewsKind, { title: string; label: string; banner: string; icon: string; heading: string; ink: string }> = {
  recall: { title: 'FDA Recall', label: 'FDA recall', banner: 'bg-red-50 border-red-200', icon: 'text-red-700', heading: 'text-red-800', ink: 'text-red-700' },
  approval: { title: 'New Drug', label: 'New drug approval', banner: 'bg-emerald-50 border-emerald-200', icon: 'text-emerald-700', heading: 'text-emerald-800', ink: 'text-emerald-700' },
  shortage: { title: 'Shortage', label: 'Drug shortage', banner: 'bg-amber-50 border-amber-200', icon: 'text-amber-700', heading: 'text-amber-800', ink: 'text-amber-700' },
}

/** Recall: a medicine bottle with an alert mark. New drug: a check. Shortage: an hourglass. */
export function FdaNewsIcon({ kind, className = '' }: { kind: FdaNewsKind; className?: string }) {
  const common = { viewBox: '0 0 64 64', fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, className, 'aria-hidden': true }
  if (kind === 'recall') {
    return (
      <svg {...common} strokeWidth={3.2}>
        <rect x="10" y="6" width="30" height="9" rx="2" />
        <path d="M13 15v39a3 3 0 0 0 3 3h13" />
        <path d="M37 15v13" />
        <path d="M13 26h14" />
        <circle cx="45" cy="45" r="13" />
        <path d="M45 38v8" />
        <circle cx="45" cy="52" r="0.6" fill="currentColor" />
      </svg>
    )
  }
  if (kind === 'approval') {
    return (
      <svg {...common} strokeWidth={4}>
        <circle cx="32" cy="32" r="25" />
        <path d="M20 33l8 8 16-17" />
      </svg>
    )
  }
  return (
    <svg {...common} strokeWidth={3.4}>
      <path d="M16 6h32M16 58h32" />
      <path d="M20 6c0 14 24 16 24 26S20 44 20 58" />
      <path d="M44 6c0 14-24 16-24 26s24 12 24 26" />
      <path d="M26 52h12" />
    </svg>
  )
}

/** The home page card: tinted banner with the kind, then the date line and the headline. */
export function FdaNewsCard({ item, className = '' }: { item: FdaNewsItem; className?: string }) {
  const look = FDA_NEWS_LOOK[item.kind]
  return (
    <Link
      href={item.href}
      className={`flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${className}`}
    >
      <div className={`flex h-[88px] items-center gap-3.5 border-b px-5 sm:h-24 ${look.banner}`}>
        <FdaNewsIcon kind={item.kind} className={`h-12 w-12 shrink-0 ${look.icon}`} />
        <div>
          <p className={`text-2xl font-extrabold leading-none tracking-tight ${look.heading}`}>{look.title}</p>
          <p className={`mt-1.5 text-[13px] font-semibold ${look.ink}`}>{item.tag}</p>
        </div>
      </div>
      <div className="flex flex-1 flex-col px-[18px] pb-4 pt-3.5">
        <p className={`text-[13px] font-semibold ${look.ink}`}>
          {look.label} · {prettyDate(item.date)}
        </p>
        <h3 className="mt-2 line-clamp-4 text-lg font-bold leading-snug text-slate-900">{item.headline}</h3>
        <span className="mt-auto pt-3 text-sm font-semibold text-emerald-700">Read more →</span>
      </div>
    </Link>
  )
}

/** One line of the /fda-news lists. */
export function FdaNewsRow({ item }: { item: FdaNewsItem }) {
  const look = FDA_NEWS_LOOK[item.kind]
  return (
    <Link
      href={item.href}
      className="flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600 sm:px-5"
    >
      <FdaNewsIcon kind={item.kind} className={`mt-0.5 h-6 w-6 shrink-0 ${look.icon}`} />
      <span className="min-w-0">
        <span className={`block text-xs font-semibold ${look.ink}`}>
          {prettyDate(item.date)} · {item.tag}
        </span>
        <span className="mt-0.5 block text-base font-semibold leading-snug text-slate-900">{item.headline}</span>
      </span>
    </Link>
  )
}
