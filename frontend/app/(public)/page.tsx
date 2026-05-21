import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import HomeFaq, { HOME_FAQS } from '../components/HomeFaq'
import HomeSearch from '../components/HomeSearch'
import PopularMedications from '../components/PopularMedications'
import TrendingPills from '../components/TrendingPills'
import {
  faqSchema,
  organizationSchema,
  safeJsonLd,
  websiteSchema,
} from '../lib/structured-data'

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com'
).replace(/\/$/, '')
const HOME_LAST_UPDATED = 'May 21, 2026'

type PillarCard = {
  href: string
  iconLabel: string
  title: string
  description: string
  cta: string
  icon?: string
  iconSrc?: string
}

export const metadata: Metadata = {
  title: 'PillSeek — Free Pill Identifier, Drug Price Check & Patient Guide (FDA Data)',
  description:
    'Free pill identifier, drug price checks, and patient-friendly medication guides powered by FDA, DailyMed, and NADAC data.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'PillSeek — Free Pill Identifier, Drug Price Check & Patient Guide (FDA Data)',
    description:
      'Free pill identifier, drug price checks, and patient-friendly medication guides powered by FDA, DailyMed, and NADAC data.',
    url: SITE_URL,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PillSeek — Free Pill Identifier, Drug Price Check & Patient Guide (FDA Data)',
    description:
      'Free pill identifier, drug price checks, and patient-friendly medication guides powered by FDA, DailyMed, and NADAC data.',
  },
}

export default function HomePage() {
  const pillarCards: PillarCard[] = [
    {
      href: '/pill/plavix-75-1171',
      iconSrc: '/logo-mark.svg',
      iconLabel: 'Pill identification',
      title: 'Identify a Pill',
      description: 'Match any tablet or capsule by imprint, color, shape, or drug name.',
      cta: 'View Plavix details →',
    },
    {
      href: '/pill/plavix-75-1171/price',
      icon: '💰',
      iconLabel: 'Medication pricing',
      title: 'Price Check',
      description: 'Compare generic vs. brand prices and see 12-month price trends — sourced from NADAC (CMS).',
      cta: 'Try Plavix →',
    },
    {
      href: '/pill/plavix-75-1171/medication-guide',
      icon: '📋',
      iconLabel: 'Patient medication guide',
      title: 'Patient Guide',
      description: 'Plain-language dosing, side effects, and what to know before taking your medication.',
      cta: 'Read Plavix guide →',
    },
  ]

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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(faqSchema(HOME_FAQS)) }}
      />

      <section className="bg-gradient-to-b from-slate-50 to-white py-8 sm:py-10 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <Image
            src="/logo-mark.svg"
            alt="PillSeek logo"
            width={68}
            height={68}
            priority
            className="mx-auto mb-4"
          />
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-slate-900">
            Free Pill Identifier, <span className="text-emerald-700">Drug Price Check</span>{' '}
            &amp; Patient Guide
          </h1>
          <p className="mt-4 text-base sm:text-lg text-slate-700">
            Know your pill. Know the price. Know how to take it.
          </p>
          <p className="mt-3 text-sm sm:text-base text-slate-600 max-w-3xl mx-auto">
            Free, FDA-sourced medication info for pill ID, price checks, and patient-friendly
            guides — no account needed.
          </p>

          <div className="mt-8 grid gap-6 md:grid-cols-10 md:items-center">
            <div className="md:col-span-7">
              <HomeSearch />
            </div>
            <div className="hidden md:flex md:col-span-3 items-center justify-center rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <svg
                viewBox="0 0 320 220"
                role="img"
                aria-label="Example pill: M321 yellow oval, NADAC price $0.04"
                className="w-full h-auto max-w-[280px]"
              >
                <line x1="96" y1="68" x2="118" y2="90" stroke="#cbd5e1" strokeWidth="1" />
                <line x1="240" y1="88" x2="208" y2="100" stroke="#cbd5e1" strokeWidth="1" />
                <line x1="96" y1="168" x2="122" y2="134" stroke="#cbd5e1" strokeWidth="1" />
                <line x1="226" y1="186" x2="202" y2="145" stroke="#10b981" strokeWidth="1" />
                <ellipse cx="160" cy="110" rx="70" ry="42" fill="#fcd34d" stroke="#d97706" strokeWidth="3" />
                <text
                  x="160"
                  y="118"
                  textAnchor="middle"
                  fontFamily="system-ui, sans-serif"
                  fontSize="28"
                  fontWeight="700"
                  fill="#78350f"
                >
                  M321
                </text>
                <g>
                  <rect x="20" y="50" rx="10" ry="10" width="108" height="28" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1" />
                  <text x="74" y="67" textAnchor="middle" fontFamily="system-ui, sans-serif" fontSize="11" fill="#475569">Color: Yellow</text>
                </g>
                <g>
                  <rect x="200" y="70" rx="10" ry="10" width="108" height="28" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1" />
                  <text x="254" y="87" textAnchor="middle" fontFamily="system-ui, sans-serif" fontSize="11" fill="#475569">Imprint: M321</text>
                </g>
                <g>
                  <rect x="20" y="156" rx="10" ry="10" width="102" height="28" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1" />
                  <text x="71" y="173" textAnchor="middle" fontFamily="system-ui, sans-serif" fontSize="11" fill="#475569">Shape: Oval</text>
                </g>
                <g>
                  <rect x="170" y="166" rx="10" ry="10" width="140" height="28" fill="#ecfdf5" stroke="#10b981" strokeWidth="1" />
                  <text x="240" y="184" textAnchor="middle" fontFamily="system-ui, sans-serif" fontSize="11" fontWeight="600" fill="#047857">$0.04 / pill (NADAC)</text>
                </g>
              </svg>
            </div>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-3 text-left">
            {pillarCards.map((card) => (
              <Link
                key={card.title}
                href={card.href}
                className="block rounded-xl border border-slate-200 bg-slate-50/90 p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md hover:border-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
              >
                {card.iconSrc ? (
                  <Image
                    src={card.iconSrc}
                    alt={card.iconLabel}
                    width={28}
                    height={28}
                    className="h-7 w-7"
                  />
                ) : (
                  <span className="text-2xl" role="img" aria-label={card.iconLabel}>
                    {card.icon ?? ''}
                  </span>
                )}
                <h3 className="mt-2.5 text-lg font-semibold text-slate-900">{card.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{card.description}</p>
                <span className="mt-2.5 inline-flex text-sm font-semibold text-emerald-700">
                  {card.cta}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white border-y border-slate-200 py-10 px-4">
        <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          {[
            { value: '10,000+', label: 'FDA-approved medications' },
            { value: 'Free', label: 'No ads · No account' },
            { value: 'Official', label: 'FDA · NADAC (CMS) · RxNorm' },
            { value: 'Weekly', label: 'Pricing data updated' },
          ].map((stat) => (
            <div key={stat.label}>
              <p className="text-3xl font-bold text-emerald-700">{stat.value}</p>
              <p className="text-slate-600 text-sm mt-1">{stat.label}</p>
            </div>
          ))}
        </div>
        <p className="max-w-4xl mx-auto mt-6 text-center text-xs sm:text-sm text-slate-500">
          PillSeek is an information service. Always consult your pharmacist or doctor before
          making medication decisions.
        </p>
      </section>

      <section className="py-14 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center text-slate-900 mb-3">
            How It Works
          </h2>
          <p className="text-center text-slate-600 mb-10 max-w-2xl mx-auto">
            Find your medication in three simple steps — no account, no fees, just fast,
            FDA-sourced answers.
          </p>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center gap-2 mb-4">
                <span className="bg-emerald-100 text-emerald-700 text-xs font-bold px-2 py-1 rounded-full">
                  STEP 1
                </span>
              </div>
              <div className="flex justify-center mb-4">
                <svg viewBox="0 0 120 80" className="w-32 h-20" aria-hidden="true">
                  <ellipse
                    cx="60"
                    cy="40"
                    rx="45"
                    ry="22"
                    fill="#fef3c7"
                    stroke="#d97706"
                    strokeWidth="2"
                  />
                  <text
                    x="40"
                    y="46"
                    fontFamily="monospace"
                    fontSize="14"
                    fontWeight="bold"
                    fill="#78350f"
                  >
                    M
                  </text>
                  <text
                    x="68"
                    y="46"
                    fontFamily="monospace"
                    fontSize="14"
                    fontWeight="bold"
                    fill="#78350f"
                  >
                    321
                  </text>
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

            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center gap-2 mb-4">
                <span className="bg-emerald-100 text-emerald-700 text-xs font-bold px-2 py-1 rounded-full">
                  STEP 2
                </span>
              </div>
              <div className="flex justify-center gap-2 mb-4">
                <svg viewBox="0 0 40 40" className="w-12 h-12" aria-hidden="true">
                  <circle cx="20" cy="20" r="15" fill="#10b981" stroke="#047857" strokeWidth="1.5" />
                </svg>
                <svg viewBox="0 0 40 40" className="w-12 h-12" aria-hidden="true">
                  <ellipse
                    cx="20"
                    cy="20"
                    rx="17"
                    ry="10"
                    fill="#3b82f6"
                    stroke="#1d4ed8"
                    strokeWidth="1.5"
                  />
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

            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center gap-2 mb-4">
                <span className="bg-emerald-100 text-emerald-700 text-xs font-bold px-2 py-1 rounded-full">
                  STEP 3
                </span>
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
        <div className="max-w-4xl mx-auto space-y-3">
          <p className="text-center text-xs sm:text-sm text-slate-500">
            Medical content reviewed by licensed pharmacists · Last updated: {HOME_LAST_UPDATED}
          </p>
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

      <PopularMedications />
      <TrendingPills />

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

      <HomeFaq />
    </>
  )
}
