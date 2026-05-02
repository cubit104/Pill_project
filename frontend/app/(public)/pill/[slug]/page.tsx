import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import PillDetailClient from './PillDetailClient'
import type { PillDetail, RelatedDrug, SimilarPill } from '../../../types'
import {
  breadcrumbSchema,
  buildIdentificationSummary,
  faqSchema,
  medicalWebPageSchema,
  safeJsonLd,
} from '../../../lib/structured-data'
import { DEFAULT_REVIEWER } from '../../../lib/reviewers'
import { slugifyDrugName } from '../../../lib/slug'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com'
).replace(/\/$/, '')

async function fetchPill(slug: string): Promise<PillDetail | null> {
  const res = await fetch(`${API_BASE}/api/pill/${encodeURIComponent(slug)}`, {
    next: { revalidate: 900 }, // 15 minutes
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

async function fetchRelated(slug: string): Promise<{ pharma_class: string | null; related: RelatedDrug[] }> {
  try {
    const res = await fetch(`${API_BASE}/api/related/${encodeURIComponent(slug)}`, {
      next: { revalidate: 3600 },
    })
    if (!res.ok) return { pharma_class: null, related: [] }
    return await res.json()
  } catch {
    return { pharma_class: null, related: [] }
  }
}

async function fetchSimilar(slug: string): Promise<SimilarPill[]> {
  try {
    const res = await fetch(`${API_BASE}/api/pill/${encodeURIComponent(slug)}/similar`, {
      next: { revalidate: 3600 },
    })
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data.similar) ? data.similar : []
  } catch {
    return []
  }
}

/** Build FAQ items from real DB fields for both visible UI and FAQPage JSON-LD. */
function buildFaqItems(pill: PillDetail): Array<{ question: string; answer: string }> {
  const items: Array<{ question: string; answer: string }> = []

  if (pill.drug_name && pill.drug_name !== 'Unknown') {
    const namePart = `This pill is identified as ${pill.drug_name}${pill.strength ? ` ${pill.strength}` : ''}`
    const formPart = pill.dosage_form ? `, a ${pill.dosage_form}` : ''
    const mfrPart = pill.manufacturer ? ` manufactured by ${pill.manufacturer}` : ''
    items.push({
      question: 'What is this pill?',
      answer: `${namePart}${formPart}${mfrPart}.`,
    })
  }

  if (pill.imprint) {
    const physicalDesc = [pill.color, pill.shape].filter(Boolean).join(' ')
    items.push({
      question: `What does the imprint "${pill.imprint}" mean?`,
      answer: `The imprint "${pill.imprint}" on this${physicalDesc ? ` ${physicalDesc}` : ''} pill helps identify it as ${pill.drug_name && pill.drug_name !== 'Unknown' ? pill.drug_name : 'this medication'}.`,
    })
  }

  if (pill.manufacturer) {
    items.push({
      question: 'Who makes this medication?',
      answer: `This medication is manufactured by ${pill.manufacturer}.${pill.ndc ? ` The NDC (National Drug Code) is ${pill.ndc}.` : ''}`,
    })
  }

  if (pill.ingredients) {
    items.push({
      question: 'What are the active ingredients?',
      answer: `The active ingredients in this medication are: ${pill.ingredients}.`,
    })
  }

  if (pill.dea_schedule) {
    const scheduleLabels: Record<string, string> = {
      '1': 'a Schedule I controlled substance with high abuse potential and no accepted medical use',
      '2': 'a Schedule II controlled substance with high abuse potential and severe dependence risk',
      '3': 'a Schedule III controlled substance with moderate abuse potential',
      '4': 'a Schedule IV controlled substance with low abuse potential',
      '5': 'a Schedule V controlled substance — the lowest abuse potential among controlled substances',
    }
    items.push({
      question: 'Is this medication a controlled substance?',
      answer: `Yes, ${pill.drug_name && pill.drug_name !== 'Unknown' ? pill.drug_name : 'this medication'} is classified as ${scheduleLabels[pill.dea_schedule] ?? `a DEA Schedule ${pill.dea_schedule} controlled substance`}.`,
    })
  }

  return items
}

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

  const computedTitle = [
    pill.color,
    pill.shape,
    pill.drug_name,
    pill.strength,
    'Pill',
    pill.imprint ? `With Imprint ${pill.imprint}` : null,
  ].filter(Boolean).join(' ')
  const title = pill.meta_title || computedTitle

  const identificationSummary = buildIdentificationSummary(pill)
  const truncateAtWord = (text: string, limit: number) => {
    if (text.length <= limit) return text
    const truncated = text.slice(0, limit)
    const lastSpace = truncated.lastIndexOf(' ')
    return lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated
  }
  const description = pill.meta_description || truncateAtWord(identificationSummary, 155)

  const images = pill.images && pill.images.length > 0
    ? pill.images
    : pill.image_url
    ? [pill.image_url]
    : []

  // Canonical URL — no trailing slash, matches actual browser URL
  const canonicalUrl = `${SITE_URL}/pill/${encodeURIComponent(slug)}`

  // Index if we have a drug name + imprint — NDC is not required
  const hasData = !!(pill.drug_name && pill.drug_name !== 'Unknown' && pill.imprint)
  const robots = hasData
    ? { index: true, follow: true }
    : { index: false, follow: true }

  return {
    title,
    description,
    robots,
    // Absolute canonical — must exactly match the browser URL (no trailing slash)
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title,
      description,
      url: canonicalUrl,
      type: 'article',
      siteName: 'PillSeek',
      ...(images.length > 0 && {
        images: [
          {
            url: images[0],
            alt: `${[pill.color, pill.shape, pill.drug_name].filter(Boolean).join(' ')} pill with imprint ${pill.imprint}`,
          },
        ],
      }),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(images.length > 0 && { images: [images[0]] }),
    },
  }
}

export default async function PillDetailPage(
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const [pill, relatedData, similarPills] = await Promise.all([
    fetchPill(slug),
    fetchRelated(slug),
    fetchSimilar(slug),
  ])
  if (!pill) notFound()

  // Breadcrumb JSON-LD uses absolute URLs to match canonical
  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: `${SITE_URL}/` },
    ...(pill.drug_name && pill.drug_name !== 'Unknown'
      ? (() => {
          const drugSlug = slugifyDrugName(pill.drug_name)
          return drugSlug ? [{ name: pill.drug_name, url: `${SITE_URL}/drug/${drugSlug}` }] : []
        })()
      : []),
    { name: pill.drug_name ?? slug, url: `${SITE_URL}/pill/${encodeURIComponent(slug)}` },
  ])

  const rawTimestamp =
    pill.updated_at && typeof pill.updated_at === 'string' && pill.updated_at.length > 0
      ? pill.updated_at
      : undefined
  const lastUpdatedIso =
    rawTimestamp && !Number.isNaN(Date.parse(rawTimestamp)) ? rawTimestamp : undefined

  const formattedDate = lastUpdatedIso
    ? (() => {
        try {
          return new Date(lastUpdatedIso).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: 'UTC',
          })
        } catch {
          return undefined
        }
      })()
    : undefined

  const identificationSummary = buildIdentificationSummary(pill)

  const medPage = medicalWebPageSchema(pill, slug, {
    dateModified: lastUpdatedIso,
    reviewer: DEFAULT_REVIEWER,
    description: identificationSummary,
  })

  const faqItems = buildFaqItems(pill)

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbs) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(medPage) }}
      />
      {faqItems.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(faqSchema(faqItems)) }}
        />
      )}
      <PillDetailClient
        pill={pill}
        slug={slug}
        lastUpdatedIso={lastUpdatedIso}
        formattedDate={formattedDate}
        reviewer={DEFAULT_REVIEWER}
        related={relatedData.related}
        pharmaClass={relatedData.pharma_class ?? undefined}
        similar={similarPills}
        faqItems={faqItems}
        identificationSummary={identificationSummary}
      />
    </>
  )
}
