import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import type { PillDetail } from '../../../../types'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com'
).replace(/\/$/, '')

// ── Types ──────────────────────────────────────────────────────────────────

interface GuideSections {
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
  sections: GuideSections
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

async function fetchPill(slug: string): Promise<PillDetail | null> {
  const res = await fetch(`${API_BASE}/api/pill/${encodeURIComponent(slug)}`, {
    next: { revalidate: 900 },
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`API error ${res.status}`)
  const raw = await res.json()
  return {
    drug_name: raw.drug_name ?? raw.medicine_name ?? 'Unknown',
    imprint: raw.imprint ?? raw.splimprint ?? '',
    color: raw.color ?? raw.splcolor_text,
    shape: raw.shape ?? raw.splshape_text,
    ndc: raw.ndc ?? raw.ndc11,
    ndc9: raw.ndc9,
    rxcui: raw.rxcui,
    slug: raw.slug,
    strength: raw.strength ?? raw.spl_strength,
    manufacturer: raw.manufacturer ?? raw.author,
    ingredients: raw.ingredients ?? raw.spl_ingredients,
    inactive_ingredients: raw.inactive_ingredients ?? raw.spl_inactive_ing,
    dea_schedule: raw.dea_schedule ?? raw.dea_schedule_name,
    pharma_class: raw.pharma_class ?? raw.dailymed_pharma_class_epc ?? raw.pharmclass_fda_epc,
    size: raw.size ?? (raw.splsize ? String(raw.splsize) : undefined),
    dosage_form: raw.dosage_form,
    brand_names: raw.brand_names,
    status_rx_otc: raw.status_rx_otc,
    route: raw.route,
    meta_title: raw.meta_title ?? undefined,
    image_url: raw.image_url ?? (Array.isArray(raw.image_urls) ? raw.image_urls[0] : undefined),
    images: raw.images ?? raw.image_urls ?? [],
    spl_set_id: raw.spl_set_id ?? undefined,
    updated_at: raw.updated_at ?? undefined,
    meta_description: raw.meta_description ?? undefined,
    indication: raw.indication ?? null,
  }
}

async function fetchMedicationGuide(
  rxcui: string | undefined,
  ndc: string | undefined,
): Promise<GuideResult> {
  if (!rxcui && !ndc) return { status: 'no_identifiers' }

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

// ── Rendering components ───────────────────────────────────────────────────

/**
 * Renders structured HTML returned by the backend (from DailyMed SPL XML).
 * Applies scoped Tailwind classes to style lists, paragraphs, tables, etc.
 * Content is trusted FDA-sourced HTML, sanitized server-side with bleach.
 */
function GuideHtml({ html }: { html: string }) {
  return (
    <div
      className={[
        '[&_ul]:list-disc [&_ul]:ml-4 [&_ul]:space-y-1 [&_ul]:my-2',
        '[&_ol]:list-decimal [&_ol]:ml-4 [&_ol]:space-y-1 [&_ol]:my-2',
        '[&_li]:text-sm [&_li]:text-slate-700 [&_li]:leading-relaxed',
        '[&_p]:text-sm [&_p]:text-slate-700 [&_p]:leading-relaxed [&_p]:my-2',
        '[&_strong]:font-semibold [&_strong]:text-slate-800',
        '[&_em]:italic',
        '[&_h3]:font-semibold [&_h3]:text-slate-800 [&_h3]:text-sm [&_h3]:mt-3 [&_h3]:mb-1',
        '[&_h4]:font-semibold [&_h4]:text-slate-800 [&_h4]:text-sm [&_h4]:mt-3 [&_h4]:mb-1',
        '[&_hr]:border-slate-200 [&_hr]:my-4',
        '[&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_table]:my-3',
        '[&_td]:border [&_td]:border-slate-200 [&_td]:p-2 [&_td]:text-sm [&_td]:text-slate-700 [&_td]:align-top',
        '[&_th]:border [&_th]:border-slate-200 [&_th]:p-2 [&_th]:text-sm [&_th]:font-semibold [&_th]:bg-slate-50',
        '[&_caption]:font-semibold [&_caption]:text-slate-700 [&_caption]:text-sm [&_caption]:mb-1',
      ].join(' ')}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/**
 * Renders plain-text section content (openFDA fallback) split into paragraphs.
 */
function GuideText({ text }: { text: string }) {
  const paragraphs = text.split(/\n\n+/).filter(Boolean)
  return (
    <div className="space-y-3">
      {paragraphs.map((para, i) => (
        <p key={i} className="text-sm text-slate-700 leading-relaxed">
          {para}
        </p>
      ))}
    </div>
  )
}

/**
 * Renders one medication guide section with a labelled heading.
 * Automatically detects HTML vs plain-text and routes to the right renderer.
 */
function SectionBlock({ label, content }: { label: string; content: string }) {
  const isHtml = content.trimStart().startsWith('<')
  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold text-slate-900 mb-3 pb-2 border-b border-slate-200">
        {label}
      </h2>
      {isHtml ? <GuideHtml html={content} /> : <GuideText text={content} />}
    </section>
  )
}

// Section display order and labels
const SECTION_ORDER: Array<{ key: keyof GuideSections; label: string }> = [
  { key: 'overview',           label: '📋 Medication Guide / Description' },
  { key: 'uses',               label: '✅ What is this medication used for?' },
  { key: 'dosage',             label: '💊 Dosage & Administration' },
  { key: 'how_to_take',        label: '📖 How to Take' },
  { key: 'side_effects',       label: '⚠️ Side Effects' },
  { key: 'warnings',           label: '🚨 Warnings' },
  { key: 'interactions',       label: '🔗 Drug Interactions' },
  { key: 'contraindications',  label: '🚫 Contraindications' },
  { key: 'special_populations', label: '👥 Use in Specific Populations' },
  { key: 'overdose',           label: '☠️ Overdose' },
  { key: 'storage',            label: '📦 Storage & Handling' },
  { key: 'pharmacology',       label: '🔬 Clinical Pharmacology' },
  { key: 'manufacturer',       label: '🏭 Manufacturer Information' },
]

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

// ── Page ───────────────────────────────────────────────────────────────────

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

  // ── Shared page shell ──────────────────────────────────────────────────
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

  // ── Error / not-found states ──────────────────────────────────────────
  if (result.status === 'error') {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        {backLink}
        {pageHeading}
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
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
      <div className="max-w-3xl mx-auto px-4 py-10">
        {backLink}
        {pageHeading}
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
          <p className="text-4xl mb-3">📄</p>
          <p className="text-lg font-semibold text-slate-800">No Medication Guide Available</p>
          <p className="text-sm text-slate-500 mt-2">
            The FDA has not issued a Medication Guide for this drug. For general information, visit:
          </p>
          <div className="flex justify-center gap-6 mt-4 text-sm text-sky-600">
            <a
              href="https://medlineplus.gov/druginformation.html"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              MedlinePlus
            </a>
            <a
              href={`https://www.drugs.com/${encodeURIComponent(drugName.toLowerCase())}.html`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              Drugs.com
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

  const warningsContent = guide.sections.warnings

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      {backLink}
      {pageHeading}

      {/* Drug name / generic+brand subtitle */}
      {(guide.generic_name || guide.brand_name) && (
        <p className="text-sm text-slate-500 -mt-4 mb-6">
          {[guide.generic_name, guide.brand_name && `(${guide.brand_name})`]
            .filter(Boolean)
            .join(' ')}
        </p>
      )}

      {/* Black box warning banner */}
      {guide.has_boxed_warning && warningsContent && (
        <div
          className="bg-red-50 border-2 border-red-700 rounded-lg p-4 mb-6"
          role="alert"
          aria-label="Black box warning"
        >
          <p className="font-bold text-red-800 text-sm uppercase tracking-wide mb-2">
            ⚠ Black Box Warning
          </p>
          {warningsContent.trimStart().startsWith('<') ? (
            <div
              className="text-red-900 text-sm [&_p]:text-red-900 [&_p]:my-1 [&_li]:text-red-900 [&_strong]:font-semibold"
              dangerouslySetInnerHTML={{ __html: warningsContent }}
            />
          ) : (
            <p className="text-red-900 text-sm leading-relaxed">
              {warningsContent.length <= 400
                ? warningsContent
                : warningsContent.slice(
                    0,
                    warningsContent.lastIndexOf(' ', 400) || 400
                  ) + '…'}
            </p>
          )}
        </div>
      )}

      {/* Poison control bar */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 mb-8 text-xs text-slate-600 flex flex-wrap gap-4">
        <span>☎ Poison Control: <strong>1-800-222-1222</strong></span>
        <span>🚨 Emergency: <strong>911</strong></span>
      </div>

      {/* All guide sections */}
      <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-6 sm:p-8">
        {SECTION_ORDER.filter(({ key }) => guide.sections[key]).map(({ key, label }) => (
          <SectionBlock
            key={key}
            label={label}
            content={guide.sections[key]!}
          />
        ))}

        {/* If no sections rendered at all */}
        {SECTION_ORDER.every(({ key }) => !guide.sections[key]) && (
          <div className="text-center py-10">
            <p className="text-4xl mb-3">📄</p>
            <p className="text-lg font-semibold text-slate-800">No Medication Guide Available</p>
            <p className="text-sm text-slate-500 mt-2">
              The FDA has not issued a Medication Guide for this drug.
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-slate-100 mt-6 pt-5 space-y-2">
        {guide.disclaimer && (
          <p className="text-xs text-slate-400 italic leading-relaxed">{guide.disclaimer}</p>
        )}
        {guide.source_url && (
          <p className="text-xs">
            <a
              href={guide.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-600 hover:underline"
            >
              Source: FDA Structured Product Labeling (DailyMed)
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
