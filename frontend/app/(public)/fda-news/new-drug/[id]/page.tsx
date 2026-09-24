import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { approvalDetail, dailyMedUrl, drugsAtFdaUrl } from '../../../../lib/fda-news'
import { prettyDate } from '../../../../lib/recalls'
import { DetailHeader, ExternalLink, Facts, Section, SourceNote, WhatToDo } from '../../NewsDetail'

type Params = Promise<{ id: string }>

/** `undefined` from the feed means the FDA did not answer: throw, so the error page shows and nothing is cached. */
async function load(id: string) {
  const data = await approvalDetail(decodeURIComponent(id))
  if (data === undefined) throw new Error('The FDA approvals feed did not answer')
  if (data === null) notFound()
  return data
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { approval } = await load((await params).id)
  const name = approval.brand && approval.generic ? `${approval.brand} (${approval.generic})` : approval.brand || approval.generic
  return {
    title: approval.headline,
    description: `${name} was approved by the FDA on ${prettyDate(approval.date)}. What it is for, its form and the company, from FDA data.`,
    robots: { index: false, follow: true },
    alternates: { canonical: `/fda-news/new-drug/${approval.application}` },
  }
}

export default async function NewDrugNewsPage({ params }: { params: Params }) {
  const { approval, label } = await load((await params).id)
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

        <WhatToDo>
          <p>A newly approved medicine may not be in pharmacies right away. Ask your doctor or pharmacist whether it fits your treatment, and do not change a current medicine on your own.</p>
        </WhatToDo>

        <p className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <ExternalLink href={drugsAtFdaUrl(approval.application)}>Approval on Drugs@FDA</ExternalLink>
          {setId && <ExternalLink href={dailyMedUrl(setId)}>Full label on DailyMed</ExternalLink>}
        </p>

        <SourceNote>Source: Drugs@FDA and the FDA drug label database (openFDA), application {approval.application}.</SourceNote>
      </div>
    </>
  )
}
