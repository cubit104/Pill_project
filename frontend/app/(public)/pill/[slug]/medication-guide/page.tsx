import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { fetchPill, API_BASE } from '../../lib'

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com'
).replace(/\/$/, '')

// ── Types ─────────────────────────────────────────────────────────────────────

interface GuideSection {
  overview: string | null
  uses: string | null
  dosage: string | null
  how_to_take: string | null
  side_effects: string | null
  warnings: string | null
  interactions: string | null
  contraindications: string | null
  special_populations: string | null
  overdose: string | null
  storage: string | null
  pharmacology: string | null
  manufacturer: string | null
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

// ── Data fetching ─────────────────────────────────────────────────────────────

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

// ── Smart med-guide text formatter ─────────────────────────────────────────

const MARKER = '\x00'
const MAX_WORDS_PER_INLINE_LIST_ITEM = 8
const BLACK_BOX_WARNING_PREVIEW_LENGTH = 300

function isInlineList(parts: string[]): boolean {
  return (
    parts.length >= 3 &&
    parts.every((p) => p.split(' ').length <= MAX_WORDS_PER_INLINE_LIST_ITEM)
  )
}

function renderInlineList(text: string): React.ReactNode {
  const colonIdx = text.indexOf(': ')
  if (colonIdx === -1) return <>{text}</>

  const before = text.slice(0, colonIdx + 1)
  const after = text.slice(colonIdx + 2)

  const parts = after.split(/(?<=[a-z])\s+(?=[A-Z])/)
  if (isInlineList(parts)) {
    return (
      <>
        {before}{' '}
        <ul className="list-disc list-outside ml-4 mt-1 space-y-0.5">
          {parts.map((item, i) => (
            <li key={i} className="text-sm text-slate-600">
              {item.trim()}
            </li>
          ))}
        </ul>
      </>
    )
  }
  return <>{text}</>
}

type Chunk =
  | { type: 'header'; text: string }
  | { type: 'numbered'; num: number; text: string }
  | { type: 'paragraph'; text: string }

function classifyChunk(raw: string): Chunk {
  const text = raw.trim()

  const allCapsWords = text.match(/\b[A-Z]{2,}\b/g) ?? []
  const startsWithNumber = /^\d+\./.test(text)
  if (
    /^[A-Z\s\d\W]{10,}$/.test(text) &&
    allCapsWords.length >= 3 &&
    !startsWithNumber
  ) {
    return { type: 'header', text }
  }

  if (
    /^(What|Who|How|Why|When|Where)\s/.test(text) &&
    text.includes('?')
  ) {
    return { type: 'header', text }
  }

  const numMatch = text.match(/^(\d+)\.\s/)
  if (numMatch) {
    return { type: 'numbered', num: parseInt(numMatch[1], 10), text }
  }

  return { type: 'paragraph', text }
}

function formatMedGuideText(text: string): React.ReactNode {
  let processed = text

  const anchorPatterns = [
    /Read this Medication Guide/,
    /Read this Patient Information/,
    /^Important:/,
  ]

  for (const pattern of anchorPatterns) {
    const match = pattern.exec(processed)
    if (match) {
      const before = processed.slice(0, match.index)
      const dotIdx = before.lastIndexOf('. ')
      const bangIdx = before.lastIndexOf('! ')
      const lastPunct = Math.max(dotIdx, bangIdx)
      const sentenceStart = lastPunct >= 0 ? lastPunct + 2 : 0
      processed = processed.slice(sentenceStart)
      break
    }
  }

  const questionWords = ['What', 'Who', 'How', 'Why', 'When', 'Where']
  const questionRe = new RegExp(
    `([.?])\\s+(${questionWords.join('|')})\\s`,
    'g'
  )
  processed = processed.replace(questionRe, (_match, punct, word) => `${punct}\n${MARKER}${word} `)
  processed = processed.replace(/ ([1-9]|1\d|20)\. /g, (_match, num) => ' ' + MARKER + num + '. ')
  processed = processed.replace(
    /\b(WHAT IS|WHO SHOULD|HOW SHOULD|WHAT ARE|WHAT SHOULD|HOW DO|HOW CAN|WHEN SHOULD|WHERE SHOULD)\b/g,
    `${MARKER}$1`
  )
  processed = processed
    .replace(/([.!?])\s+(Symptoms may include:)/g, `$1\n${MARKER}$2`)
    .replace(/([.!?])\s+(Call your (healthcare provider|doctor|pharmacist))/g, `$1\n${MARKER}$2`)

  const rawChunks = processed.split(MARKER)
  const chunks: Chunk[] = rawChunks
    .map((c) => c.trim())
    .filter(Boolean)
    .map(classifyChunk)

  const nodes: React.ReactNode[] = []
  let i = 0

  while (i < chunks.length) {
    const chunk = chunks[i]

    if (chunk.type === 'header') {
      nodes.push(
        <h3
          key={i}
          className="text-base font-semibold text-slate-900 mt-8 mb-2 pb-1 border-b border-slate-100"
        >
          {chunk.text}
        </h3>
      )
      i++
      continue
    }

    if (chunk.type === 'numbered') {
      const items: Chunk[] = []
      while (i < chunks.length && chunks[i].type === 'numbered') {
        items.push(chunks[i])
        i++
      }
      nodes.push(
        <ol key={`ol-${i}`} className="list-decimal list-outside ml-5 space-y-3 my-3">
          {items.map((item, idx) => {
            if (item.type !== 'numbered') return null
            const itemText = item.text.replace(/^\d+\.\s*/, '')

            const colonIdx = itemText.indexOf(': ')
            if (colonIdx !== -1) {
              const afterColon = itemText.slice(colonIdx + 2)
              const subParts = afterColon.split(/(?<=[a-z])\s+(?=[A-Z])/)
              if (isInlineList(subParts)) {
                return (
                  <li key={idx} className="text-sm text-slate-700 leading-relaxed pl-1">
                    {itemText.slice(0, colonIdx + 1)}
                    <ul className="list-disc list-outside ml-4 mt-1 space-y-0.5">
                      {subParts.map((sub, si) => (
                        <li key={si} className="text-sm text-slate-600">
                          {sub.trim()}
                        </li>
                      ))}
                    </ul>
                  </li>
                )
              }
            }

            return (
              <li key={idx} className="text-sm text-slate-700 leading-relaxed pl-1">
                {itemText}
              </li>
            )
          })}
        </ol>
      )
      continue
    }

    nodes.push(
      <p key={i} className="text-sm text-slate-700 leading-relaxed my-2">
        {renderInlineList(chunk.text)}
      </p>
    )
    i++
  }

  return <>{nodes}</>
}

// ── Metadata ──────────────────────────────────────────────────────────────────

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
  const title = `${drugName}${pill.strength ? ` ${pill.strength}` : ''} — Medication Guide`
  const description = `Official FDA Medication Guide for ${drugName} — written for patients, sourced from DailyMed.`
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function MedicationGuidePage(
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const pill = await fetchPill(slug)
  if (!pill) notFound()

  const result = await fetchMedicationGuide(pill.rxcui, pill.ndc)

  const drugName = pill.drug_name
  const strength = pill.strength ?? ''
  const pillTitle = [drugName, strength].filter(Boolean).join(' ')

  const backLink = (
    <Link
      href={`/pill/${encodeURIComponent(slug)}`}
      className="inline-flex items-center gap-1 text-sm text-sky-600 hover:text-sky-800 transition-colors mb-5"
    >
      ← Back to {drugName}
    </Link>
  )

  const pageHeading = (
    <div className="border-b border-slate-200 mt-3 mb-6">
      <h1 className="text-3xl font-bold text-slate-900">{pillTitle}</h1>
      <p className="text-xs font-semibold text-emerald-600 uppercase tracking-widest mt-1 mb-3">
        Medication Guide
      </p>
    </div>
  )

  if (result.status === 'error') {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        {backLink}
        {pageHeading}
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center mb-8">
          <p className="text-slate-700 font-medium mb-2">
            Medication information is temporarily unavailable.
          </p>
          <p className="text-sm text-slate-500">Please try again later.</p>
        </div>
      </div>
    )
  }

  if (result.status === 'not_found' || result.status === 'no_identifiers') {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        {backLink}
        {pageHeading}
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center mb-8">
          <p className="text-4xl mb-3">📄</p>
          <p className="text-lg font-semibold text-slate-800">No Medication Guide Available</p>
          <p className="text-sm text-slate-500 mt-2">
            The FDA has not issued a Medication Guide for this drug. For general information, visit:
          </p>
          <p className="text-sm text-sky-600 mt-4 space-x-4">
            <a href="https://medlineplus.gov/druginformation.html" target="_blank" rel="noopener noreferrer" className="hover:underline">MedlinePlus</a>
            <span aria-hidden="true">·</span>
            <a href={`https://www.drugs.com/${encodeURIComponent(drugName.toLowerCase())}.html`} target="_blank" rel="noopener noreferrer" className="hover:underline">Drugs.com</a>
          </p>
        </div>
      </div>
    )
  }

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
      {backLink}
      {pageHeading}

      {/* Black box warning */}
      {guide.has_boxed_warning && overview && (
        <div
          className="bg-red-50 border-l-4 border-red-600 rounded-r-lg p-4 mb-6"
          role="alert"
          aria-label="Black box warning"
        >
          <p className="font-bold text-red-800 text-sm uppercase tracking-wide mb-1">
            ⚠ Black Box Warning
          </p>
          <p className="text-red-900 text-sm mt-1">
            {(() => {
              if (overview.length <= BLACK_BOX_WARNING_PREVIEW_LENGTH) return overview
              const cutoff = overview.lastIndexOf(' ', BLACK_BOX_WARNING_PREVIEW_LENGTH)
              return overview.slice(0, cutoff > 0 ? cutoff : BLACK_BOX_WARNING_PREVIEW_LENGTH) + '…'
            })()}
          </p>
        </div>
      )}

      {/* Poison control bar */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 mb-6 text-xs text-slate-600">
        ☎ Poison Control: 1-800-222-1222&nbsp;&nbsp;|&nbsp;&nbsp;Emergency: 911
      </div>

      {/* Main article card */}
      {overview ? (
        <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-6 sm:p-8 mb-8">
          <h2 className="text-lg font-semibold text-slate-900 mb-6">📋 FDA Medication Guide</h2>
          {formatMedGuideText(overview)}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center mb-8">
          <p className="text-4xl mb-3">📄</p>
          <p className="text-lg font-semibold text-slate-800">No Medication Guide Available</p>
          <p className="text-sm text-slate-500 mt-2">
            The FDA has not issued a Medication Guide for this drug. For general information, visit:
          </p>
          <p className="text-sm text-sky-600 mt-4 space-x-4">
            <a href="https://medlineplus.gov/druginformation.html" target="_blank" rel="noopener noreferrer" className="hover:underline">MedlinePlus</a>
            <span aria-hidden="true">·</span>
            <a href={`https://www.drugs.com/${encodeURIComponent(drugName.toLowerCase())}.html`} target="_blank" rel="noopener noreferrer" className="hover:underline">Drugs.com</a>
          </p>
        </div>
      )}

      {/* Footer */}
      <div className="border-t border-slate-100 mt-4 pt-5 space-y-1.5">
        {guide.disclaimer && (
          <p className="text-xs text-slate-400 italic leading-relaxed">{guide.disclaimer}</p>
        )}
        {guide.source_url && (
          <p className="text-xs">
            <a href={guide.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-sky-600 hover:underline">
              Source: FDA Structured Product Labeling
            </a>
          </p>
        )}
        {fetchedDate && (
          <p className="text-xs text-slate-400">
            Last updated:{' '}
            <time dateTime={guide.fetched_at ?? undefined}>{fetchedDate}</time>
          </p>
        )}
      </div>
    </div>
  )
}
