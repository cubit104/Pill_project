import type { Metadata } from 'next'
import HomeSearch from './components/HomeSearch'
import Link from 'next/link'
import { websiteSchema, organizationSchema, safeJsonLd } from './lib/structured-data'

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com'
).replace(/\/$/, '')

export const metadata: Metadata = {
  title: 'PillSeek — Free Pill Identifier by Imprint, Color & Shape',
  description:
    'Identify any pill free using imprint codes, color, shape, or drug name. Powered by FDA & DailyMed data. Trusted by patients and caregivers.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'PillSeek — Free Pill Identifier by Imprint, Color & Shape',
    description:
      'Identify any pill free using imprint codes, color, shape, or drug name. Powered by FDA & DailyMed data.',
    url: SITE_URL,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PillSeek — Free Pill Identifier by Imprint, Color & Shape',
    description:
      'Identify any pill free using imprint codes, color, shape, or drug name. Powered by FDA & DailyMed data.',
  },
}

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(websiteSchema()) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(organizationSchema()) }}
      />

      {/* Hero Section — clean white, Drugs.com style */}
      <section className="bg-gradient-to-b from-slate-50 to-white py-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <img
            src="/1.png"
            alt=""
            width={220}
            height={220}
            className="mx-auto mb-6"
          />
          <h1 className="text-5xl font-bold mb-4 tracking-tight text-slate-900">
            Know your pill. <span className="text-emerald-700">Be sure.</span>
          </h1>
          <p className="text-xl text-slate-600 mb-2 font-medium">
            Identify Any Medication by Imprint, Color, or Shape
          </p>
          <p className="text-slate-500 text-sm mb-10">
            Search our database of thousands of FDA-approved medications instantly
          </p>
          <HomeSearch />
        </div>
      </section>

      <section className="bg-white border-y border-slate-200 py-10 px-4">
        <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          {[
            { value: '10,000+', label: 'Medications' },
            { value: 'Free', label: 'Always Free' },
            { value: 'FDA', label: 'Data Source' },
            { value: '24/7', label: 'Available' },
          ].map((stat) => (
            <div key={stat.label}>
              <p className="text-3xl font-bold text-emerald-700">{stat.value}</p>
              <p className="text-slate-600 text-sm mt-1">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-center text-slate-900 mb-10">
            How It Works
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: '1',
                icon: '🔍',
                title: 'Search by Imprint',
                desc: 'Enter the letters or numbers stamped on your pill to find an exact match.',
              },
              {
                step: '2',
                icon: '🎨',
                title: 'Filter by Color & Shape',
                desc: 'Narrow results using the pill color and shape for faster identification.',
              },
              {
                step: '3',
                icon: '📋',
                title: 'View Full Details',
                desc: 'See drug name, dosage, ingredients, manufacturer, and safety information.',
              },
            ].map((item) => (
              <div
                key={item.step}
                className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm text-center"
              >
                <div className="text-4xl mb-3" role="img" aria-label={item.title}>
                  {item.icon}
                </div>
                <h3 className="font-semibold text-slate-900 mb-2">{item.title}</h3>
                <p className="text-slate-600 text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-8 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
            <p className="text-amber-800 text-sm text-center leading-relaxed">
              <strong>⚠️ Medical Disclaimer:</strong> PillSeek is for educational and
              informational purposes only. It is not a substitute for professional medical
              advice, diagnosis, or treatment. Always consult a qualified healthcare
              professional before making any medical decisions.{' '}
              <Link href="/medical-disclaimer" className="underline hover:text-amber-900">
                Read full disclaimer
              </Link>
              .
            </p>
          </div>
        </div>
      </section>

      <section className="py-12 px-4 bg-white border-t border-slate-200">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-center text-slate-900 mb-8">
            Browse Pills by Category
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { href: '/color/white', label: 'White Pills', icon: '⬜' },
              { href: '/shape/round', label: 'Round Pills', icon: '🔵' },
              { href: '/shape/oval', label: 'Oval Pills', icon: '💊' },
              { href: '/shape/capsule', label: 'Capsule Pills', icon: '🔴' },
            ].map((cat) => (
              <Link
                key={cat.href}
                href={cat.href}
                className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center hover:bg-emerald-50 hover:border-emerald-300 transition-colors"
              >
                <div className="text-3xl mb-2" role="img" aria-hidden="true">{cat.icon}</div>
                <p className="text-sm font-medium text-slate-700">{cat.label}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="py-12 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 text-center">
            <h2 className="text-lg font-semibold text-emerald-900 mb-3">
              Built on Trusted, Authoritative Data
            </h2>
            <p className="text-emerald-800 text-sm leading-relaxed max-w-2xl mx-auto mb-4">
              PillSeek pulls directly from the{' '}
              <strong>FDA National Drug Code (NDC) Directory</strong>,{' '}
              <strong>DailyMed</strong>, and <strong>RxNorm</strong> — the same
              databases used by pharmacists and healthcare professionals. All data is
              kept up to date and presented exactly as filed with the FDA.
            </p>
            <div className="flex flex-wrap justify-center gap-3 text-sm">
              <Link href="/about" className="text-emerald-700 hover:text-emerald-900 underline font-medium">
                About PillSeek
              </Link>
              <span className="text-emerald-400">·</span>
              <Link href="/sources" className="text-emerald-700 hover:text-emerald-900 underline font-medium">
                Data Sources
              </Link>
              <span className="text-emerald-400">·</span>
              <Link href="/medical-disclaimer" className="text-emerald-700 hover:text-emerald-900 underline font-medium">
                Medical Disclaimer
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
