import type { Metadata } from 'next'
import Link from 'next/link'
import { FDA_NEWS_LOOK, FdaNewsIcon, FdaNewsRow } from '../../components/FdaNews'
import { FDA_NOVEL_APPROVALS_PAGE, approvalNews, recallNews, shortageNews, type FdaNewsItem, type FdaNewsKind } from '../../lib/fda-news'
import { FDA_SHORTAGE_PAGE } from '../../lib/shortages'
import { breadcrumbSchema, safeJsonLd } from '../../lib/structured-data'
import { ExternalLink, SourceNote } from './NewsDetail'

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com').replace(/\/$/, '')

// the FDA answers are cached a day; re-render hourly so a feed that failed once comes back quickly
export const revalidate = 3600

export const metadata: Metadata = {
  title: 'FDA News: Drug Recalls, New Drug Approvals and Shortages',
  description:
    'The latest FDA drug recalls, new drug approvals and drug shortages in plain words, from official FDA data and refreshed daily. Each item opens the full FDA details.',
  alternates: { canonical: '/fda-news' },
  openGraph: {
    title: 'Latest from the FDA — PillSeek',
    description: 'Drug recalls, new drug approvals and drug shortages from official FDA data, refreshed daily.',
    type: 'website',
    url: `${SITE_URL}/fda-news`,
  },
}

interface Group {
  kind: FdaNewsKind
  title: string
  intro: string
  items: FdaNewsItem[] | undefined
  more: { href: string; label: string; external?: boolean }
}

export default async function FdaNewsPage() {
  const [recalls, approvals, shortages] = await Promise.all([recallNews(10), approvalNews(10), shortageNews(8)])
  const groups: Group[] = [
    {
      kind: 'recall',
      title: 'Latest drug recalls',
      intro: 'Recalls from the FDA’s weekly enforcement reports in the last 60 days, newest first.',
      items: recalls,
      more: { href: '/recalls', label: 'Search recalls for any medicine →' },
    },
    {
      kind: 'approval',
      title: 'New drug approvals',
      intro: 'Medicines with an active ingredient the FDA had never approved before, approved in the last 60 days.',
      items: approvals,
      more: { href: FDA_NOVEL_APPROVALS_PAGE, label: 'FDA list of new drug approvals', external: true },
    },
    {
      kind: 'shortage',
      title: 'Drug shortages',
      intro: 'Drugs most recently added to the FDA shortage list, with what their makers report.',
      items: shortages,
      more: { href: FDA_SHORTAGE_PAGE, label: 'Full FDA drug shortage list', external: true },
    },
  ]
  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: SITE_URL },
    { name: 'FDA news', url: `${SITE_URL}/fda-news` },
  ])

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbs) }} />

      <div className="border-b border-emerald-100 bg-emerald-50">
        <div className="mx-auto max-w-4xl px-4 pb-10 pt-10 text-center sm:pt-14">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl">Latest from the FDA</h1>
          <p className="mx-auto mt-3 max-w-2xl text-base text-slate-600 sm:text-lg">
            Drug recalls, new drug approvals and drug shortages, from official FDA data and refreshed every day.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4">
        {groups.map((g) => {
          const look = FDA_NEWS_LOOK[g.kind]
          return (
            <section key={g.kind} aria-labelledby={`fda-${g.kind}`} className="mt-10">
              <div className="flex items-center gap-2.5">
                <FdaNewsIcon kind={g.kind} className={`h-7 w-7 ${look.icon}`} />
                <h2 id={`fda-${g.kind}`} className="text-2xl font-bold tracking-tight text-slate-900">
                  {g.title}
                </h2>
              </div>
              <p className="mt-1.5 text-sm text-slate-600">{g.intro}</p>
              <div className="mt-4 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                {g.items === undefined && <p className="px-5 py-4 text-sm text-slate-600">The FDA feed is not answering right now. Please check back later.</p>}
                {g.items?.length === 0 && <p className="px-5 py-4 text-sm text-slate-600">Nothing new from the FDA in this period.</p>}
                {g.items?.map((item) => <FdaNewsRow key={item.href} item={item} />)}
              </div>
              <p className="mt-3 text-sm">
                {g.more.external ? (
                  <ExternalLink href={g.more.href}>{g.more.label}</ExternalLink>
                ) : (
                  <Link href={g.more.href} className="font-semibold text-emerald-700 hover:text-emerald-800">
                    {g.more.label}
                  </Link>
                )}
              </p>
            </section>
          )
        })}

        <SourceNote>
          Source: openFDA (FDA enforcement reports, Drugs@FDA and the FDA drug shortage list), checked daily. Headlines are short
          summaries; each page shows the FDA’s full wording.
        </SourceNote>
      </div>
    </>
  )
}
