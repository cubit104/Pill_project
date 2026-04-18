import type { Metadata } from 'next'
import Link from 'next/link'
import { breadcrumbSchema, safeJsonLd } from '../lib/structured-data'

export const metadata: Metadata = {
  title: 'Contact IDMyPills',
  description:
    'Contact the IDMyPills team with questions, feedback, or data correction requests.',
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
        {/* Breadcrumb */}
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

        <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">Send a Message</h2>

          <form
            action="mailto:contact@idmypills.com"
            method="get"
            encType="text/plain"
            className="space-y-4"
          >
            <div>
              <label
                htmlFor="contact-name"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Name
              </label>
              <input
                id="contact-name"
                name="name"
                type="text"
                autoComplete="name"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                placeholder="Your name"
              />
            </div>

            <div>
              <label
                htmlFor="contact-email"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Email
              </label>
              <input
                id="contact-email"
                name="email"
                type="email"
                autoComplete="email"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                placeholder="your@email.com"
              />
            </div>

            <div>
              <label
                htmlFor="contact-subject"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Subject
              </label>
              <select
                id="contact-subject"
                name="subject"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 bg-white"
              >
                <option value="general">General Question</option>
                <option value="data-error">Data Error / Correction Request</option>
                <option value="feedback">Product Feedback</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="contact-message"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Message
              </label>
              <textarea
                id="contact-message"
                name="body"
                rows={5}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 resize-none"
                placeholder="Describe your question or issue..."
              />
            </div>

            <button
              type="submit"
              className="w-full bg-sky-600 hover:bg-sky-700 text-white font-medium py-2.5 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
            >
              Send Message
            </button>
          </form>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-2">Or email us directly</h2>
          <a
            href="mailto:contact@idmypills.com"
            className="text-sky-600 hover:underline text-sm font-medium"
          >
            contact@idmypills.com
          </a>
          <p className="text-slate-500 text-xs mt-2">
            We typically respond within 2–3 business days.
          </p>
        </div>
      </div>
    </>
  )
}
