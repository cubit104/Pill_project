import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { breadcrumbSchema, safeJsonLd } from '../../lib/structured-data'
import { fetchPublicReviewers } from '../../lib/reviewers'
import type { PublicReviewer } from '../../lib/reviewers'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com'
).replace(/\/$/, '')

export const revalidate = 3600

export const metadata: Metadata = {
  title: 'Editorial & Medical Review Team — PillSeek',
  description:
    'Meet the pharmacists, physicians, and medical writers who review and verify content on PillSeek. Our editorial team ensures every piece of drug information is accurate and sourced from FDA-approved data.',
  alternates: { canonical: '/editorial-team' },
  openGraph: {
    title: 'Editorial & Medical Review Team — PillSeek',
    description:
      'Meet the pharmacists, physicians, and medical writers who review and verify content on PillSeek.',
    url: `${SITE_URL}/editorial-team`,
    type: 'website',
    siteName: 'PillSeek',
  },
}

const ROLE_LABELS: Record<string, string> = {
  medical_reviewer: 'Medical Reviewer',
  editor: 'Editor',
  author: 'Author',
  fact_checker: 'Fact Checker',
}

const ROLE_BADGE: Record<string, string> = {
  medical_reviewer: 'bg-emerald-100 text-emerald-700',
  editor: 'bg-blue-100 text-blue-700',
  author: 'bg-purple-100 text-purple-700',
  fact_checker: 'bg-amber-100 text-amber-700',
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function ReviewerCard({ reviewer }: { reviewer: PublicReviewer }) {
  const initials = getInitials(reviewer.full_name)
  const displayName = reviewer.credentials
    ? `${reviewer.full_name}, ${reviewer.credentials}`
    : reviewer.full_name
  const roleLabel = ROLE_LABELS[reviewer.role ?? ''] ?? reviewer.role ?? 'Team Member'
  const badgeClass = ROLE_BADGE[reviewer.role ?? ''] ?? 'bg-slate-100 text-slate-700'

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col gap-4 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-4">
        {/* Avatar */}
        <div className="relative flex-shrink-0 w-24 h-24 rounded-full overflow-hidden bg-emerald-100 flex items-center justify-center">
          {reviewer.photo_url ? (
            <Image
              src={reviewer.photo_url}
              alt={reviewer.full_name}
              fill
              className="object-cover"
              sizes="96px"
            />
          ) : (
            <span className="text-2xl font-bold text-emerald-700">{initials}</span>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-slate-900 leading-snug">{displayName}</h2>
          <span className={`inline-block mt-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${badgeClass}`}>
            {roleLabel}
          </span>
          {reviewer.specialty && (
            <p className="mt-1 text-sm text-slate-500">{reviewer.specialty}</p>
          )}
          {reviewer.linkedin_url && (
            <a
              href={reviewer.linkedin_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-1 text-xs text-blue-600 hover:underline"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
              </svg>
              LinkedIn
            </a>
          )}
        </div>
      </div>

      {reviewer.bio && (
        <p className="text-sm text-slate-600 line-clamp-2">{reviewer.bio}</p>
      )}

      <Link
        href={`/editorial-team/${reviewer.slug}`}
        className="mt-auto inline-flex items-center text-sm font-medium text-emerald-700 hover:text-emerald-800 transition-colors"
      >
        View Profile →
      </Link>
    </div>
  )
}

export default async function EditorialTeamPage() {
  const reviewers = await fetchPublicReviewers(API_BASE)

  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: 'Editorial Team', url: '/editorial-team' },
  ])

  const aboutPageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    name: 'Editorial & Medical Review Team — PillSeek',
    url: `${SITE_URL}/editorial-team`,
    description:
      'Meet the pharmacists, physicians, and medical writers who review and verify content on PillSeek.',
    publisher: {
      '@type': 'Organization',
      name: 'PillSeek',
      url: SITE_URL,
    },
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbs) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(aboutPageJsonLd) }}
      />

      <main className="min-h-screen bg-slate-50">
        <div className="max-w-6xl mx-auto px-4 py-10 sm:px-6 lg:px-8">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-2 text-sm text-slate-500 mb-8" aria-label="Breadcrumb">
            <Link href="/" className="hover:text-emerald-700 transition-colors">Home</Link>
            <span aria-hidden="true">›</span>
            <span className="text-slate-900 font-medium">Editorial Team</span>
          </nav>

          {/* Header */}
          <header className="mb-10">
            <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
              Our Editorial &amp; Medical Review Team
            </h1>
            <p className="text-lg text-slate-600 max-w-3xl">
              PillSeek's content is reviewed and verified by licensed pharmacists, physicians, and
              medical writers. Our team ensures every piece of drug information is accurate,
              up-to-date, and sourced from FDA-approved data — so you can trust what you read.
            </p>
          </header>

          {/* Reviewer grid */}
          {reviewers.length > 0 ? (
            <section aria-label="Editorial team members">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {reviewers.map((reviewer) => (
                  <ReviewerCard key={reviewer.id} reviewer={reviewer} />
                ))}
              </div>
            </section>
          ) : (
            <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center">
              <p className="text-slate-600 text-lg font-medium mb-2">Meet the PillSeek Team</p>
              <p className="text-slate-500 max-w-xl mx-auto">
                Our editorial and engineering team curates drug information sourced directly from
                FDA NDC Directory, DailyMed, and RxNorm. We are actively growing our team of
                licensed medical reviewers. Check back soon.
              </p>
            </section>
          )}

          {/* Join Our Team CTA */}
          <section className="mt-14 bg-emerald-50 rounded-xl border border-emerald-100 p-8">
            <h2 className="text-xl font-semibold text-slate-900 mb-3">Join Our Editorial Team</h2>
            <p className="text-slate-600 max-w-2xl mb-4">
              We're seeking licensed pharmacists (PharmD/RPh) and physicians to serve as medical
              reviewers for PillSeek. If you're interested in contributing to a trusted, FDA-data–
              powered drug information platform, we'd love to hear from you.
            </p>
            <a
              href="mailto:reviewers@pillseek.com"
              className="inline-flex items-center px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Contact us at reviewers@pillseek.com
            </a>
          </section>

          {/* Medical Disclaimer */}
          <section className="mt-10 border-t border-slate-200 pt-8">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Medical Disclaimer
            </h2>
            <p className="text-sm text-slate-500">
              The information provided by PillSeek is for educational and identification purposes
              only. It is not a substitute for professional medical advice, diagnosis, or treatment.
              Always consult a licensed pharmacist or physician before making any medication
              decision. All drug data is sourced from the FDA NDC Directory, DailyMed, and RxNorm.
            </p>
          </section>
        </div>
      </main>
    </>
  )
}
