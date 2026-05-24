import type { Metadata } from 'next'
import Link from 'next/link'
import { breadcrumbSchema, safeJsonLd } from '../../lib/structured-data'
import ContactFormClient from './ContactFormClient'

export const metadata: Metadata = {
  title: 'Contact PillSeek',
  description:
    'Contact the PillSeek team with questions, feedback, or data correction requests.',
  alternates: { canonical: '/contact' },
}

export default function ContactPage() {
  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: 'Contact', url: '/contact' },
  ])

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbs) }}
      />

      <div className="max-w-2xl mx-auto px-4 py-12">
        <nav aria-label="Breadcrumb" className="mb-6">
          <ol className="flex items-center gap-1 text-sm text-slate-500">
            <li><Link href="/" className="hover:text-sky-700">Home</Link></li>
            <li aria-hidden="true" className="select-none">›</li>
            <li className="text-slate-700 font-medium">Contact</li>
          </ol>
        </nav>

        <h1 className="text-3xl font-bold text-slate-900 mb-4">Contact Us</h1>
        <p className="text-slate-600 mb-8 leading-relaxed">
          Have a question, found a data error, or want to report an issue? We&rsquo;d love to
          hear from you. Use the form below or email us directly.
        </p>

        <ContactFormClient />

        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-2">Or email us directly</h2>
          <a
            href="mailto:contact@pillseek.com"
            className="text-sky-600 hover:underline text-sm font-medium"
          >
            contact@pillseek.com
          </a>
          <p className="text-slate-500 text-xs mt-2">
            We typically respond within 2–3 business days.
          </p>
        </div>
      </div>
    </>
  )
}
