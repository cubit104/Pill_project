import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { shortageDetail, shortageHeadline, shortageMakers, shortageTag } from '../../../../lib/fda-news'
import { fdaNewsSwitches } from '../../../../lib/fda-news-switches'
import { pillSeekLinks } from '../../../../lib/pillseek-links'
import { prettyDate } from '../../../../lib/recalls'
import { FDA_SHORTAGE_PAGE, type Availability } from '../../../../lib/shortages'
import { DetailHeader, ExternalLink, Facts, NewsJsonLd, PillSeekLinks, Section, SourceNote, WhatToDo } from '../../NewsDetail'

type Params = Promise<{ slug: string }>

const BADGE: Record<Availability, { text: string; className: string }> = {
  unavailable: { text: 'Unavailable', className: 'border-red-200 bg-red-50 text-red-800' },
  limited: { text: 'Limited supply', className: 'border-amber-200 bg-amber-50 text-amber-900' },
  available: { text: 'Available', className: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  unknown: { text: 'Status unclear', className: 'border-slate-200 bg-slate-50 text-slate-700' },
}

/** `undefined` from the feed means the FDA did not answer: throw, so the error page shows and nothing is cached. */
async function load(slug: string) {
  if (!(await fdaNewsSwitches()).shortage) notFound() // switched off in Admin → Settings
  const data = await shortageDetail(decodeURIComponent(slug))
  if (data === undefined) throw new Error('The FDA shortage feed did not answer')
  if (data === null) notFound()
  return data
}

function describe(shortage: { name: string }): string {
  return `${shortage.name} is on the FDA drug shortage list. Which products and makers are affected, and what the makers report, from FDA data.`
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const shortage = await load((await params).slug)
  return {
    title: shortageHeadline(shortage),
    description: describe(shortage),
    robots: { index: true, follow: true },
    alternates: { canonical: `/fda-news/shortage/${shortage.slug}` },
  }
}

export default async function ShortageNewsPage({ params }: { params: Params }) {
  const shortage = await load((await params).slug)
  const { makers, short } = shortageMakers(shortage)
  const firstWord = shortage.name.split(/[\s,]+/)[0]
  const links = await pillSeekLinks([shortage.name])

  return (
    <>
      <NewsJsonLd
        headline={shortageHeadline(shortage)}
        path={`/fda-news/shortage/${shortage.slug}`}
        date={shortage.updated || shortage.posted}
        description={describe(shortage)}
        source={FDA_SHORTAGE_PAGE}
      />
      <DetailHeader kind="shortage" headline={shortageHeadline(shortage)} date={shortage.posted} tag={shortageTag(shortage)} />
      <div className="mx-auto max-w-4xl px-4 pt-8">
        <Facts
          rows={[
            ['Drug', shortage.name],
            ['Form', shortage.forms.join(', ')],
            ['Used in', shortage.categories.join(', ')],
            ['On the shortage list since', shortage.since ? prettyDate(shortage.since) : ''],
            ['Last update from the FDA', shortage.updated ? prettyDate(shortage.updated) : ''],
            ['Makers listed', makers.length ? `${makers.length} (${short} with limited or no supply)` : ''],
          ]}
        />

        <Section title="Products and what the makers report">
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
            {shortage.rows.map((row, i) => (
              <li key={`${row.presentation}-${i}`} className="px-4 py-3.5 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 text-sm font-semibold text-slate-900">{row.presentation || shortage.name}</p>
                  <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${BADGE[row.availability].className}`}>
                    {BADGE[row.availability].text}
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-slate-600">{row.company}</p>
                {row.reason && <p className="mt-1 text-sm text-slate-700">Reason: {row.reason}</p>}
                {row.info && <p className="mt-1 text-sm text-slate-700">{row.info}</p>}
              </li>
            ))}
          </ul>
        </Section>

        <PillSeekLinks links={links} />

        <WhatToDo>
          <ul className="list-disc space-y-1 pl-5">
            <li>If your medicine is on this list, ask your pharmacist about another strength, form or maker.</li>
            <li>Do not change your dose or stop the medicine on your own.</li>
          </ul>
        </WhatToDo>

        <p className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <ExternalLink href={FDA_SHORTAGE_PAGE}>FDA drug shortage list</ExternalLink>
          <Link href={`/recalls?drug=${encodeURIComponent(firstWord)}`} className="font-semibold text-emerald-700 hover:text-emerald-800">
            Recalls for {firstWord} →
          </Link>
        </p>

        <SourceNote>Source: FDA drug shortage list (openFDA), checked daily.</SourceNote>
      </div>
    </>
  )
}
