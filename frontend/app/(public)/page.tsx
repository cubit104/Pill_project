import type { Metadata } from 'next'
import Image from 'next/image'
import HomeSearch from '../components/HomeSearch'
import Link from 'next/link'
import { faqSchema, websiteSchema, organizationSchema, safeJsonLd } from '../lib/structured-data'
import PopularMedications from '../components/PopularMedications'
import HomeFaq from '../components/HomeFaq'

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com'
).replace(/\/$/, '')

export const metadata: Metadata = {
  title: 'PillSeek — Free Pill Identifier, Drug Price Check & Patient Guide (FDA Data)',
  description:
    'Free pill identifier by imprint, drug name, NDC, color or shape — plus real medication prices from NADAC (CMS) and plain-language patient guides. Powered by FDA & DailyMed data. No account needed.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'PillSeek — Free Pill Identifier, Drug Price Check & Patient Guide (FDA Data)',
    description:
      'Free pill identifier by imprint, drug name, NDC, color or shape — plus real medication prices from NADAC (CMS) and plain-language patient guides. Powered by FDA & DailyMed data. No account needed.',
    url: SITE_URL,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PillSeek — Free Pill Identifier, Drug Price Check & Patient Guide (FDA Data)',
    description:
      'Free pill identifier by imprint, drug name, NDC, color or shape — plus real medication prices from NADAC (CMS) and plain-language patient guides. Powered by FDA & DailyMed data. No account needed.',
  },
}

const homeFaqs = [
  {
    question: 'How do I identify a pill by its imprint?',
    answer:
      'Every prescription pill in the U.S. has a unique imprint code stamped on it. Enter the letters and numbers exactly as they appear (e.g., "M321"), and PillSeek will match it against the FDA\'s National Drug Code (NDC) Directory. You can narrow results further by color and shape.',
  },
  {
    question: 'Does PillSeek show medication prices?',
    answer:
      'Yes. PillSeek shows pharmacy acquisition cost data from NADAC (the National Average Drug Acquisition Cost dataset published by CMS), including 12-month price trends and generic vs. brand comparisons. These are benchmark prices — your actual out-of-pocket cost will depend on your pharmacy and insurance.',
  },
  {
    question: 'Where does PillSeek get its data?',
    answer:
      'PillSeek sources data directly from the FDA National Drug Code (NDC) Directory, DailyMed, RxNorm, and NADAC (CMS). These are the same authoritative databases used by pharmacists and healthcare professionals.',
  },
  {
    question: 'Is PillSeek free? Do I need an account?',
    answer:
      'PillSeek is 100% free with no account required, no ads, and no tracking-based monetization. It is an informational service for patients, caregivers, and healthcare professionals.',
  },
  {
    question: 'Can PillSeek replace advice from my doctor or pharmacist?',
    answer:
      'No. PillSeek is an informational reference only. Always confirm pill identification and any dosing or safety questions with a licensed pharmacist or your healthcare provider. In an emergency, call 911 or Poison Control (1-800-222-1222 in the U.S.).',
  },
] as const

export default function HomePage() {
  const faqJsonLd = faqSchema(homeFaqs.map((item) => ({ question: item.question, answer: item.answer })))
  const pillarCards = [
    {
      href: '/search?q=lisinopril',
      icon: '💊',
      iconLabel: 'Pill identification',
      title: 'Identify a Pill',
      description: 'Match any tablet or capsule by imprint, color, shape, or drug name.',
      cta: 'Try Lisinopril →',
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
      href: '/search?q=metformin',
      icon: '📋',
      iconLabel: 'Patient medication guide',
      title: 'Patient Guide',
      description: 'Plain-language dosing, side effects, and what to know before taking your medication.',
      cta: 'Try Metformin →',
    },
  ] as const

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
        dangerouslySetInnerHTML={{ __html: safeJsonLd(faqJsonLd) }}
      />

      {/* Hero Section — tighter spacing */}
      <section className="bg-gradient-to-b from-slate-50 to-white py-6 sm:py-8 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="grid md:grid-cols-2 gap-8 items-center text-center md:text-left">
            <div>
              <Image
                src="/logo-mark.svg"
                alt=""
                width={68}
                height={68}
                priority
                className="mx-auto md:mx-0 mb-3"
              />
              <h1 className="text-4xl sm:text-5xl font-bold mb-3 tracking-tight text-slate-900">
                Free Pill Identifier, <span className="text-emerald-700">Drug Price Check</span> &amp; Patient Guide
              </h1>
              <p className="text-lg sm:text-xl text-slate-700 mb-3 font-medium">
                Know your pill. <span className="text-emerald-700">Know the price.</span> Know how to take it.
              </p>
              <p className="text-slate-600 text-base mb-2 max-w-2xl mx-auto md:mx-0">
                Identify any medication by imprint, drug name, NDC, color, or shape — and see real medication prices sourced from NADAC (CMS) plus patient-friendly dosing guides.
              </p>
              <p className="text-slate-500 text-sm mb-8">
                10,000+ FDA-approved medications · No account · Always free
              </p>
              <HomeSearch />
              <div className="mt-4 flex flex-wrap justify-center md:justify-start gap-2 text-sm">
                <span className="text-slate-500">Popular:</span>
                {[
                  { label: 'Lisinopril', href: '/search?q=lisinopril' },
                  { label: 'Metformin', href: '/search?q=metformin' },
                  { label: 'Atorvastatin', href: '/search?q=atorvastatin' },
                  { label: 'Ibuprofen 800', href: '/search?q=ibuprofen+800' },
                  { label: 'M367', href: '/search?q=M367' },
                ].map((p) => (
                  <Link
                    key={p.label}
                    href={p.href}
                    className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors"
                  >
                    {p.label}
                  </Link>
                ))}
              </div>
            </div>
            <div className="hidden md:block">
              <svg viewBox="0 0 480 360" className="w-full max-w-md mx-auto" aria-hidden="true">
                <rect x="56" y="44" width="368" height="268" rx="24" fill="#ffffff" stroke="#cbd5e1" strokeWidth="2" />
                <ellipse cx="220" cy="168" rx="96" ry="46" fill="#fde68a" stroke="#d97706" strokeWidth="3" />
                <text x="175" y="177" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="30" fontWeight="700" fill="#78350f">M321</text>
                <line x1="124" y1="130" x2="76" y2="105" stroke="#64748b" strokeWidth="2" />
                <rect x="18" y="84" width="116" height="32" rx="10" fill="#f8fafc" stroke="#cbd5e1" />
                <text x="30" y="104" fontSize="14" fill="#334155">Color: Yellow</text>
                <line x1="160" y1="202" x2="84" y2="228" stroke="#64748b" strokeWidth="2" />
                <rect x="20" y="214" width="110" height="32" rx="10" fill="#f8fafc" stroke="#cbd5e1" />
                <text x="32" y="234" fontSize="14" fill="#334155">Shape: Oval</text>
                <line x1="284" y1="170" x2="402" y2="132" stroke="#64748b" strokeWidth="2" />
                <rect x="320" y="112" width="134" height="32" rx="10" fill="#f8fafc" stroke="#cbd5e1" />
                <text x="332" y="132" fontSize="14" fill="#334155">Imprint: M321</text>
                <rect x="272" y="226" width="172" height="42" rx="12" fill="#ecfdf5" stroke="#6ee7b7" />
                <text x="288" y="252" fontSize="16" fill="currentColor" className="text-emerald-700">$0.04 / pill (NADAC)</text>
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
                <span className="text-2xl" role="img" aria-label={card.iconLabel}>{card.icon}</span>
                <h3 className="mt-2.5 text-lg font-semibold text-slate-900">{card.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{card.description}</p>
                <span className="mt-2.5 inline-flex text-sm font-semibold text-emerald-700">{card.cta}</span>
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
          PillSeek is an information service. Always consult your pharmacist or doctor before making medication decisions.
        </p>
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
          {/* TODO: bump on content review */}
          <p className="text-center text-xs text-slate-500 mb-4">
            Medical content reviewed by licensed pharmacists ·{' '}
            <span className="font-medium text-slate-600">Last updated: November 2025</span>{' '}
            · <Link href="/about" className="underline hover:text-slate-700">About our editorial process</Link>
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

      <section className="py-12 px-4 bg-slate-50 border-t border-slate-200">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-slate-900 text-center mb-3">Frequently Asked Questions</h2>
          <p className="text-slate-600 text-center max-w-2xl mx-auto mb-8">
            Common questions about pill identification, pricing data, and how PillSeek works.
          </p>
          <HomeFaq items={homeFaqs} />
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
