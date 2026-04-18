import type { Metadata } from 'next'
import Link from 'next/link'
import { breadcrumbSchema } from '../lib/structured-data'

export const metadata: Metadata = {
  title: 'Data Sources — IDMyPills',
  description:
    'IDMyPills uses FDA NDC Directory, DailyMed, and RxNorm as data sources. Learn about each source, what data we use, and when it was last updated.',
  alternates: { canonical: '/sources' },
}

export default function SourcesPage() {
  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: 'Data Sources', url: '/sources' },
  ])

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }}
      />

      <div className="max-w-3xl mx-auto px-4 py-12">
        <nav aria-label="Breadcrumb" className="mb-6">
          <ol className="flex items-center gap-1 text-sm text-slate-500">
            <li><Link href="/" className="hover:text-sky-700">Home</Link></li>
            <li aria-hidden="true" className="select-none">›</li>
            <li className="text-slate-700 font-medium">Data Sources</li>
          </ol>
        </nav>

        <h1 className="text-3xl font-bold text-slate-900 mb-4">Data Sources</h1>
        <p className="text-slate-600 mb-8 leading-relaxed">
          IDMyPills is built on authoritative, government-maintained databases. We do not create
          or infer drug information — everything displayed comes directly from these sources.
        </p>

        <div className="space-y-6">
          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="bg-blue-100 text-blue-700 rounded-lg p-2 shrink-0">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-slate-800 mb-1">
                  FDA National Drug Code (NDC) Directory
                </h2>
                <p className="text-slate-500 text-xs mb-3">
                  Source:{' '}
                  <a
                    href="https://www.fda.gov/drugs/drug-approvals-and-databases/national-drug-code-directory"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sky-600 hover:underline"
                  >
                    fda.gov/drugs/drug-approvals-and-databases/national-drug-code-directory
                  </a>
                </p>
                <p className="text-slate-700 text-sm leading-relaxed mb-3">
                  The FDA NDC Directory is the official registry of all drugs manufactured,
                  prepared, propagated, compounded, or processed for commercial distribution in
                  the United States. It contains drug names, NDC codes, dosage forms, routes of
                  administration, and labeler information.
                </p>
                <div className="flex flex-wrap gap-3 text-xs">
                  <span className="bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded-full font-medium">
                    ✓ Drug names
                  </span>
                  <span className="bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded-full font-medium">
                    ✓ NDC codes
                  </span>
                  <span className="bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded-full font-medium">
                    ✓ Dosage forms
                  </span>
                  <span className="bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded-full font-medium">
                    ✓ Manufacturer
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="bg-purple-100 text-purple-700 rounded-lg p-2 shrink-0">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                </svg>
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-slate-800 mb-1">
                  DailyMed
                </h2>
                <p className="text-slate-500 text-xs mb-3">
                  Source:{' '}
                  <a
                    href="https://dailymed.nlm.nih.gov/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sky-600 hover:underline"
                  >
                    dailymed.nlm.nih.gov
                  </a>
                </p>
                <p className="text-slate-700 text-sm leading-relaxed mb-3">
                  DailyMed is the official provider of FDA label information (package inserts).
                  It is maintained by the U.S. National Library of Medicine and contains
                  structured product labeling (SPL) data, including imprint codes, pill color,
                  shape, size, and ingredient information — exactly as submitted to the FDA.
                </p>
                <div className="flex flex-wrap gap-3 text-xs">
                  <span className="bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded-full font-medium">
                    ✓ Imprint codes
                  </span>
                  <span className="bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded-full font-medium">
                    ✓ Color &amp; shape
                  </span>
                  <span className="bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded-full font-medium">
                    ✓ Ingredients
                  </span>
                  <span className="bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded-full font-medium">
                    ✓ Pill images
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="bg-teal-100 text-teal-700 rounded-lg p-2 shrink-0">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-slate-800 mb-1">
                  RxNorm
                </h2>
                <p className="text-slate-500 text-xs mb-3">
                  Source:{' '}
                  <a
                    href="https://www.nlm.nih.gov/research/umls/rxnorm/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sky-600 hover:underline"
                  >
                    nlm.nih.gov/research/umls/rxnorm
                  </a>
                </p>
                <p className="text-slate-700 text-sm leading-relaxed mb-3">
                  RxNorm provides a normalized drug naming system for clinical drugs. It links
                  names of drugs to many of the drug vocabularies commonly used in pharmacy
                  management and drug interaction software. RxCUI identifiers displayed on
                  IDMyPills come from RxNorm.
                </p>
                <div className="flex flex-wrap gap-3 text-xs">
                  <span className="bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded-full font-medium">
                    ✓ RxCUI identifiers
                  </span>
                  <span className="bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded-full font-medium">
                    ✓ Normalized drug names
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section className="bg-slate-50 border border-slate-200 rounded-xl p-6">
            <h2 className="text-base font-semibold text-slate-700 mb-2">Data Update Policy</h2>
            <p className="text-slate-600 text-sm leading-relaxed">
              Our database is synchronized from FDA and DailyMed sources on a periodic basis.
              While we aim to keep data current, there may be a delay between FDA updates and
              our database. For the most authoritative and up-to-date drug information, always
              refer directly to{' '}
              <a href="https://dailymed.nlm.nih.gov/" target="_blank" rel="noopener noreferrer" className="text-sky-600 hover:underline">
                DailyMed
              </a>{' '}
              or consult a licensed pharmacist.
            </p>
          </section>
        </div>
      </div>
    </>
  )
}
