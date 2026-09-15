import type { Metadata } from 'next'
import { breadcrumbSchema, faqSchema, safeJsonLd } from '../../lib/structured-data'
import FindDoctorClient, { type InitialQuery } from './FindDoctorClient'

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com').replace(/\/$/, '')

export const metadata: Metadata = {
  title: 'Find a Doctor Near You: Free Search of the US Provider Registry',
  description:
    'Find doctors, nurse practitioners, pharmacies and urgent care near you by specialty and ZIP or city. Official NPI registry data, distance-sorted, with licences, medical school, hospital affiliations, hours and website. No ads, no paid listings.',
  alternates: { canonical: '/find-a-doctor' },
  openGraph: {
    title: 'Find a Doctor Near You — PillSeek',
    description: 'Every doctor, pharmacy and urgent care clinic in the official US registry, sorted by distance from you. Free, no paid listings.',
    type: 'website',
    url: `${SITE_URL}/find-a-doctor`,
  },
}

const faqs = [
  {
    question: 'Where does this information come from?',
    answer:
      'The list comes from the US National Provider Identifier (NPI) registry run by CMS, which every practising clinician, pharmacy and clinic must keep current. Medical school, years in practice, Medicare participation, telehealth and hospital affiliations come from the public CMS Doctors and Clinicians data. Hours, website and ratings come from Google. Map positions come from the US Census geocoder.',
  },
  {
    question: 'Can I book an appointment here?',
    answer: 'Not yet. Each listing gives you the phone number, the practice website when Google has it, and directions, so you can book directly with the office.',
  },
  {
    question: 'Are nurse practitioners and physician assistants included?',
    answer: 'Yes. Choose "All providers", or pick "Nurse practitioner" or "Physician assistant" in the specialty list. They hold their own registry entries and state licences.',
  },
  {
    question: 'Why is a doctor missing or at the wrong address?',
    answer:
      'The registry shows the practice address each provider reported. Providers who moved and did not update their record show at the old address, and providers who never applied for an NPI, such as some cash-only practices, are not in the registry at all.',
  },
  {
    question: 'Does PillSeek accept payment for listings?',
    answer: 'No. Results are sorted by distance only. Nobody can pay to appear higher, and there are no sponsored entries.',
  },
]

function pick(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 60) : undefined
}

export default async function FindDoctorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const initial: InitialQuery = {
    kind: pick(sp.kind),
    specialty: pick(sp.specialty),
    zip: pick(sp.zip),
    city: pick(sp.city),
    state: pick(sp.state)?.toUpperCase().slice(0, 2),
    last: pick(sp.last),
    first: pick(sp.first),
  }
  const pageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'Find a Doctor Near You',
    url: `${SITE_URL}/find-a-doctor`,
    description: metadata.description,
    isPartOf: { '@type': 'WebSite', name: 'PillSeek', url: SITE_URL },
  }
  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: SITE_URL },
    { name: 'Find a doctor', url: `${SITE_URL}/find-a-doctor` },
  ])

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(pageJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(faqSchema(faqs)) }} />

      <div className="bg-emerald-50 border-b border-emerald-100">
        <div className="mx-auto max-w-6xl px-4 pb-10 pt-10 sm:pt-14">
          <div className="mx-auto mb-6 max-w-2xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-300 bg-white px-3 py-1 text-xs font-semibold text-emerald-800 sm:text-sm">
              <svg className="h-3.5 w-3.5 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>
              Free · Official US provider registry · No paid listings
            </span>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl">Find a doctor near you</h1>
            <p className="mt-3 text-base text-slate-600 sm:text-lg">Every doctor, nurse practitioner, pharmacy and urgent care clinic in the official US registry, sorted by distance from you.</p>
          </div>
          <FindDoctorClient initial={initial} />
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4">
        <section className="mt-12">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">What you get on every listing</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <svg className="h-6 w-6 text-emerald-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6zM9 12l2 2 4-4" /></svg>
              <h3 className="mt-3 text-lg font-semibold text-slate-900">Official, verified identity</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">Name, credentials, every specialty and state licence straight from the national provider registry. Nobody can pay to appear here.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <svg className="h-6 w-6 text-emerald-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" /></svg>
              <h3 className="mt-3 text-lg font-semibold text-slate-900">Nearest first, with directions</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">Distance from your ZIP or your location, a map of the results, and one tap to call or open directions.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <svg className="h-6 w-6 text-emerald-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9h10M7 13h6" /></svg>
              <h3 className="mt-3 text-lg font-semibold text-slate-900">The details that decide</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">Medical school and years in practice, whether they take Medicare or offer telehealth, plus the practice website, hours and Google rating.</p>
            </div>
          </div>
        </section>

        <section className="mb-16 mt-12">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Questions people ask</h2>
          <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
            {faqs.map((f) => (
              <details key={f.question} className="group px-5 py-4">
                <summary className="cursor-pointer list-none text-base font-semibold text-slate-900 marker:content-none">{f.question}</summary>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.answer}</p>
              </details>
            ))}
          </div>
          <p className="mt-6 text-xs leading-relaxed text-slate-500">
            PillSeek shows public records as published by their sources and does not endorse any provider. Confirm details with the office before visiting. ZIP geography: GeoNames (CC BY 4.0). Map data © OpenStreetMap contributors.
          </p>
        </section>
      </div>
    </>
  )
}
