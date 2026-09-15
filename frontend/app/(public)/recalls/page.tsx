import type { Metadata } from 'next'
import { breadcrumbSchema, faqSchema, safeJsonLd } from '../../lib/structured-data'
import RecallsClient from './RecallsClient'

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com').replace(/\/$/, '')

export const metadata: Metadata = {
  title: 'FDA Drug Recalls and Safety Alerts: Check Any Medicine',
  description:
    'Search FDA drug recalls from the last 12 months for any medicine, with the recall class, reason, maker and lot numbers to compare with your bottle. Plus the latest recalls nationwide. Free, from official FDA enforcement reports.',
  alternates: { canonical: '/recalls' },
  openGraph: {
    title: 'FDA Drug Recalls and Safety Alerts — PillSeek',
    description: 'Check any medicine for FDA recalls in the last 12 months, with lot numbers to compare with your bottle.',
    type: 'website',
    url: `${SITE_URL}/recalls`,
  },
}

const faqs = [
  {
    question: 'Where do these recalls come from?',
    answer:
      'From the FDA enforcement reports published through openFDA, the same records the FDA posts each week. PillSeek shows drug recalls from the last 12 months and refreshes them daily.',
  },
  {
    question: 'My medicine is listed. Should I stop taking it?',
    answer:
      'Not on your own. Most recalls cover specific lots, so first compare the lot numbers on the recall with the ones on your bottle. If they match, call your pharmacy or prescriber before taking more. Stopping some medicines suddenly is riskier than the recall itself.',
  },
  {
    question: 'What do Class I, II and III mean?',
    answer:
      'Class I means use of the product could cause serious harm or death. Class II means it could cause temporary or reversible harm. Class III means it is unlikely to cause harm, for example a labelling mistake.',
  },
  {
    question: 'Does the cabinet check my medicines automatically?',
    answer: 'Yes. Pills saved in your PillSeek cabinet, on the website and in the app, are checked against the FDA feed every day, and the cabinet shows a warning when one of them has a recall.',
  },
]

function pick(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : undefined
}

export default async function RecallsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const initialDrug = pick(sp.drug)
  const pageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'FDA Drug Recalls and Safety Alerts',
    url: `${SITE_URL}/recalls`,
    description: metadata.description,
    isPartOf: { '@type': 'WebSite', name: 'PillSeek', url: SITE_URL },
  }
  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: SITE_URL },
    { name: 'FDA alerts', url: `${SITE_URL}/recalls` },
  ])

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(pageJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(faqSchema(faqs)) }} />

      <div className="bg-emerald-50 border-b border-emerald-100">
        <div className="mx-auto max-w-6xl px-4 pb-10 pt-10 sm:pt-14">
          <div className="mx-auto mb-6 max-w-2xl text-center">
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl">FDA drug recalls and safety alerts</h1>
            <p className="mt-3 text-base text-slate-600 sm:text-lg">Drug recalls from the FDA, last 12 months. Search any medicine and compare the lot numbers with your bottle.</p>
          </div>
          <RecallsClient initialDrug={initialDrug} />
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4">
        <section className="mb-16 mt-12">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Questions people ask</h2>
          <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
            {faqs.map((f) => (
              <details key={f.question} className="group px-5 py-4">
                <summary className="cursor-pointer list-none text-base font-semibold text-slate-900 marker:content-none">{f.question}</summary>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.answer}</p>
              </details>
            ))}
          </div>
          <p className="mt-6 text-xs leading-relaxed text-slate-500">Source: FDA enforcement reports (openFDA). Informational only and not medical advice; confirm with your pharmacist or prescriber.</p>
        </section>
      </div>
    </>
  )
}
