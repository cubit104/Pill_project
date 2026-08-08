import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EducationEntry {
  institution: string
  degree: string
}

interface RegistrationEntry {
  title: string
  board: string
  url?: string
}

interface ReviewerPublic {
  id: number
  slug: string
  name: string
  credentials?: string | null
  role?: string | null
  specialty?: string | null
  linkedin_url?: string | null
  bio?: string | null
  education?: EducationEntry[] | null
  registrations?: RegistrationEntry[] | null
  license_info?: string | null
  same_as?: string[] | null
  avatar_url?: string | null
  updated_at?: string | null
  is_active?: boolean
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function getReviewer(slug: string): Promise<ReviewerPublic | null> {
  const apiBase =
    process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || ''
  const url = `${apiBase}/api/reviewers/${encodeURIComponent(slug)}`
  try {
    const res = await fetch(url, { next: { revalidate: 3600 } })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`API error ${res.status}`)
    const data: ReviewerPublic = await res.json()
    return data
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  if (process.env.ENABLE_REVIEWER_PUBLIC !== 'true') {
    return { robots: { index: false, follow: false } }
  }
  const { slug } = await params
  const reviewer = await getReviewer(slug)
  const displayName = reviewer
    ? reviewer.credentials
      ? `${reviewer.name}, ${reviewer.credentials}`
      : reviewer.name
    : 'Reviewer Profile'
  return {
    title: displayName,
    description: reviewer?.bio?.slice(0, 160) ?? undefined,
    robots: { index: false, follow: false },
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROLE_LABELS: Record<string, string> = {
  medical_reviewer: 'Medical Reviewer',
  author: 'Author',
  editor: 'Editor',
  fact_checker: 'Fact Checker',
}

function safeList<T>(val: T[] | null | undefined): T[] {
  return Array.isArray(val) ? val : []
}

function formatDate(iso?: string | null): string | null {
  if (!iso) return null
  try {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date(iso))
  } catch {
    return null
  }
}

function isSafeUrl(href: string): boolean {
  try {
    const { protocol } = new URL(href)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

function domainLabel(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, '')
  } catch {
    return href
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function ReviewerProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  // Feature flag guard
  if (process.env.ENABLE_REVIEWER_PUBLIC !== 'true') {
    notFound()
  }

  const { slug } = await params
  const reviewer = await getReviewer(slug)
  if (!reviewer) notFound()

  const education = safeList(reviewer.education)
  const registrations = safeList(reviewer.registrations)
  const sameAs = safeList(reviewer.same_as).filter(isSafeUrl)
  const roleLabel = ROLE_LABELS[reviewer.role ?? ''] ?? reviewer.role ?? ''
  const updatedAt = formatDate(reviewer.updated_at)
  const displayName = reviewer.credentials
    ? `${reviewer.name}, ${reviewer.credentials}`
    : reviewer.name

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ------------------------------------------------------------------ */}
      {/* Top bar */}
      {/* ------------------------------------------------------------------ */}
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 h-12 flex items-center">
          <Link
            href="/"
            className="flex items-center gap-1 hover:opacity-80 transition-opacity focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 rounded"
            aria-label="PillSeek home"
          >
            <img
              src="/logo-mark.svg"
              alt=""
              width={36}
              height={36}
              className="h-8 w-8 object-contain"
            />
            <span className="text-xl font-extrabold tracking-tight">
              <span className="text-slate-900">Pill</span>
              <span className="text-emerald-700">Seek</span>
            </span>
          </Link>
        </div>
      </div>

      <main className="max-w-4xl mx-auto px-4 py-10 space-y-8">
        {/* ---------------------------------------------------------------- */}
        {/* Hero card */}
        {/* ---------------------------------------------------------------- */}
        <section
          aria-label="Reviewer profile"
          className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden"
        >
          {/* Gradient header band */}
          <div className="h-24 bg-gradient-to-r from-emerald-700 to-emerald-500" />

          <div className="px-6 pb-8">
            {/* Avatar */}
            <div className="-mt-14 mb-4">
              {reviewer.avatar_url ? (
                <Image
                  src={reviewer.avatar_url}
                  alt={`Photo of ${reviewer.name}`}
                  width={112}
                  height={112}
                  className="w-28 h-28 rounded-full object-cover ring-4 ring-white shadow-md"
                  priority
                />
              ) : (
                <div
                  aria-label={`Avatar placeholder for ${reviewer.name}`}
                  className="w-28 h-28 rounded-full ring-4 ring-white shadow-md bg-emerald-100 flex items-center justify-center"
                >
                  <span className="text-4xl font-bold text-emerald-700 select-none">
                    {reviewer.name.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
            </div>

            {/* Name + credentials */}
            <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 leading-tight">
              {displayName}
            </h1>

            {/* Role badge + specialty */}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {roleLabel && (
                <span className="inline-flex items-center px-3 py-0.5 rounded-full text-sm font-semibold bg-emerald-100 text-emerald-800">
                  {roleLabel}
                </span>
              )}
              {reviewer.specialty && (
                <span className="text-slate-500 text-sm">{reviewer.specialty}</span>
              )}
            </div>

            {/* LinkedIn */}
            {reviewer.linkedin_url && isSafeUrl(reviewer.linkedin_url) && (
              <div className="mt-4">
                <a
                  href={reviewer.linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${reviewer.name} on LinkedIn (opens in new tab)`}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-emerald-400 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {/* LinkedIn icon */}
                  <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="w-4 h-4 text-[#0A66C2]"
                    aria-hidden="true"
                  >
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                  </svg>
                  LinkedIn
                </a>
              </div>
            )}
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* About / Bio */}
        {/* ---------------------------------------------------------------- */}
        {reviewer.bio && (
          <section
            aria-labelledby="about-heading"
            className="bg-white rounded-2xl shadow-sm border border-slate-100 px-6 py-7"
          >
            <h2
              id="about-heading"
              className="text-xl font-bold text-slate-900 mb-4"
            >
              About
            </h2>
            <p className="text-slate-700 leading-relaxed text-lg whitespace-pre-line">
              {reviewer.bio}
            </p>
          </section>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Education */}
        {/* ---------------------------------------------------------------- */}
        {education.length > 0 && (
          <section
            aria-labelledby="education-heading"
            className="bg-white rounded-2xl shadow-sm border border-slate-100 px-6 py-7"
          >
            <h2
              id="education-heading"
              className="text-xl font-bold text-slate-900 mb-5"
            >
              Education
            </h2>
            <ul className="space-y-3">
              {education.map((edu, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="mt-1.5 shrink-0 w-2 h-2 rounded-full bg-emerald-500" />
                  <div>
                    <p className="font-semibold text-slate-900">{edu.degree}</p>
                    <p className="text-slate-500 text-sm">{edu.institution}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Registrations / Certifications */}
        {/* ---------------------------------------------------------------- */}
        {registrations.length > 0 && (
          <section
            aria-labelledby="registrations-heading"
            className="bg-white rounded-2xl shadow-sm border border-slate-100 px-6 py-7"
          >
            <h2
              id="registrations-heading"
              className="text-xl font-bold text-slate-900 mb-5"
            >
              Registrations &amp; Certifications
            </h2>
            <ul className="space-y-3">
              {registrations.map((reg, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="mt-1.5 shrink-0 w-2 h-2 rounded-full bg-emerald-500" />
                  <div>
                    <p className="font-semibold text-slate-900">{reg.title}</p>
                    <p className="text-slate-500 text-sm">{reg.board}</p>
                    {reg.url && isSafeUrl(reg.url) && (
                      <a
                        href={reg.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Verify ${reg.title} (opens in new tab)`}
                        className="text-emerald-700 hover:underline text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 rounded"
                      >
                        Verify ↗
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* License info */}
        {/* ---------------------------------------------------------------- */}
        {reviewer.license_info && (
          <section
            aria-labelledby="license-heading"
            className="bg-emerald-50 border border-emerald-200 rounded-2xl px-6 py-6"
          >
            <h2
              id="license-heading"
              className="text-lg font-bold text-emerald-900 mb-2"
            >
              License Information
            </h2>
            <p className="text-emerald-800 text-sm leading-relaxed">
              {reviewer.license_info}
            </p>
          </section>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Professional profiles / same_as */}
        {/* ---------------------------------------------------------------- */}
        {sameAs.length > 0 && (
          <section
            aria-labelledby="profiles-heading"
            className="bg-white rounded-2xl shadow-sm border border-slate-100 px-6 py-7"
          >
            <h2
              id="profiles-heading"
              className="text-xl font-bold text-slate-900 mb-5"
            >
              Professional Profiles
            </h2>
            <ul className="space-y-2">
              {sameAs.map((href, i) => (
                <li key={i}>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-emerald-700 hover:underline text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 rounded"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-4 h-4"
                      aria-hidden="true"
                    >
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                    {domainLabel(href)}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Footer trust block */}
        {/* ---------------------------------------------------------------- */}
        <footer className="border-t border-slate-200 pt-6 pb-4 text-sm text-slate-500 space-y-1">
          <p>
            Content reviewed by licensed healthcare professionals.{' '}
            <Link
              href="/medical-disclaimer"
              className="text-emerald-700 hover:underline"
            >
              Read our medical disclaimer.
            </Link>
          </p>
          {updatedAt && <p>Last updated: {updatedAt}</p>}
        </footer>
      </main>
    </div>
  )
}
