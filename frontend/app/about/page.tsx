import type { Metadata } from 'next'
import Link from 'next/link'
import { breadcrumbSchema, faqSchema, safeJsonLd } from '../lib/structured-data'
import { REVIEWERS } from '../lib/reviewers'

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com'
).replace(/\/$/, '')

export const metadata: Metadata = {
  title: 'About PillSeek — Free Pill Identifier',
  description:
    'Learn about PillSeek: our mission to help patients identify medications safely, our data sources (FDA NDC, DailyMed, RxNorm), and our editorial standards.',
  alternates: { canonical: '/about' },
  openGraph: {
    title: 'About PillSeek — Free Pill Identifier',
    description:
      'PillSeek helps patients and caregivers identify medications using FDA-sourced data. Learn about our mission and editorial standards.',
    type: 'website',
  },
}

const faqs = [
  {
    question: 'What is PillSeek?',
    answer:
      'PillSeek is a free online pill identification tool that helps patients, caregivers, and healthcare professionals identify medications by imprint code, color, shape, or drug name. Our database is powered by data from the FDA National Drug Code (NDC) Directory and DailyMed.',
  },
  {
    question: 'Where does PillSeek data come from?',
    answer:
      'All medication data is sourced from the FDA National Drug Code (NDC) Directory, DailyMed (the official labeling database maintained by the U.S. National Library of Medicine), and RxNorm (the normalized drug naming system). We do not fabricate or infer drug information.',
  },
  {
    question: 'Is PillSeek a substitute for medical advice?',
    answer:
      'No. PillSeek is for educational and identification purposes only. It is not a substitute for professional medical advice, diagnosis, or treatment. Always consult a licensed pharmacist or physician before making any medication decision.',
  },
  {
    question: 'How often is the data updated?',
    answer:
      'We sync our database from FDA and DailyMed sources on a regular basis. You can view the last-updated date on our Data Sources page.',
  },
  {
    question: 'Who reviews the content on PillSeek?',
    answer:
      'Content on PillSeek is currently maintained by our editorial and engineering team, which curates data pulled verbatim from FDA NDC Directory, DailyMed, and RxNorm. We do not author drug content — all information comes directly from government databases. We are actively seeking licensed pharmacists (PharmD/RPh) to serve as formal medical reviewers. Until that process is complete, all pages are reviewed by our editorial team for accuracy against the source data.',
  },
]

export default function AboutPage() {
  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: 'About', url: '/about' },
  ])
  const faqJsonLd = faqSchema(faqs)
  const aboutPageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    name: 'About PillSeek',
    url: `${SITE_URL}/about`,
    author: { '@type': 'Organization', name: 'PillSeek' },
    dateModified: new Date().toISOString(),
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbs) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(faqJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(aboutPageJsonLd) }}
      />

      <div className="max-w-3xl mx-auto px-4 py-12">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="mb-6">
          <ol className="flex items-center gap-1 text-sm text-slate-500">
            <li><Link href="/" className="hover:text-sky-700">Home</Link></li>
            <li aria-hidden="true" className="select-none">›</li>
            <li className="text-slate-700 font-medium">About</li>
          </ol>
        </nav>

        <h1 className="text-3xl font-bold text-slate-900 mb-4">About PillSeek</h1>

        <section className="bg-white border border-slate-200 rounded-xl p-6 mb-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-800 mb-3">Our Mission</h2>
          <p className="text-slate-700 leading-relaxed mb-4">
            PillSeek was created to give patients, caregivers, and healthcare professionals a
            fast, reliable way to identify medications. Whether you found an unknown pill at home,
            need to confirm a prescription, or are a nurse checking a patient&rsquo;s medication —
            PillSeek provides clear, authoritative identification using government-sourced data.
          </p>
          <p className="text-slate-700 leading-relaxed">
            We believe medication safety information should be freely accessible to everyone. All
            features on PillSeek are and will always remain <strong>100% free</strong>.
          </p>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-6 mb-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-800 mb-3">Data Sources</h2>
          <p className="text-slate-700 leading-relaxed mb-4">
            All pill data on PillSeek is sourced exclusively from authoritative, government-maintained databases:
          </p>
          <ul className="space-y-3 text-slate-700">
            <li className="flex gap-3">
              <span className="text-sky-600 font-bold shrink-0">→</span>
              <div>
                <strong>FDA National Drug Code (NDC) Directory</strong> — The official registry
                of all drugs manufactured and distributed in the United States, maintained by the
                U.S. Food &amp; Drug Administration.
              </div>
            </li>
            <li className="flex gap-3">
              <span className="text-sky-600 font-bold shrink-0">→</span>
              <div>
                <strong>DailyMed</strong> — The official provider of FDA label information,
                including imprint codes, color, shape, and ingredient data. Maintained by the
                U.S. National Library of Medicine.
              </div>
            </li>
            <li className="flex gap-3">
              <span className="text-sky-600 font-bold shrink-0">→</span>
              <div>
                <strong>RxNorm</strong> — A normalized drug naming system maintained by the
                National Library of Medicine, providing standardized drug identifiers.
              </div>
            </li>
          </ul>
          <p className="text-slate-600 text-sm mt-4">
            <Link href="/sources" className="text-sky-600 hover:underline">
              View full data source details and last-updated dates →
            </Link>
          </p>
        </section>

        {/* Editorial Team */}
        <section id="editorial-team" className="bg-white border border-slate-200 rounded-xl p-6 mb-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-800 mb-3">Editorial Team</h2>
          {REVIEWERS.map((reviewer) => (
            <div key={reviewer.id} className="mb-4 last:mb-0">
              <p className="font-semibold text-slate-800">{reviewer.name}</p>
              <p className="text-sm text-slate-500 mb-1">
                {reviewer.credentials} &middot;{' '}
                <span className="capitalize">{reviewer.role.replace('_', ' ')}</span>
              </p>
              <p className="text-slate-700 text-sm leading-relaxed">{reviewer.bio}</p>
            </div>
          ))}
          <div className="mt-4 border-t border-slate-100 pt-4">
            <p className="text-slate-600 text-sm leading-relaxed">
              PillSeek is currently operated by an editorial and engineering team. We are actively
              seeking licensed pharmacists (PharmD/RPh) to serve as medical reviewers. If you are
              a credentialed clinician interested in reviewing our content, contact us at{' '}
              <a href="mailto:reviewers@pillseek.com" className="text-sky-600 hover:underline">
                reviewers@pillseek.com
              </a>
              .
            </p>
          </div>
        </section>

        {/* Editorial Policy */}
        <section id="editorial-policy" className="bg-white border border-slate-200 rounded-xl p-6 mb-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-800 mb-4">Editorial Policy</h2>

          <div className="space-y-4 text-slate-700 text-sm leading-relaxed">
            <div>
              <h3 className="font-semibold text-slate-800 mb-1">Sourcing Policy</h3>
              <p>
                All drug and pill data on PillSeek is sourced exclusively from the FDA NDC
                Directory, DailyMed, and RxNorm. We do not use third-party databases, AI-generated
                content, or community submissions for drug identification data.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-slate-800 mb-1">No Medical Advice Policy</h3>
              <p>
                PillSeek never authors dosing instructions, treatment recommendations, or diagnostic
                content. Every page displays data pulled verbatim from government sources. We
                explicitly disclaim medical advice on every page and link to our{' '}
                <Link href="/medical-disclaimer" className="text-sky-600 hover:underline">
                  Medical Disclaimer
                </Link>
                .
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-slate-800 mb-1">Review &amp; Update Cadence</h3>
              <p>
                When FDA or DailyMed source data is updated, pages reflect changes within 24 hours
                via Next.js ISR (Incremental Static Regeneration) revalidation. Each pill detail
                page displays a <em>Last updated</em> date that matches the{' '}
                <code className="bg-slate-100 px-1 rounded text-xs">lastReviewed</code> /{' '}
                <code className="bg-slate-100 px-1 rounded text-xs">dateModified</code> fields in
                the page&rsquo;s structured data.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-slate-800 mb-1">Corrections Policy</h3>
              <p>
                Users can report inaccuracies via our{' '}
                <Link href="/contact" className="text-sky-600 hover:underline">
                  contact page
                </Link>
                . Verified corrections are published within 72 hours. Because our data is pulled
                directly from FDA/DailyMed, discrepancies typically reflect the source database
                and are reported upstream.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-slate-800 mb-1">Conflict of Interest</h3>
              <p>
                PillSeek has no pharmaceutical sponsorships, advertising relationships, or financial
                ties to any drug manufacturer. The site is funded independently, and no content is
                influenced by commercial interests.
              </p>
            </div>
          </div>
        </section>

        {/* Editorial Standards */}
        <section id="editorial-standards" className="bg-white border border-slate-200 rounded-xl p-6 mb-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-800 mb-3">Editorial Standards</h2>
          <p className="text-slate-700 leading-relaxed mb-3">
            We maintain strict editorial standards to ensure accuracy:
          </p>
          <ul className="space-y-2 text-slate-700">
            <li className="flex gap-2">
              <span className="text-green-600">✓</span>
              All data is pulled directly from FDA/DailyMed — we never fabricate or infer drug information.
            </li>
            <li className="flex gap-2">
              <span className="text-green-600">✓</span>
              No AI-generated drug content — all pill identification data is verbatim from government sources.
            </li>
            <li className="flex gap-2">
              <span className="text-green-600">✓</span>
              We do not add medical advice, dosing recommendations, or treatment information.
            </li>
            <li className="flex gap-2">
              <span className="text-green-600">✓</span>
              Every page prominently displays our medical disclaimer.
            </li>
            <li className="flex gap-2">
              <span className="text-green-600">✓</span>
              We recommend users always confirm identification with a licensed pharmacist.
            </li>
          </ul>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-6 mb-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-800 mb-4">Frequently Asked Questions</h2>
          <div className="space-y-5">
            {faqs.map((faq) => (
              <div key={faq.question}>
                <h3 className="font-medium text-slate-800 mb-1">{faq.question}</h3>
                <p className="text-slate-600 text-sm leading-relaxed">{faq.answer}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <p className="text-amber-800 text-sm leading-relaxed">
            <strong>⚠️ Medical Disclaimer:</strong> PillSeek is for educational and informational
            purposes only. It is not a substitute for professional medical advice, diagnosis, or
            treatment.{' '}
            <Link href="/medical-disclaimer" className="underline hover:text-amber-900">
              Read our full medical disclaimer
            </Link>
            .
          </p>
        </div>
      </div>
    </>
  )
}
