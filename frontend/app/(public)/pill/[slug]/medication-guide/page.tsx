import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import type { PillDetail } from '../../../../types'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com'
).replace(/\/$/, '')

// ── Types ──────────────────────────────────────────────────────────────────

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
  rxcui: string
  ndc: string
  generic_name: string
  brand_name: string
  has_boxed_warning: boolean
  sections: GuideSection
  source_url: string
  fetched_at: string
  disclaimer: string
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

async function fetchMedicationGuide(pill: PillDetail): Promise<GuideResult> {
  if (!pill.rxcui && !pill.ndc) {
    return { status: 'no_identifiers' }
  }

  const url = pill.rxcui
    ? `${API_BASE}/api/drugs/${encodeURIComponent(pill.rxcui)}/guide`
    : `${API_BASE}/api/drugs/by-ndc/${encodeURIComponent(pill.ndc!)}/guide`

  try {
    const res = await fetch(url, { next: { revalidate: 86400 } })
    if (res.status === 404) return { status: 'not_found' }
    if (!res.ok) return { status: 'error' }
    const guide = await res.json()
    return { status: 'ok', guide }
  } catch {
    return { status: 'error' }
  }
}

// ── UI components ──────────────────────────────────────────────────────────

function GuideText({ text, textColorClass = 'text-slate-700' }: { text: string; textColorClass?: string }) {
  const paragraphs = text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (paragraphs.length <= 1) {
    return (
      <p className={`text-sm leading-relaxed whitespace-pre-wrap ${textColorClass}`}>{text}</p>
    )
  }
  return (
    <div className="space-y-3">
      {paragraphs.map((p, i) => (
        <p key={i} className={`text-sm leading-relaxed ${textColorClass}`}>
          {p}
        </p>
      ))}
    </div>
  )
}

function SectionBlock({ title, content }: { title: string; content: string }) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-4">
      <h2 className="text-base font-semibold text-slate-800 mb-3">{title}</h2>
      <GuideText text={content} />
    </section>
  )
}

function PoisonControlCallout() {
  return (
    <div
      className="bg-red-50 border border-red-300 rounded-xl p-5 mb-6"
      role="note"
      aria-label="Poison control information"
    >
      <h2 className="text-sm font-bold text-red-900 mb-2">
        <span aria-hidden="true">☎ </span>In case of overdose
      </h2>
      <p className="text-sm text-red-800 leading-relaxed">
        Call Poison Control at{' '}
        <a
          href="tel:18002221222"
          className="font-bold underline hover:text-red-900"
        >
          1-800-222-1222
        </a>{' '}
        (24 hours a day, 7 days a week). If the person has collapsed, had a seizure, has trouble
        breathing, or cannot be awakened, call{' '}
        <a href="tel:911" className="font-bold underline hover:text-red-900">
          911
        </a>{' '}
        immediately.
      </p>
    </div>
  )
}

function BoxedWarningBanner({ text }: { text: string }) {
  return (
    <div
      className="bg-red-100 border-2 border-red-500 rounded-xl p-5 mb-6"
      role="alert"
      aria-label="Boxed warning"
    >
      <h2 className="text-sm font-bold text-red-900 mb-2 uppercase tracking-wide">
        <span aria-hidden="true">⚠ </span>Boxed Warning
      </h2>
      {/* Per spec, the full warnings text is used here. The same text also appears
          in the regular Warnings section below — this is intentional per requirements. */}
      <GuideText text={text} textColorClass="text-red-900" />
    </div>
  )
}

// ── Section order spec ─────────────────────────────────────────────────────

const SECTION_ORDER: Array<{ key: keyof GuideSection; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'uses', label: 'Uses' },
  { key: 'dosage', label: 'Dosage' },
  { key: 'how_to_take', label: 'How to Take' },
  { key: 'side_effects', label: 'Side Effects' },
  { key: 'warnings', label: 'Warnings' },
  { key: 'interactions', label: 'Drug Interactions' },
  { key: 'contraindications', label: 'Contraindications' },
  { key: 'special_populations', label: 'Special Populations' },
  { key: 'overdose', label: 'Overdose' },
  { key: 'storage', label: 'Storage' },
  { key: 'pharmacology', label: 'Pharmacology' },
  { key: 'manufacturer', label: 'Manufacturer' },
]

// ── Page header component ──────────────────────────────────────────────────

function PageHeader({ slug, pillTitle, subtitle }: { slug: string; pillTitle: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <Link
        href={`/pill/${encodeURIComponent(slug)}`}
        className="inline-flex items-center gap-1 text-sky-600 hover:text-sky-800 text-sm font-medium mb-4 transition-colors"
        aria-label={`Back to ${pillTitle} pill detail`}
      >
        ← Back to pill page
      </Link>
      <h1 className="text-2xl font-bold text-slate-900 mb-1">{pillTitle}</h1>
      {subtitle && (
        <p className="text-sm text-slate-500 mb-1">{subtitle}</p>
      )}
      <p className="text-sm text-slate-500">Medication Guide</p>
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
  const title = `${pill.drug_name}${pill.strength ? ` ${pill.strength}` : ''} — Medication Guide`
  const description = `FDA prescribing information for ${pill.drug_name}: uses, dosage, warnings, side effects, and more.`
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

  const result = await fetchMedicationGuide(pill)

  const pillTitle = [pill.drug_name, pill.strength].filter(Boolean).join(' ')

  // ── Empty / error states ──────────────────────────────────────────────

  if (result.status === 'error') {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <PageHeader slug={slug} pillTitle={pillTitle} />
        <PoisonControlCallout />
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8 text-center">
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
      <div className="max-w-3xl mx-auto px-4 py-8">
        <PageHeader slug={slug} pillTitle={pillTitle} />
        <PoisonControlCallout />
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8 text-center">
          <p className="text-slate-700 font-medium mb-2">
            Detailed medication information is not available
          </p>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            Detailed FDA prescribing information is not available for this medication. Please
            consult your pharmacist or healthcare provider for guidance specific to your treatment.
          </p>
        </div>
      </div>
    )
  }

  // ── Full / partial guide ──────────────────────────────────────────────

  const { guide } = result
  const subtitle = [guide.generic_name, guide.brand_name]
    .filter((v) => v && v !== pill.drug_name)
    .join(' / ')

  const fetchedDate = (() => {
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

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Header */}
      <PageHeader slug={slug} pillTitle={pillTitle} subtitle={subtitle || undefined} />

      {/* Poison control callout — always shown */}
      <PoisonControlCallout />

      {/* Boxed warning banner */}
      {guide.has_boxed_warning && guide.sections.warnings && (
        <BoxedWarningBanner text={guide.sections.warnings} />
      )}

      {/* Main sections */}
      {SECTION_ORDER.map(({ key, label }) => {
        const content = guide.sections[key]
        if (!content) return null
        return <SectionBlock key={key} title={label} content={content} />
      })}

      {/* Footer metadata */}
      <div className="mt-6 pt-5 border-t border-slate-200 space-y-2">
        {guide.disclaimer && (
          <p className="text-xs text-slate-500 leading-relaxed">{guide.disclaimer}</p>
        )}
        <p className="text-xs text-slate-500">
          <a
            href={guide.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sky-700 hover:underline"
          >
            Source: FDA Structured Product Labeling
          </a>
        </p>
        {fetchedDate && (
          <p className="text-xs text-slate-400">
            Last updated:{' '}
            <time dateTime={guide.fetched_at}>{fetchedDate}</time>
          </p>
        )}
      </div>
    </div>
  )
}
