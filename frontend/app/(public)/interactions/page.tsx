import type { Metadata } from 'next'
import InteractionsCheckerClient from './InteractionsCheckerClient'
import { breadcrumbSchema, safeJsonLd } from '../../lib/structured-data'

export const metadata: Metadata = {
  title: 'Drug Interaction Checker — Check Multiple Medications | PillSeek',
  description:
    'Free drug interaction checker. Add multiple medications to instantly see known interactions across all drug pairs, including severity and details from 178,000+ pairs.',
  alternates: { canonical: '/interactions' },
}

export default function InteractionsPage() {
  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: 'Drug Interaction Checker', url: '/interactions' },
  ])

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbs) }} />
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Drug Interaction Checker</h1>
          <p className="text-slate-600">
            Add multiple medications to check all interactions between them at once.
            Sourced from <strong>178,000+</strong> drug-drug interaction pairs. Enter
            each drug name and click <strong>Check Interactions</strong>.
          </p>
        </div>
        <InteractionsCheckerClient />
      </div>
    </>
  )
}
