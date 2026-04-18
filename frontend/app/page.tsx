import type { Metadata } from 'next'
import HomeSearch from './components/HomeSearch'
import Link from 'next/link'
import { websiteSchema, organizationSchema, safeJsonLd } from './lib/structured-data'

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com'
).replace(/\/$/, '')

export const metadata: Metadata = {
  title: 'PillSeek — Free Pill Identifier by Imprint, Drug Name, NDC, Color & Shape',
  description:
    'Identify any pill free using imprint codes, drug name, NDC number, color, or shape. Powered by FDA & DailyMed data. Trusted by patients and caregivers.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'PillSeek — Free Pill Identifier by Imprint, Drug Name, NDC, Color & Shape',
    description:
      'Identify any pill free using imprint codes, drug name, NDC number, color, or shape. Powered by FDA & DailyMed data.',
    url: SITE_URL,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PillSeek — Free Pill Identifier by Imprint, Drug Name, NDC, Color & Shape',
    description:
      'Identify any pill free using imprint codes, drug name, NDC number, color, or shape. Powered by FDA & DailyMed data.',
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

      {/* Hero Section — tighter spacing */}
      <section className="bg-gradient-to-b from-slate-50 to-white pt-8 pb-12 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <img
            src="/logo-mark.svg"
            alt=""
            width={96}
            height={96}
            className="mx-auto mb-4"
          />
          <h1 className="text-4xl sm:text-5xl font-bold mb-3 tracking-tight text-slate-900">
            Know your pill. <span className="text-emerald-700">Be sure.</span>
          </h1>
          <p className="text-lg sm:text-xl text-slate-600 mb-2 font-medium">
            Identify Any Medication by Imprint, Color, Shape, Drug Name, or NDC
          </p>
          <p className="text-slate-500 text-sm mb-8">
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

      {/* How It Works — illustrated cards */}
      <section className="py-14 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center text-slate-900 mb-3">
            How It Works
          </h2>
          <p className="text-center text-slate-600 mb-10 max-w-2xl mx-auto">
            Find your medication in three simple steps — no account, no fees, just fast, FDA-sourced answers.
          </p>
          <div className="grid md:grid-cols-3 gap-6">
            {/* Card 1 — Search by Imprint */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center gap-2 mb-4">
                <span className="bg-emerald-100 text-emerald-700 text-xs font-bold px-2 py-1 rounded-full">STEP 1</span>
              </div>
              <div className="flex justify-center mb-4">
                <svg viewBox="0 0 120 80" className="w-32 h-20" aria-hidden="true">
                  <ellipse cx="60" cy="40" rx="45" ry="22" fill="#fef3c7" stroke="#d97706" strokeWidth="2" />
                  <text x="40" y="46" fontFamily="monospace" fontSize="14" fontWeight="bold" fill="#78350f">M</text>
                  <text x="68" y="46" fontFamily="monospace" fontSize="14" fontWeight="bold" fill="#78350f">321</text>
                </svg>
              </div>
              <h3 className="font-semibold text-slate-900 mb-2 text-center">Read the Imprint</h3>
              <p className="text-slate-600 text-sm leading-relaxed text-center mb-3">
                Look at the letters or numbers stamped on your pill. Enter exactly what you see.
              </p>
              <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-600 text-center">
                <span className="text-slate-400">Example: </span>
                <span className="font-mono font-semibold text-slate-800">M 321</span>
              </div>
            </div>

            {/* Card 2 — Filter by Color/Shape */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center gap-2 mb-4">
                <span className="bg-emerald-100 text-emerald-700 text-xs font-bold px-2 py-1 rounded-full">STEP 2</span>
              </div>
              <div className="flex justify-center gap-2 mb-4">
                <svg viewBox="0 0 40 40" className="w-12 h-12" aria-hidden="true">
                  <circle cx="20" cy="20" r="15" fill="#10b981" stroke="#047857" strokeWidth="1.5" />
                </svg>
                <svg viewBox="0 0 40 40" className="w-12 h-12" aria-hidden="true">
                  <ellipse cx="20" cy="20" rx="17" ry="10" fill="#3b82f6" stroke="#1d4ed8" strokeWidth="1.5" />
                </svg>
                <svg viewBox="0 0 40 40" className="w-12 h-12" aria-hidden="true">
                  <rect x="4" y="14" width="32" height="12" rx="6" fill="#f59e0b" stroke="#b45309" strokeWidth="1.5" />
                  <rect x="4" y="14" width="16" height="12" rx="6" fill="#ef4444" stroke="#b91c1c" strokeWidth="1.5" />
                </svg>
              </div>
              <h3 className="font-semibold text-slate-900 mb-2 text-center">Pick Color & Shape</h3>
              <p className="text-slate-600 text-sm leading-relaxed text-center mb-3">
                Too many matches? Narrow results with the pill&apos;s color and shape.
              </p>
              <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-600 text-center">
                <span className="text-slate-400">Example: </span>
                <span className="font-semibold text-slate-800">Yellow + Oval</span>
              </div>
            </div>

            {/* Card 3 — View Full Details */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center gap-2 mb-4">
                <span className="bg-emerald-100 text-emerald-700 text-xs font-bold px-2 py-1 rounded-full">STEP 3</span>
              </div>
              <div className="flex justify-center mb-4">
                <svg viewBox="0 0 80 80" className="w-20 h-20" aria-hidden="true">
                  <rect x="14" y="10" width="52" height="64" rx="4" fill="#ffffff" stroke="#64748b" strokeWidth="2" />
                  <rect x="28" y="6" width="24" height="8" rx="2" fill="#94a3b8" />
                  <line x1="22" y1="26" x2="58" y2="26" stroke="#10b981" strokeWidth="2" />
                  <line x1="22" y1="34" x2="50" y2="34" stroke="#cbd5e1" strokeWidth="2" />
                  <line x1="22" y1="42" x2="58" y2="42" stroke="#cbd5e1" strokeWidth="2" />
                  <line x1="22" y1="50" x2="46" y2="50" stroke="#cbd5e1" strokeWidth="2" />
                  <line x1="22" y1="58" x2="54" y2="58" stroke="#cbd5e1" strokeWidth="2" />
                </svg>
              </div>
              <h3 className="font-semibold text-slate-900 mb-2 text-center">See Full Details</h3>
              <p className="text-slate-600 text-sm leading-relaxed text-center mb-3">
                Drug name, dosage, ingredients, manufacturer, NDC, and safety info — all verified.
              </p>
              <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-600 text-center">
                <span className="text-slate-400">Includes: </span>
                <span className="font-semibold text-slate-800">NDC, RxCUI, FDA data</span>
              </div>
            </div>
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
              {
                href: '/color/white',
                label: 'White Pills',
                svg: (
                  <svg viewBox="0 0 40 40" className="w-10 h-10">
                    <circle cx="20" cy="20" r="14" fill="#ffffff" stroke="#94a3b8" strokeWidth="2" />
                  </svg>
                ),
              },
              {
                href: '/shape/round',
                label: 'Round Pills',
                svg: (
                  <svg viewBox="0 0 40 40" className="w-10 h-10">
                    <circle cx="20" cy="20" r="14" fill="#10b981" />
                  </svg>
                ),
              },
              {
                href: '/shape/oval',
                label: 'Oval Pills',
                svg: (
                  <svg viewBox="0 0 40 40" className="w-10 h-10">
                    <ellipse cx="20" cy="20" rx="16" ry="9" fill="#10b981" />
                  </svg>
                ),
              },
              {
                href: '/shape/capsule',
                label: 'Capsule Pills',
                svg: (
                  <svg viewBox="0 0 40 40" className="w-10 h-10">
                    <rect x="4" y="13" width="32" height="14" rx="7" fill="#10b981" />
                    <rect x="4" y="13" width="16" height="14" rx="7" fill="#f87171" />
                  </svg>
                ),
              },
            ].map((cat) => (
              <Link
                key={cat.href}
                href={cat.href}
                className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center hover:bg-emerald-50 hover:border-emerald-300 transition-colors flex flex-col items-center"
              >
                <div className="mb-2" aria-hidden="true">{cat.svg}</div>
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