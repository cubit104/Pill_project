import Link from 'next/link'
import type { ReactNode } from 'react'
import { FDA_NEWS_LOOK, FdaNewsIcon } from '../../components/FdaNews'
import type { ArticleBlock } from '../../lib/fda-announcements'
import type { FdaNewsKind } from '../../lib/fda-news'
import type { PillSeekLink } from '../../lib/pillseek-links'
import { newsArticleSchema, safeJsonLd } from '../../lib/structured-data'
import { prettyDate } from '../../lib/recalls'

/** Shared parts of the three FDA news pages (recall, new drug, shortage). */

export function DetailHeader({ kind, headline, date, tag }: { kind: FdaNewsKind; headline: string; date: string; tag: string }) {
  const look = FDA_NEWS_LOOK[kind]
  return (
    <div className={`border-b ${look.banner}`}>
      <div className="mx-auto max-w-4xl px-4 pb-8 pt-6 sm:pt-8">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/" className="hover:text-emerald-700">Home</Link>
          <span className="mx-1.5 text-slate-400">›</span>
          <Link href="/fda-news" className="hover:text-emerald-700">FDA news</Link>
          <span className="mx-1.5 text-slate-400">›</span>
          <span className="text-slate-800">{look.label}</span>
        </nav>
        <div className="mt-5 flex items-center gap-3">
          <FdaNewsIcon kind={kind} className={`h-10 w-10 shrink-0 ${look.icon}`} />
          <div>
            <p className={`text-xl font-extrabold leading-none tracking-tight ${look.heading}`}>{look.title}</p>
            <p className={`mt-1 text-sm font-semibold ${look.ink}`}>
              {tag}
              {date && ` · ${prettyDate(date)}`}
            </p>
          </div>
        </div>
        <h1 className="mt-4 text-2xl font-bold leading-tight tracking-tight text-slate-900 sm:text-3xl">{headline}</h1>
      </div>
    </div>
  )
}

export function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  const shown = rows.filter(([, value]) => value !== '' && value !== null && value !== undefined)
  return (
    <dl className="grid gap-x-6 gap-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2">
      {shown.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
          <dd className="mt-1 break-words text-sm leading-relaxed text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-xl font-bold tracking-tight text-slate-900">{title}</h2>
      <div className="mt-3 text-base leading-relaxed text-slate-700">{children}</div>
    </section>
  )
}

export function WhatToDo({ children }: { children: ReactNode }) {
  return (
    <section className="mt-8 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
      <h2 className="text-lg font-bold text-emerald-900">What to do</h2>
      <div className="mt-2 text-sm leading-relaxed text-emerald-950">{children}</div>
    </section>
  )
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold text-emerald-700 hover:text-emerald-800">
      {children} ↗
    </a>
  )
}

export function SourceNote({ children }: { children: ReactNode }) {
  return (
    <p className="mb-16 mt-8 border-t border-slate-200 pt-5 text-xs leading-relaxed text-slate-500">
      {children} Informational only and not medical advice; confirm with your pharmacist or prescriber.
    </p>
  )
}

/** The FDA's article as it wrote it (announcements are public domain): its headings and paragraphs. */
export function ArticleText({ blocks }: { blocks: ArticleBlock[] }) {
  return (
    <div className="space-y-3">
      {blocks.map((b, i) =>
        b.kind === 'heading' ? (
          <h3 key={i} className="pt-2 text-base font-bold text-slate-900">
            {b.text}
          </h3>
        ) : (
          <p key={i}>{b.text}</p>
        ),
      )}
    </div>
  )
}

/** PillSeek's own pages for the medicine on this FDA news page: its pills and its IV guide. */
export function PillSeekLinks({ links }: { links: PillSeekLink[] }) {
  if (links.length === 0) return null
  return (
    <section className="mt-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold text-slate-900">On PillSeek</h2>
      <ul className="mt-2 space-y-1.5 text-sm">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="font-semibold text-emerald-700 hover:text-emerald-800">
              {l.label} →
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The page as a news article for search engines (see newsArticleSchema). */
export function NewsJsonLd(props: { headline: string; path: string; date: string; description: string; source: string }) {
  if (!props.date) return null
  const schema = newsArticleSchema({ headline: props.headline, path: props.path, datePublished: props.date, description: props.description, source: props.source })
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(schema) }} />
}
