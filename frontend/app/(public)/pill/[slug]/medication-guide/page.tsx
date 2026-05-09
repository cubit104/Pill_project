import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { fetchPill, API_BASE } from '../../lib'

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com'
).replace(/\/$/, '')

// ── Types ──────────────────────────────────────────────────────────────────

interface GuideSection {
  overview: string | null
  [key: string]: string | null
}

interface MedicationGuide {
  rxcui: string | null
  ndc: string | null
  generic_name: string | null
  brand_name: string | null
  has_boxed_warning: boolean
  sections: GuideSection
  source_url: string | null
  fetched_at: string | null
  disclaimer: string | null
}

type GuideResult =
  | { status: 'ok'; guide: MedicationGuide }
  | { status: 'not_found' }
  | { status: 'error' }
  | { status: 'no_identifiers' }

// ── Data fetching ──────────────────────────────────────────────────────────

async function fetchMedicationGuide(
  rxcui: string | undefined,
  ndc: string | undefined
): Promise<GuideResult> {
  if (!rxcui && !ndc) {
    return { status: 'no_identifiers' }
  }

  const url = rxcui
    ? `${API_BASE}/api/drugs/${encodeURIComponent(rxcui)}/guide`
    : `${API_BASE}/api/drugs/by-ndc/${encodeURIComponent(ndc!)}/guide`

  try {
    const res = await fetch(url, { next: { revalidate: 86400 } })
    if (res.status === 404 || res.status === 400) return { status: 'not_found' }
    if (!res.ok) return { status: 'error' }
    const guide = await res.json()
    return { status: 'ok', guide }
  } catch {
    return { status: 'error' }
  }
}

// ── Text formatter ─────────────────────────────────────────────────────────

const BOXED_WARNING_SNIPPET_LENGTH = 300

/**
 * Splits the raw SPL Medication Guide text (whitespace-collapsed) into
 * semantic chunks and renders them as structured React nodes.
 *
 * Strategy: split on recognizable section-break tokens rather than
 * newlines (which are lost in the collapsed string), then classify each
 * chunk as a header, numbered list, bullet list, or paragraph.
 */
function formatMedGuideText(raw: string): ReactNode {
  // 1. Strip the preamble up to the start of real guide content.
  //    Look for the first occurrence of anchor phrases.
  const anchorRe = /(?:Read this Medication Guide|MEDICATION GUIDE|Patient Information|PATIENT INFORMATION)/i
  const anchorMatch = anchorRe.exec(raw)
  let text = anchorMatch ? raw.slice(anchorMatch.index) : raw

  // 2. Remove the very first "MEDICATION GUIDE" / "SPL MEDGUIDE" title line.
  text = text.replace(/^(?:SPL\s+MEDGUIDE\s+)?MEDICATION\s+GUIDE\s*/i, '').trim()

  // 3. Split on section-break patterns into raw chunks.
  //    We inject a marker before each recognised boundary so we can split cleanly.
  const MARKER = '\x00'

  // Header keyword patterns — shared between split-injection and isHeader classification.
  // Using the same set avoids dual-maintenance.
  const QUESTION_KEYWORDS = 'What|Who|How|Why|When'
  const QUESTION_RE = new RegExp(`(^| )(${QUESTION_KEYWORDS}) ([^?]+\\?)`, 'g')
  const ALLCAPS_RE = /([^A-Z])([A-Z]{2,}(?:\s+[A-Z]{2,}){2,})(?=[:\s])/g

  // Question-type headers: match after space or at string start; content is anything up to `?`.
  text = text.replace(
    QUESTION_RE,
    (_m, pre, kw, rest) => `${pre}${MARKER}${kw} ${rest}`,
  )

  // Numbered list items (1. 2. 3. …) — preserve the leading space so no words run together.
  // Does not restrict the following character to uppercase.
  text = text.replace(/(\s)(\d{1,2})\.\s+(?=\S)/g, (_m, sp, n) => `${sp}${MARKER}${n}. `)

  // ALL-CAPS phrases of ≥ 3 words as section headers (e.g. "WARNINGS AND PRECAUTIONS")
  text = text.replace(ALLCAPS_RE, (_m, pre, caps) => `${pre}${MARKER}${caps}`)

  const chunks = text.split(MARKER).map((c) => c.trim()).filter(Boolean)

  // 4. Classify and render each chunk.
  const nodes: ReactNode[] = []
  let numberedItems: string[] = []
  let bulletItems: string[] = []

  const flushNumbered = (key: string) => {
    if (numberedItems.length === 0) return
    nodes.push(
      <ol key={`ol-${key}`} className="list-decimal list-inside space-y-1 text-sm text-slate-700 ml-2 mb-3">
        {numberedItems.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ol>,
    )
    numberedItems = []
  }

  const flushBullets = (key: string) => {
    if (bulletItems.length === 0) return
    nodes.push(
      <ul key={`ul-${key}`} className="list-disc list-inside space-y-1 text-sm text-slate-700 ml-2 mb-3">
        {bulletItems.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>,
    )
    bulletItems = []
  }

  // isHeader mirrors the injection patterns above so the two stay in sync.
  const isHeader = (s: string) =>
    new RegExp(`^(${QUESTION_KEYWORDS}) `, 'i').test(s) ||
    /^[A-Z]{2,}(?:\s+[A-Z]{2,}){2,}/.test(s) ||
    s.trim().endsWith('?')

  const numberedRe = /^(\d{1,2})\.\s+([\s\S]*)/

  chunks.forEach((chunk, idx) => {
    const numberedMatch = numberedRe.exec(chunk)

    if (numberedMatch) {
      flushBullets(String(idx))
      numberedItems.push(numberedMatch[2].trim())
      return
    }

    if (chunk.startsWith('-') || chunk.startsWith('•')) {
      flushNumbered(String(idx))
      bulletItems.push(chunk.replace(/^[-•]\s*/, '').trim())
      return
    }

    // Flush any open lists before a header or paragraph
    flushNumbered(String(idx))
    flushBullets(String(idx))

    if (isHeader(chunk)) {
      nodes.push(
        <h3 key={`h-${idx}`} className="text-base font-semibold text-slate-800 mt-6 mb-2">
          {chunk.replace(/:$/, '')}
        </h3>,
      )
    } else {
      nodes.push(
        <p key={`p-${idx}`} className="text-sm text-slate-700 leading-relaxed mb-3 whitespace-pre-wrap">
          {chunk}
        </p>,
      )
    }
  })

  // Flush any trailing lists
  flushNumbered('end')
  flushBullets('end')

  return <>{nodes}</>
}

// ── UI components ──────────────────────────────────────────────────────────

function PoisonControlCallout() {
  return (
    <div
      className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-xs text-slate-600 mb-6 flex items-center gap-3"
      role="note"
      aria-label="Poison control information"
    >
      <span aria-hidden="true">☎</span>
      <span className="flex items-center gap-2">
        <span>
          Poison Control:{' '}
          <a href="tel:18002221222" className="font-semibold hover:underline">
            1-800-222-1222
          </a>
        </span>
        <span aria-hidden="true" className="text-slate-300">|</span>
        <span>
          Emergency:{' '}
          <a href="tel:911" className="font-semibold hover:underline">
            911
          </a>
        </span>
      </span>
    </div>
  )
}

function BoxedWarningBanner({ overviewSnippet }: { overviewSnippet: string }) {
  const snippet = overviewSnippet.slice(0, BOXED_WARNING_SNIPPET_LENGTH)
  return (
    <div
      className="bg-red-50 border-l-4 border-red-600 rounded-lg p-5 mb-6"
      role="alert"
      aria-label="Black box warning"
    >
      <p className="text-sm font-bold text-red-700 uppercase tracking-wide mb-2">
        <span aria-hidden="true">⚠ </span>BLACK BOX WARNING
      </p>
      <p className="text-red-900 text-sm leading-relaxed">
        {snippet}{snippet.length < overviewSnippet.length ? '…' : ''}
      </p>
    </div>
  )
}

// ── Metadata ───────────────────────────────────────────────────────────────

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params
  const pill = await fetchPill(slug)
  if (!pill) {
    return {
      title: 'Pill Not Found',
      robots: { index: false, follow: true },
    }
  }
  const drugName = pill.drug_name
  const title = `${drugName}${pill.strength ? ` ${pill.strength}` : ''} — FDA Medication Guide`
  const description = `Read the official FDA Medication Guide for ${drugName} — written for patients.`
  const canonicalUrl = `${SITE_URL}/pill/${encodeURIComponent(slug)}/medication-guide`
  return {
    title,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title,
      description,
      url: canonicalUrl,
      type: 'article',
      siteName: 'PillSeek',
    },
  }
}

// ── Page ───────────────────────────────────────────────────────────────────

export default async function MedicationGuidePage(
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const pill = await fetchPill(slug)
  if (!pill) notFound()

  const result = await fetchMedicationGuide(pill.rxcui, pill.ndc)

  const drugName = pill.drug_name
  const pillTitle = [drugName, pill.strength].filter(Boolean).join(' ')

  // ── Shared header ──────────────────────────────────────────────────────

  const PageHeader = (
    <div className="mb-6">
      <Link
        href={`/pill/${encodeURIComponent(slug)}`}
        className="inline-flex items-center gap-1 text-sky-600 hover:text-sky-800 text-sm font-medium mb-4 transition-colors"
        aria-label={`Back to ${pillTitle}`}
      >
        ← Back to {drugName}
      </Link>
      <h1 className="text-3xl font-bold text-slate-900">{pillTitle}</h1>
      <p className="text-sm font-medium text-emerald-600 uppercase tracking-widest mt-1">
        Medication Guide
      </p>
      <div className="border-b border-slate-200 mt-4 mb-6" />
    </div>
  )

  // ── Error state ────────────────────────────────────────────────────────

  if (result.status === 'error') {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        {PageHeader}
        <PoisonControlCallout />
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-10 text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="text-lg font-semibold text-slate-800 mb-2">Temporarily Unavailable</h2>
          <p className="text-sm text-slate-500">
            Medication information could not be loaded. Please try again later.
          </p>
        </div>
      </div>
    )
  }

  if (result.status === 'not_found' || result.status === 'no_identifiers') {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        {PageHeader}
        <PoisonControlCallout />
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-10 text-center">
          <div className="text-4xl mb-4">📄</div>
          <h2 className="text-lg font-semibold text-slate-800 mb-2">No Medication Guide Available</h2>
          <p className="text-sm text-slate-500 max-w-sm mx-auto">
            The FDA has not issued a Medication Guide for this drug.
            For prescribing information, consult your pharmacist or healthcare provider.
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
            <a
              href="https://medlineplus.gov"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-sky-700 hover:underline"
            >
              Search MedlinePlus →
            </a>
            <a
              href="https://www.drugs.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-sky-700 hover:underline"
            >
              Search Drugs.com →
            </a>
          </div>
        </div>
      </div>
    )
  }

  // ── Full guide ─────────────────────────────────────────────────────────

  const { guide } = result

  const fetchedDate = (() => {
    if (!guide.fetched_at) return null
    try {
      return new Date(guide.fetched_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
      })
    } catch {
      return null
    }
  })()

  const overview = guide.sections.overview

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      {/* Header */}
      {PageHeader}

      {/* Boxed warning banner — only if has_boxed_warning */}
      {guide.has_boxed_warning && overview && (
        <BoxedWarningBanner overviewSnippet={overview} />
      )}

      {/* Poison control callout — always shown */}
      <PoisonControlCallout />

      {/* Main content */}
      {overview ? (
        <article className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 sm:p-8">
          <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <span className="text-emerald-500">📋</span> FDA Medication Guide
          </h2>
          {formatMedGuideText(overview)}
        </article>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-10 text-center">
          <div className="text-4xl mb-4">📄</div>
          <h2 className="text-lg font-semibold text-slate-800 mb-2">No Medication Guide Available</h2>
          <p className="text-sm text-slate-500 max-w-sm mx-auto">
            The FDA has not issued a Medication Guide for this drug.
            For prescribing information, consult your pharmacist or healthcare provider.
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
            <a
              href="https://medlineplus.gov"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-sky-700 hover:underline"
            >
              Search MedlinePlus →
            </a>
            <a
              href="https://www.drugs.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-sky-700 hover:underline"
            >
              Search Drugs.com →
            </a>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="border-t border-slate-100 mt-8 pt-5 space-y-2">
        {guide.disclaimer && (
          <p className="text-xs text-slate-400 italic leading-relaxed">{guide.disclaimer}</p>
        )}
        <div className="flex flex-wrap items-center gap-4">
          {guide.source_url && (
            <a
              href={guide.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-sky-700 hover:underline"
            >
              Source: FDA Structured Product Labeling
            </a>
          )}
          {fetchedDate && (
            <p className="text-xs text-slate-400">
              Last updated:{' '}
              <time dateTime={guide.fetched_at ?? undefined}>{fetchedDate}</time>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
