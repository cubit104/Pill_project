import type { Metadata } from 'next'
import Link from 'next/link'
import { breadcrumbSchema, faqSchema } from '../lib/structured-data'

export const metadata: Metadata = {
  title: 'About IDMyPills — Free Pill Identifier',
  description:
    'Learn about IDMyPills: our mission to help patients identify medications safely, our data sources (FDA NDC, DailyMed, RxNorm), and our editorial standards.',
  alternates: { canonical: '/about' },
  openGraph: {
    title: 'About IDMyPills — Free Pill Identifier',
    description:
      'IDMyPills helps patients and caregivers identify medications using FDA-sourced data. Learn about our mission and editorial standards.',
    type: 'website',
  },
}

const faqs = [
  {
    question: 'What is IDMyPills?',
    answer:
      'IDMyPills is a free online pill identification tool that helps patients, caregivers, and healthcare professionals identify medications by imprint code, color, shape, or drug name. Our database is powered by data from the FDA National Drug Code (NDC) Directory and DailyMed.',
  },
  {
    question: 'Where does IDMyPills data come from?',
    answer:
      'All medication data is sourced from the FDA National Drug Code (NDC) Directory, DailyMed (the official labeling database maintained by the U.S. National Library of Medicine), and RxNorm (the normalized drug naming system). We do not fabricate or infer drug information.',
  },
  {
    question: 'Is IDMyPills a substitute for medical advice?',
    answer:
      'No. IDMyPills is for educational and identification purposes only. It is not a substitute for professional medical advice, diagnosis, or treatment. Always consult a licensed pharmacist or physician before making any medication decision.',
  },
  {
    question: 'How often is the data updated?',
    answer:
      'We sync our database from FDA and DailyMed sources on a regular basis. You can view the last-updated date on our Data Sources page.',
  },
]

export default function AboutPage() {
  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: 'About', url: '/about' },
  ])
  const faqJsonLd = faqSchema(faqs)

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
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

        <h1 className="text-3xl font-bold text-slate-900 mb-4">About IDMyPills</h1>

        <section className="bg-white border border-slate-200 rounded-xl p-6 mb-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-800 mb-3">Our Mission</h2>
          <p className="text-slate-700 leading-relaxed mb-4">
            IDMyPills was created to give patients, caregivers, and healthcare professionals a
            fast, reliable way to identify medications. Whether you found an unknown pill at home,
            need to confirm a prescription, or are a nurse checking a patient&rsquo;s medication —
            IDMyPills provides clear, authoritative identification using government-sourced data.
          </p>
          <p className="text-slate-700 leading-relaxed">
            We believe medication safety information should be freely accessible to everyone. All
            features on IDMyPills are and will always remain <strong>100% free</strong>.
          </p>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-6 mb-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-800 mb-3">Data Sources</h2>
          <p className="text-slate-700 leading-relaxed mb-4">
            All pill data on IDMyPills is sourced exclusively from authoritative, government-maintained databases:
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

        <section className="bg-white border border-slate-200 rounded-xl p-6 mb-6 shadow-sm">
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
            <strong>⚠️ Medical Disclaimer:</strong> IDMyPills is for educational and informational
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
