import type { Metadata } from 'next'
import Link from 'next/link'
import { breadcrumbSchema } from '../lib/structured-data'

export const metadata: Metadata = {
  title: 'Terms of Use — IDMyPills',
  description:
    'Read the IDMyPills Terms of Use. By using this service you agree to these terms, including that IDMyPills is for informational purposes only.',
  alternates: { canonical: '/terms' },
}

export default function TermsPage() {
  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: 'Terms of Use', url: '/terms' },
  ])

  const lastUpdated = 'April 2025'

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
            <li className="text-slate-700 font-medium">Terms of Use</li>
          </ol>
        </nav>

        <h1 className="text-3xl font-bold text-slate-900 mb-2">Terms of Use</h1>
        <p className="text-slate-500 text-sm mb-8">Last updated: {lastUpdated}</p>

        <div className="space-y-6">
          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800 mb-3">1. Acceptance of Terms</h2>
            <p className="text-slate-700 text-sm leading-relaxed">
              By accessing or using IDMyPills (&ldquo;the Service&rdquo;), you agree to be bound
              by these Terms of Use. If you do not agree to these terms, please do not use the
              Service.
            </p>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800 mb-3">2. Educational Use Only</h2>
            <p className="text-slate-700 text-sm leading-relaxed">
              IDMyPills is provided for <strong>educational and informational purposes only</strong>.
              The Service is designed to help identify medications by physical characteristics and
              imprint codes. It is <strong>not</strong> intended to be used as a substitute for
              professional medical advice, diagnosis, or treatment. Always seek the advice of a
              qualified healthcare professional with any questions you may have regarding a medical
              condition or medication.
            </p>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800 mb-3">3. Accuracy of Information</h2>
            <p className="text-slate-700 text-sm leading-relaxed">
              While we strive to provide accurate information sourced from the FDA and DailyMed,
              IDMyPills makes no warranty, express or implied, regarding the accuracy, completeness,
              or currency of any information on the Service. Drug databases are complex and may
              contain errors. Always confirm medication identification with a licensed pharmacist.
            </p>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800 mb-3">4. Limitation of Liability</h2>
            <p className="text-slate-700 text-sm leading-relaxed">
              To the maximum extent permitted by law, IDMyPills and its operators shall not be
              liable for any direct, indirect, incidental, special, or consequential damages
              resulting from your use of or inability to use the Service, or from any errors or
              omissions in the content.
            </p>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800 mb-3">5. Prohibited Uses</h2>
            <p className="text-slate-700 text-sm leading-relaxed mb-3">
              You agree not to:
            </p>
            <ul className="space-y-2 text-slate-700 text-sm">
              <li className="flex gap-2">
                <span className="text-red-500 shrink-0">•</span>
                Use the Service for any unlawful purpose
              </li>
              <li className="flex gap-2">
                <span className="text-red-500 shrink-0">•</span>
                Scrape, bulk-download, or systematically extract data without permission
              </li>
              <li className="flex gap-2">
                <span className="text-red-500 shrink-0">•</span>
                Misrepresent medication identity information from this Service to others
              </li>
              <li className="flex gap-2">
                <span className="text-red-500 shrink-0">•</span>
                Attempt to circumvent or disrupt the operation of the Service
              </li>
            </ul>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800 mb-3">6. Changes to Terms</h2>
            <p className="text-slate-700 text-sm leading-relaxed">
              We reserve the right to modify these Terms at any time. Continued use of the Service
              after changes constitutes acceptance of the revised Terms.
            </p>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800 mb-3">7. Contact</h2>
            <p className="text-slate-700 text-sm leading-relaxed">
              Questions about these Terms? Contact us at{' '}
              <a href="mailto:contact@idmypills.com" className="text-sky-600 hover:underline">
                contact@idmypills.com
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </>
  )
}
