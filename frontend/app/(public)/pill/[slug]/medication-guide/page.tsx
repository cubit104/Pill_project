import Link from 'next/link'
import { notFound } from 'next/navigation'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'

type PageParams = Promise<{ slug: string }>
type SearchParams = Promise<{ tab?: string }>

type PillInfo = {
  rxcui?: string
  ndc11?: string
  ndc9?: string
  medicine_name?: string
  brand_names?: string
}

type GuideSections = {
  overview?: string | null
  uses?: string | null
  dosage?: string | null
  how_to_take?: string | null
  side_effects?: string | null
  warnings?: string | null
  interactions?: string | null
  contraindications?: string | null
  special_populations?: string | null
  overdose?: string | null
  storage?: string | null
  pharmacology?: string | null
  manufacturer?: string | null
}

type GuideResponse = {
  rxcui?: string
  ndc?: string
  generic_name?: string
  brand_name?: string
  has_boxed_warning?: boolean
  sections: GuideSections
  professional_html?: string | null
  source_url?: string | null
  disclaimer?: string | null
}

// ── Extract only the patient Medication Guide section ─────────────────────────
// The overview field contains the full SPL text. We only want the part
// starting from the "MEDICATION GUIDE" / "Patient Information" marker.
function extractMedGuideSection(text: string): string | null {
  const markers = [
    /MEDICATION GUIDE\b/i,
    /PATIENT INFORMATION\b/i,
    /Patient Information\b/,
  ]
  for (const marker of markers) {
    const idx = text.search(marker)
    if (idx !== -1) return text.slice(idx)
  }
  // No patient guide section found in this text
  return null
}

// ── Text formatter ────────────────────────────────────────────────────────────

const MARKER = '\x00'

function isInlineList(parts: string[]): boolean {
  return parts.length >= 3 && parts.every((p) => p.split(' ').length <= 8)
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
            <li key={i} className="text-sm text-slate-600">{item.trim()}</li>
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
  if (/^[A-Z\s\d\W]{10,}$/.test(text) && allCapsWords.length >= 3 && !startsWithNumber) {
    return { type: 'header', text }
  }
  if (/^(What|Who|How|Why|When|Where)\s/.test(text) && text.includes('?')) {
    return { type: 'header', text }
  }
  const numMatch = text.match(/^(\d+)\.\s/)
  if (numMatch) return { type: 'numbered', num: parseInt(numMatch[1], 10), text }
  return { type: 'paragraph', text }
}

function formatMedGuideText(text: string): React.ReactNode {
  let processed = text

  const questionWords = ['What', 'Who', 'How', 'Why', 'When', 'Where']
  const questionRe = new RegExp(`([.?])\\s+(${questionWords.join('|')})\\s`, 'g')
  processed = processed.replace(questionRe, (_m, punct, word) => `${punct}\n${MARKER}${word} `)
  processed = processed.replace(/ ([1-9]|1\d|20)\. /g, (_m, num) => ' ' + MARKER + num + '. ')
  processed = processed.replace(
    /\b(WHAT IS|WHO SHOULD|HOW SHOULD|WHAT ARE|WHAT SHOULD|HOW DO|HOW CAN|WHEN SHOULD|WHERE SHOULD)\b/g,
    `${MARKER}$1`
  )
  processed = processed
    .replace(/([.!?])\s+(Symptoms may include:)/g, `$1\n${MARKER}$2`)
    .replace(/([.!?])\s+(Call your (healthcare provider|doctor|pharmacist))/g, `$1\n${MARKER}$2`)

  const chunks: Chunk[] = processed.split(MARKER)
    .map((c) => c.trim())
    .filter(Boolean)
    .map(classifyChunk)

  const nodes: React.ReactNode[] = []
  let i = 0
  while (i < chunks.length) {
    const chunk = chunks[i]
    if (chunk.type === 'header') {
      nodes.push(
        <h3 key={i} className="text-base font-semibold text-slate-900 mt-8 mb-2 pb-1 border-b border-slate-100">
          {chunk.text}
        </h3>
      )
      i++; continue
    }
    if (chunk.type === 'numbered') {
      const items: Chunk[] = []
      while (i < chunks.length && chunks[i].type === 'numbered') { items.push(chunks[i]); i++ }
      nodes.push(
        <ol key={`ol-${i}`} className="list-decimal list-outside ml-5 space-y-3 my-3">
          {items.map((item, idx) => {
            if (item.type !== 'numbered') return null
            const itemText = item.text.replace(/^\d+\.\s*/, '')
            const colonIdx = itemText.indexOf(': ')
            if (colonIdx !== -1) {
              const subParts = itemText.slice(colonIdx + 2).split(/(?<=[a-z])\s+(?=[A-Z])/)
              if (isInlineList(subParts)) {
                return (
                  <li key={idx} className="text-sm text-slate-700 leading-relaxed pl-1">
                    {itemText.slice(0, colonIdx + 1)}
                    <ul className="list-disc list-outside ml-4 mt-1 space-y-0.5">
                      {subParts.map((sub, si) => <li key={si} className="text-sm text-slate-600">{sub.trim()}</li>)}
                    </ul>
                  </li>
                )
              }
            }
            return <li key={idx} className="text-sm text-slate-700 leading-relaxed pl-1">{itemText}</li>
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

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchPill(slug: string): Promise<PillInfo | null> {
  try {
    const res = await fetch(`${API_BASE}/api/pill/${encodeURIComponent(slug)}`, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as PillInfo
  } catch {
    return null
  }
}

async function fetchGuide(pill: PillInfo): Promise<GuideResponse | null> {
  try {
    if (pill.rxcui) {
      const res = await fetch(
        `${API_BASE}/api/drugs/${encodeURIComponent(pill.rxcui)}/guide`,
        { cache: 'no-store' }
      )
      if (res.ok) return (await res.json()) as GuideResponse
    }
    const ndc = pill.ndc11 || pill.ndc9
    if (ndc) {
      const res = await fetch(
        `${API_BASE}/api/drugs/by-ndc/${encodeURIComponent(ndc)}/guide`,
        { cache: 'no-store' }
      )
      if (res.ok) return (await res.json()) as GuideResponse
    }
    return null
  } catch {
    return null
  }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function MedicationGuidePage({
  params,
  searchParams,
}: {
  params: PageParams
  searchParams: SearchParams
}) {
  const { slug } = await params
  const { tab = 'consumer' } = await searchParams
  const isPro = tab === 'pro'

  const pill = await fetchPill(slug)
  if (!pill) notFound()

  const guide = await fetchGuide(pill)
  const drugName = guide?.brand_name || guide?.generic_name || pill.medicine_name || 'Medication'

  // Extract only the patient-facing Medication Guide section from the overview text
  const rawOverview = guide?.sections?.overview ?? null
  const patientGuideText = rawOverview ? extractMedGuideSection(rawOverview) : null

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* Heading */}
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Medication Guide — {drugName}</h1>
        <p className="mt-2 text-slate-600 text-sm">
          Patient-friendly guidance and full FDA prescribing information.
        </p>
      </div>

      {/* Tab switcher */}
      <div className="flex border-b border-slate-200">
        <Link
          href={`/pill/${slug}/medication-guide`}
          className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            !isPro
              ? 'border-sky-600 text-sky-700'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          💊 Medication Guide
        </Link>
        <Link
          href={`/pill/${slug}/medication-guide?tab=pro`}
          className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            isPro
              ? 'border-sky-600 text-sky-700'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          🏥 Full Prescribing Information
        </Link>
      </div>

      {/* ── Tab 1: Patient Medication Guide ── */}
      {!isPro && (
        <>
          {/* Boxed warning */}
          {guide?.has_boxed_warning && (
            <div className="rounded-2xl border border-rose-300 bg-rose-50 p-4 text-rose-900">
              <p className="font-semibold">⚠️ Boxed Warning</p>
              <p className="text-sm mt-1">This medication includes an FDA boxed warning.</p>
            </div>
          )}

          {/* Poison control */}
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
            <p className="font-semibold">Poison Help</p>
            <p className="text-sm mt-1">
              In the U.S., call Poison Control at{' '}
              <a href="tel:18002221222" className="underline">1-800-222-1222</a>.
            </p>
          </div>

          {/* Patient Medication Guide content */}
          {patientGuideText ? (
            <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-6 sm:p-8">
              <h2 className="text-lg font-semibold text-slate-900 mb-6">📋 FDA Medication Guide</h2>
              {formatMedGuideText(patientGuideText)}
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-600">
              <p className="text-4xl mb-3">📄</p>
              <p className="text-lg font-semibold text-slate-800">No Patient Medication Guide Available</p>
              <p className="text-sm text-slate-500 mt-2">
                The FDA has not issued a patient Medication Guide for this drug.
              </p>
              <div className="flex justify-center gap-4 mt-4 text-sm text-sky-600">
                <a href="https://medlineplus.gov/druginformation.html" target="_blank" rel="noopener noreferrer" className="hover:underline">MedlinePlus</a>
                <span>·</span>
                <a href={`https://www.drugs.com/${encodeURIComponent(drugName.toLowerCase())}.html`} target="_blank" rel="noopener noreferrer" className="hover:underline">Drugs.com</a>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Tab 2: Full Prescribing Information ── */}
      {isPro && (
        <div>
          {guide?.professional_html ? (
            <>
              <iframe
                srcDoc={guide.professional_html}
                className="w-full border-0 rounded-xl shadow-sm"
                style={{ minHeight: '85vh' }}
                sandbox="allow-scripts"
                title={`${drugName} Full Prescribing Information`}
              />
              <div className="mt-4 text-sm text-slate-600">
                {guide.source_url && (
                  <a href={guide.source_url} target="_blank" rel="noopener noreferrer" className="text-sky-600 hover:underline">
                    View on DailyMed ↗
                  </a>
                )}
                <p className="mt-2 text-xs">Source: FDA Structured Product Labeling via DailyMed</p>
              </div>
            </>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
              <p className="text-4xl mb-3">📄</p>
              <p className="text-lg font-semibold text-slate-800">Full Prescribing Information Not Available</p>
              <p className="text-sm text-slate-500 mt-2 mb-4">The structured product label could not be rendered.</p>
              {guide?.source_url && (
                <a href={guide.source_url} target="_blank" rel="noopener noreferrer" className="text-sm text-sky-600 hover:underline">
                  View on DailyMed ↗
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      {guide?.disclaimer && (
        <p className="text-xs text-slate-400 italic leading-relaxed border-t border-slate-100 pt-4">
          {guide.disclaimer}
        </p>
      )}
    </div>
  )
}
