import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { approvalAnnouncement, approvalNames, type FdaPage } from '../../../../lib/fda-announcements'
import { fdaNewsSwitches } from '../../../../lib/fda-news-switches'
import { approvalDetail, dailyMedUrl, drugsAtFdaUrl, type Approval, type LabelSummary } from '../../../../lib/fda-news'
import { prettyDate } from '../../../../lib/recalls'
import { DetailHeader, ExternalLink, Facts, Section, SourceNote, WhatToDo } from '../../NewsDetail'

type Params = Promise<{ id: string }>

/** Drugs@FDA application numbers ("NDA220359"); anything else is the slug of an FDA approval announcement. */
const APPLICATION = /^(NDA|BLA|ANDA)\d+$/i

/** `undefined` from a feed means the FDA did not answer: throw, so the error page shows and nothing is cached. */
async function load(id: string) {
  if (!(await fdaNewsSwitches()).approval) notFound() // switched off in Admin → Settings
  const key = decodeURIComponent(id)
  if (APPLICATION.test(key)) {
    const data = await approvalDetail(key)
    if (data === undefined) throw new Error('The FDA approvals feed did not answer')
    if (data === null) notFound()
    return { kind: 'application' as const, ...data }
  }
  const announcement = await approvalAnnouncement(key.toLowerCase())
  if (announcement === undefined) throw new Error('fda.gov did not answer')
  if (announcement === null) notFound()
  return { kind: 'announcement' as const, slug: key.toLowerCase(), ...announcement }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const data = await load((await params).id)
  const robots = { index: false, follow: true }
  if (data.kind === 'announcement') {
    return { title: data.page.title, description: data.page.summary.slice(0, 300), robots, alternates: { canonical: `/fda-news/new-drug/${data.slug}` } }
  }
  const { approval } = data
  const name = approval.brand && approval.generic ? `${approval.brand} (${approval.generic})` : approval.brand || approval.generic
  return {
    title: approval.headline,
    description: `${name} was approved by the FDA on ${prettyDate(approval.date)}. What it is for, its form and the company, from FDA data.`,
    robots,
    alternates: { canonical: `/fda-news/new-drug/${approval.application}` },
  }
}

export default async function NewDrugNewsPage({ params }: { params: Params }) {
  const data = await load((await params).id)
  return data.kind === 'announcement' ? <AnnouncementView page={data.page} url={data.url} /> : <ApplicationView approval={data.approval} label={data.label} />
}

function NewDrugWhatToDo() {
  return (
    <WhatToDo>
      <p>A newly approved medicine may not be in pharmacies right away. Ask your doctor or pharmacist whether it fits your treatment, and do not change a current medicine on your own.</p>
    </WhatToDo>
  )
}

/** The FDA's own announcement (press release or drug center note), for approvals Drugs@FDA does not list yet or at all. */
function AnnouncementView({ page, url }: { page: FdaPage; url: string }) {
  const names = approvalNames(page.summary)
  return (
    <>
      <DetailHeader kind="approval" headline={page.title} date={page.date} tag="Approved by the FDA" />
      <div className="mx-auto max-w-4xl px-4 pt-8">
        <Facts
          rows={[
            ['Brand name', names?.brand ?? ''],
            ['Active ingredient', names?.generic ?? ''],
            ['Product type', page.productType],
            ['Announced', page.date ? prettyDate(page.date) : ''],
          ]}
        />

        <Section title="What the FDA said">
          <p>{page.summary || 'See the FDA announcement for the details.'}</p>
          <p className="mt-2 text-sm">
            <ExternalLink href={url}>Read the full FDA announcement</ExternalLink>
          </p>
        </Section>

        <NewDrugWhatToDo />

        <SourceNote>Source: FDA announcement{page.date ? ` of ${prettyDate(page.date)}` : ''} on fda.gov. Drugs@FDA lists new drugs a week or two later.</SourceNote>
      </div>
    </>
  )
}

function ApplicationView({ approval, label }: { approval: Approval; label: LabelSummary | null }) {
  const setId = label?.setId || approval.setId
  const ingredients = [...new Set(approval.products.map((p) => p.ingredients).filter(Boolean))]
  const forms = [...new Set(approval.products.map((p) => p.form).filter(Boolean))]

  return (
    <>
      <DetailHeader kind="approval" headline={approval.headline} date={approval.date} tag="Approved by the FDA" />
      <div className="mx-auto max-w-4xl px-4 pt-8">
        <Facts
          rows={[
            ['Brand name', approval.brand],
            ['Active ingredient', approval.generic],
            ['Strengths', ingredients.join('; ')],
            ['Form', [forms.join('; '), approval.routes.join(', ').toLowerCase()].filter(Boolean).join(' · ')],
            ['Company', approval.sponsor],
            ['Approved', prettyDate(approval.date)],
            ['FDA application', approval.application],
            ['Type', approval.novel ? 'New molecular entity: an active ingredient the FDA had not approved before' : ''],
          ]}
        />

        <Section title="What it is for">
          {label?.uses ? (
            <>
              <p>{label.uses}</p>
              <p className="mt-2 text-sm text-slate-600">From the FDA-approved label.</p>
            </>
          ) : (
            <p>The FDA has not published the full label in its public data yet. The approval details are on Drugs@FDA.</p>
          )}
        </Section>

        {label?.boxedWarning && (
          <section className="mt-6 rounded-xl border border-red-200 bg-red-50 p-5">
            <h2 className="text-lg font-bold text-red-900">Boxed warning</h2>
            <p className="mt-1 text-sm leading-relaxed text-red-950">
              This medicine has a boxed warning, the FDA’s strongest warning. Read it in the full label before use.
            </p>
          </section>
        )}

        <NewDrugWhatToDo />

        <p className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <ExternalLink href={drugsAtFdaUrl(approval.application)}>Approval on Drugs@FDA</ExternalLink>
          {setId && <ExternalLink href={dailyMedUrl(setId)}>Full label on DailyMed</ExternalLink>}
        </p>

        <SourceNote>Source: Drugs@FDA and the FDA drug label database (openFDA), application {approval.application}.</SourceNote>
      </div>
    </>
  )
}
