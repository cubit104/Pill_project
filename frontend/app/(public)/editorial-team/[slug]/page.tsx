import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { breadcrumbSchema, safeJsonLd } from '../../../lib/structured-data'
import { fetchPublicReviewer } from '../../../lib/reviewers'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com'
).replace(/\/$/, '')

export const revalidate = 3600

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params
  const reviewer = await fetchPublicReviewer(API_BASE, slug)
  if (!reviewer) {
    return { title: 'Reviewer Not Found — PillSeek' }
  }
  const displayName = reviewer.credentials
    ? `${reviewer.name}, ${reviewer.credentials}`
    : reviewer.name
  return {
    title: `${displayName} — PillSeek Editorial Team`,
    description:
      reviewer.bio?.slice(0, 160) ??
      `Learn about ${displayName}, a member of the PillSeek editorial and medical review team.`,
    alternates: { canonical: `/editorial-team/${reviewer.slug}` },
    openGraph: {
      title: `${displayName} — PillSeek Editorial Team`,
      description:
        reviewer.bio?.slice(0, 160) ??
        `Learn about ${displayName}, a member of the PillSeek editorial team.`,
      url: `${SITE_URL}/editorial-team/${reviewer.slug}`,
      type: 'profile',
      siteName: 'PillSeek',
      ...(reviewer.avatar_url ? { images: [{ url: reviewer.avatar_url }] } : {}),
    },
  }
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

function getSafeLinkedInUrl(url: string | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()
    if (parsed.protocol !== 'https:') return null
    if (hostname !== 'linkedin.com' && hostname !== 'www.linkedin.com') return null
    return parsed.toString()
  } catch {
    return null
  }
}

/**
 * Validate a user-supplied URL before it's used as an href. Requires https
 * and a parseable URL. Returns null (render plain text, no link) otherwise.
 */
function getSafeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return null
    return parsed.toString()
  } catch {
    return null
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return ''
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  } catch {
    return dateStr
  }
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

export default async function ReviewerProfilePage(
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const reviewer = await fetchPublicReviewer(API_BASE, slug)
  if (!reviewer) return notFound()

  const displayName = reviewer.credentials
    ? `${reviewer.name}, ${reviewer.credentials}`
    : reviewer.name
  const initials = getInitials(reviewer.name)
  const roleLabel = ROLE_LABELS[reviewer.role ?? ''] ?? reviewer.role ?? 'Team Member'
  const badgeClass = ROLE_BADGE[reviewer.role ?? ''] ?? 'bg-slate-100 text-slate-700'
  const linkedInUrl = getSafeLinkedInUrl(reviewer.linkedin_url)

  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: 'Editorial Team', url: '/editorial-team' },
    { name: reviewer.name, url: `/editorial-team/${reviewer.slug}` },
  ])

  const education = (reviewer.education ?? []).filter(
    (edu) => edu && (edu.degree || edu.institution)
  )
  const registrations = (reviewer.registrations ?? []).filter(
    (reg) => reg && (reg.title || reg.board)
  )
  const affiliations = (reviewer.same_as ?? [])
    .map((url) => getSafeExternalUrl(url))
    .filter((url): url is string => Boolean(url))

  const alumniOf = education
    .filter((edu) => edu.institution)
    .map((edu) => {
      const url = getSafeExternalUrl(edu.url)
      return {
        '@type': 'EducationalOrganization',
        name: edu.institution,
        ...(url ? { url } : {}),
      }
    })

  const hasCredential = [
    ...registrations
      .filter((reg) => reg.title && reg.board)
      .map((reg) => {
        const url = getSafeExternalUrl(reg.url)
        return {
          '@type': 'EducationalOccupationalCredential',
          credentialCategory: 'license',
          name: reg.title,
          recognizedBy: {
            '@type': 'Organization',
            name: reg.board,
            ...(url ? { url } : {}),
          },
        }
      }),
    ...education
      .filter((edu) => edu.degree && edu.institution)
      .map((edu) => ({
        '@type': 'EducationalOccupationalCredential',
        credentialCategory: 'degree',
        name: edu.degree,
        recognizedBy: {
          '@type': 'EducationalOrganization',
          name: edu.institution,
        },
      })),
  ]

  const sameAs = [...affiliations, ...(linkedInUrl ? [linkedInUrl] : [])]

  const personJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: displayName,
    url: `${SITE_URL}/editorial-team/${reviewer.slug}`,
    jobTitle: roleLabel,
    ...(reviewer.credentials ? { honorificSuffix: reviewer.credentials } : {}),
    ...(reviewer.specialty ? { description: reviewer.specialty, knowsAbout: reviewer.specialty } : {}),
    ...(reviewer.avatar_url ? { image: reviewer.avatar_url } : {}),
    ...(sameAs.length > 0 ? { sameAs } : {}),
    ...(alumniOf.length > 0 ? { alumniOf } : {}),
    ...(hasCredential.length > 0 ? { hasCredential } : {}),
    worksFor: {
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
        dangerouslySetInnerHTML={{ __html: safeJsonLd(personJsonLd) }}
      />

      <main className="min-h-screen bg-slate-50">
        <div className="max-w-3xl mx-auto px-4 py-10 sm:px-6 lg:px-8">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-2 text-sm text-slate-500 mb-8 flex-wrap" aria-label="Breadcrumb">
            <Link href="/" className="hover:text-emerald-700 transition-colors">Home</Link>
            <span aria-hidden="true">›</span>
            <Link href="/editorial-team" className="hover:text-emerald-700 transition-colors">Editorial Team</Link>
            <span aria-hidden="true">›</span>
            <span className="text-slate-900 font-medium">{reviewer.name}</span>
          </nav>

          {/* Profile header */}
          <header className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 mb-8">
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
              {/* Avatar */}
              <div className="relative flex-shrink-0 w-32 h-32 rounded-full overflow-hidden bg-emerald-100 flex items-center justify-center">
                {reviewer.avatar_url ? (
                  <Image
                    src={reviewer.avatar_url}
                    alt={reviewer.name}
                    fill
                    className="object-cover"
                    sizes="128px"
                    priority
                  />
                ) : (
                  <span className="text-4xl font-bold text-emerald-700">{initials}</span>
                )}
              </div>

              <div className="flex-1 text-center sm:text-left">
                <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">{displayName}</h1>
                <span className={`inline-block mt-2 px-3 py-1 rounded-full text-sm font-medium ${badgeClass}`}>
                  {roleLabel}
                </span>
                {reviewer.specialty && (
                  <p className="mt-2 text-slate-500">{reviewer.specialty}</p>
                )}
                {linkedInUrl && (
                  <a
                    href={linkedInUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 mt-3 text-sm text-blue-600 hover:underline"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                    </svg>
                    Connect on LinkedIn
                  </a>
                )}
              </div>
            </div>
          </header>

          {/* Bio */}
          {reviewer.bio && (
            <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 mb-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-3">About</h2>
              <p className="text-slate-600 leading-relaxed">{reviewer.bio}</p>
            </section>
          )}

          {/* Education */}
          {education.length > 0 && (
            <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 mb-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Education</h2>
              <ul className="space-y-2">
                {education.map((edu, i) => {
                  const url = getSafeExternalUrl(edu.url)
                  return (
                    <li key={i} className="flex items-start gap-2 text-slate-600">
                      <span className="mt-1 text-emerald-500 flex-shrink-0">•</span>
                      <span>
                        {edu.degree && <>{edu.degree}</>}
                        {edu.degree && edu.institution && ' — '}
                        {edu.institution && (
                          url ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-emerald-700 hover:underline"
                            >
                              {edu.institution}
                            </a>
                          ) : (
                            edu.institution
                          )
                        )}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {/* Licences & Registrations */}
          {(registrations.length > 0 || reviewer.license_info) && (
            <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 mb-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Licences &amp; Registrations</h2>
              <ul className="space-y-2">
                {registrations.map((reg, i) => {
                  const url = getSafeExternalUrl(reg.url)
                  return (
                    <li key={i} className="flex items-start gap-2 text-slate-600">
                      <span className="mt-1 text-emerald-500 flex-shrink-0">•</span>
                      <span>
                        {reg.title && <>{reg.title}</>}
                        {reg.title && reg.board && ' — '}
                        {reg.board && (
                          url ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-emerald-700 hover:underline"
                            >
                              {reg.board}
                            </a>
                          ) : (
                            reg.board
                          )
                        )}
                      </span>
                    </li>
                  )
                })}
                {reviewer.license_info && (
                  <li className="flex items-start gap-2 text-slate-600">
                    <span className="mt-1 text-emerald-500 flex-shrink-0">•</span>
                    <span>Licence #{reviewer.license_info}</span>
                  </li>
                )}
              </ul>
            </section>
          )}

          {/* Professional profiles / Affiliations */}
          {affiliations.length > 0 && (
            <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 mb-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Professional Profiles</h2>
              <ul className="space-y-2">
                {affiliations.map((url, i) => (
                  <li key={i} className="flex items-start gap-2 text-slate-600">
                    <span className="mt-1 text-emerald-500 flex-shrink-0">•</span>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-emerald-700 hover:underline break-all"
                    >
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Footer */}
          <div className="mt-8">
            {reviewer.updated_at && (
              <p className="text-xs text-slate-400 mb-6">
                Last updated on {formatDate(reviewer.updated_at)}
              </p>
            )}
            <hr className="border-slate-200 mb-6" />
            <p className="text-sm text-slate-500">
              The PillSeek editorial team is responsible for creating accurate drug identification
              content sourced directly from FDA, DailyMed, and RxNorm databases.
            </p>
          </div>
        </div>
      </main>
    </>
  )
}
