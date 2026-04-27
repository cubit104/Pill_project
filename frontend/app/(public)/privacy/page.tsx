import type { Metadata } from 'next'
import Link from 'next/link'
import { breadcrumbSchema, safeJsonLd } from '../../lib/structured-data'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'Read the PillSeek privacy policy. We are committed to protecting your privacy and only collect essential data to operate the service.',
  alternates: { canonical: '/privacy' },
}

export default function PrivacyPage() {
  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: 'Privacy Policy', url: '/privacy' },
  ])

  const lastUpdated = 'April 2025'

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbs) }}
      />

      <div className="max-w-3xl mx-auto px-4 py-12">
        <nav aria-label="Breadcrumb" className="mb-6">
          <ol className="flex items-center gap-1 text-sm text-slate-500">
            <li><Link href="/" className="hover:text-sky-700">Home</Link></li>
            <li aria-hidden="true" className="select-none">›</li>
            <li className="text-slate-700 font-medium">Privacy Policy</li>
          </ol>
        </nav>

        <h1 className="text-3xl font-bold text-slate-900 mb-2">Privacy Policy</h1>
        <p className="text-slate-500 text-sm mb-8">Last updated: {lastUpdated}</p>

        <div className="space-y-6">
          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800 mb-3">1. Overview</h2>
            <p className="text-slate-700 text-sm leading-relaxed">
              PillSeek (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) is committed
              to protecting your privacy. This Privacy Policy explains how we collect, use, and
              safeguard information when you use pillseek.com (the &ldquo;Service&rdquo;).
            </p>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800 mb-3">2. Information We Collect</h2>
            <p className="text-slate-700 text-sm leading-relaxed mb-3">
              PillSeek does <strong>not</strong> require account creation or collect personally
              identifiable information to use the pill identifier. We may collect:
            </p>
            <ul className="space-y-2 text-slate-700 text-sm">
              <li className="flex gap-2">
                <span className="text-sky-600 shrink-0">•</span>
                <span><strong>Usage data:</strong> Standard server logs including IP addresses,
                browser type, pages visited, and timestamps. This data is used for security and
                to improve the service.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-sky-600 shrink-0">•</span>
                <span><strong>Search queries:</strong> The search terms you enter (imprint codes,
                drug names, etc.) to return results. We do not store these queries linked to any
                personal identifier.</span>
              </li>
            </ul>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800 mb-3">3. How We Use Information</h2>
            <p className="text-slate-700 text-sm leading-relaxed">
              We use collected information solely to: operate and improve the Service, monitor
              for security threats and abuse, and analyze usage patterns (in aggregate) to improve
              search quality. We do <strong>not</strong> sell, rent, or share your data with third
              parties for marketing purposes.
            </p>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800 mb-3">4. Cookies</h2>
            <p className="text-slate-700 text-sm leading-relaxed">
              PillSeek uses only essential session cookies required for the Service to function.
              We do not use tracking cookies, advertising cookies, or third-party analytics cookies
              that identify you personally.
            </p>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800 mb-3">5. Data Retention</h2>
            <p className="text-slate-700 text-sm leading-relaxed">
              Server access logs are retained for up to 90 days for security purposes, then
              deleted. No personal health information is stored by PillSeek.
            </p>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800 mb-3">6. Your Rights</h2>
            <p className="text-slate-700 text-sm leading-relaxed">
              Since we do not collect personally identifiable information, there is typically no
              personal data to access or delete. If you have questions about data collected via
              server logs, please{' '}
              <Link href="/contact" className="text-sky-600 hover:underline">contact us</Link>.
            </p>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800 mb-3">7. Changes to This Policy</h2>
            <p className="text-slate-700 text-sm leading-relaxed">
              We may update this Privacy Policy from time to time. We will post the updated
              policy on this page with a revised &ldquo;Last updated&rdquo; date. Continued use
              of the Service after changes constitutes acceptance of the new policy.
            </p>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800 mb-3">8. Contact</h2>
            <p className="text-slate-700 text-sm leading-relaxed">
              For privacy-related questions, contact us at{' '}
              <a href="mailto:contact@pillseek.com" className="text-sky-600 hover:underline">
                contact@pillseek.com
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </>
  )
}
