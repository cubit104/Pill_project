import type { Metadata } from 'next'
import Link from 'next/link'
import { breadcrumbSchema, faqSchema, safeJsonLd } from '../../lib/structured-data'

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com').replace(/\/$/, '')

export const metadata: Metadata = {
  title: 'Free Medicine Cabinet & Pill Reminder App',
  description:
    'Save the pills you take, get dose and refill reminders, check your medicines for interactions, and print a medication list for your doctor. Free, synced between pillseek.com and the PillSeek app.',
  alternates: { canonical: '/medicine-cabinet' },
  openGraph: {
    title: 'Free Medicine Cabinet & Pill Reminder — PillSeek',
    description:
      'Save your pills, set reminders, track refills, check interactions, and print a doctor sheet. One free account for the website and the app.',
    type: 'website',
    url: `${SITE_URL}/medicine-cabinet`,
  },
}

const faqs = [
  {
    question: 'Is the PillSeek medicine cabinet free?',
    answer: 'Yes. The cabinet, reminders, refill tracking, interaction check, and doctor sheet are free. Searching PillSeek never needs an account; the cabinet needs one only so your list follows you between devices.',
  },
  {
    question: 'How do I sign in?',
    answer: 'With your email and a 6-digit code we send you. There is no password to create or remember. The same email works on pillseek.com and in the PillSeek app.',
  },
  {
    question: 'Who can see my medicine list?',
    answer: 'Only you. Your cabinet is stored under your account and protected by row-level security in our database. PillSeek staff can see how many members exist, never what anyone saved. You can delete your account and everything in it at any time from the cabinet page.',
  },
  {
    question: 'How do refill reminders work?',
    answer: 'Tell the cabinet how many pills you have. Using your reminder schedule, it counts down the days of supply, shows it on the pill, and the app notifies you a few days before you run out. Tap "I refilled" after a pharmacy visit to reset the count.',
  },
  {
    question: 'What is the doctor sheet?',
    answer: 'A one-page list of every medicine in your cabinet with strength, imprint, schedule, and supply. Print it or save it as a PDF from the website, or share it from the app, so your doctor or pharmacist sees exactly what you take.',
  },
  {
    question: 'Does it check my medicines for interactions?',
    answer: 'Yes. One tap runs every pill in your cabinet through the PillSeek drug interaction checker, including food and condition warnings. Results are informational; always confirm with a pharmacist.',
  },
]

const features: { title: string; body: string }[] = [
  { title: 'Save the pills you take', body: 'Add any pill from its PillSeek page. Name, strength, imprint, and photo are kept together so you always know which one is which.' },
  { title: 'Dose reminders', body: 'Pick times and days. The PillSeek app reminds you on your phone, with Taken and Skip buttons right on the notification.' },
  { title: 'Refill tracking', body: 'Enter how many pills you have and see the days of supply left. Get a nudge before you run out, then reset with one tap after a refill.' },
  { title: 'Interaction check', body: 'Check every medicine in your cabinet against each other in one go, including food and condition warnings.' },
  { title: 'Doctor sheet', body: 'Print or share a clean medication list for appointments, hospital visits, or a caregiver.' },
  { title: 'Synced and private', body: 'One account for the website and the app. Only you can see your list, and you can delete it all whenever you want.' },
]

export default function MedicineCabinetPage() {
  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: 'Medicine Cabinet', url: '/medicine-cabinet' },
  ])
  const appJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'PillSeek Medicine Cabinet',
    url: `${SITE_URL}/cabinet`,
    applicationCategory: 'HealthApplication',
    operatingSystem: 'Web, iOS, Android',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    description: metadata.description,
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(faqSchema(faqs)) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(appJsonLd) }} />

      <div className="max-w-4xl mx-auto px-4 py-12">
        <nav aria-label="Breadcrumb" className="mb-6">
          <ol className="flex items-center gap-1 text-sm text-slate-500">
            <li><Link href="/" className="hover:text-sky-700">Home</Link></li>
            <li aria-hidden="true" className="select-none">›</li>
            <li className="text-slate-700 font-medium">Medicine Cabinet</li>
          </ol>
        </nav>

        <section className="text-center">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">Your free medicine cabinet, with reminders</h1>
          <p className="mt-4 text-lg text-slate-600 max-w-2xl mx-auto">
            Save the pills you take, get dose and refill reminders, check them for interactions, and print a list for your doctor. Free on pillseek.com and in the PillSeek app.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/cabinet" className="inline-flex items-center rounded-lg bg-emerald-600 px-5 py-3 text-base font-semibold text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500">
              Open my cabinet
            </Link>
            <Link href="/search" className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-5 py-3 text-base font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-500">
              Find a pill first
            </Link>
          </div>
          <p className="mt-3 text-sm text-slate-500">Sign in with your email and a 6-digit code. No password, no forms.</p>
        </section>

        <section className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">{f.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.body}</p>
            </div>
          ))}
        </section>

        <section className="mt-12 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-800 mb-3">How it works</h2>
          <ol className="list-decimal space-y-2 pl-5 text-slate-700 leading-relaxed">
            <li>Find your pill by imprint, name, NDC, or a <Link href="/identify" className="text-emerald-700 underline">photo</Link>.</li>
            <li>On the pill page, choose <strong>Save to my cabinet</strong> and sign in with the emailed code.</li>
            <li>Set a reminder and enter how many pills you have.</li>
            <li>Open <Link href="/cabinet" className="text-emerald-700 underline">My cabinet</Link> any time to check interactions or print your doctor sheet.</li>
          </ol>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-4">Frequently asked questions</h2>
          <div className="space-y-4">
            {faqs.map((f) => (
              <details key={f.question} className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <summary className="cursor-pointer text-base font-semibold text-slate-900">{f.question}</summary>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">{f.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <p className="mt-10 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          The cabinet is a personal organizer, not medical advice. Always confirm doses and interactions with your pharmacist or doctor.{' '}
          <Link href="/medical-disclaimer" className="underline">Read the full disclaimer</Link>.
        </p>
      </div>
    </>
  )
}
