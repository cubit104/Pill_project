import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import PillDetailClient from './PillDetailClient'
import type { PillDetail } from '../../types'
import {
  breadcrumbSchema,
  medicalWebPageSchema,
  safeJsonLd,
} from '../../lib/structured-data'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com'
).replace(/\/$/, '')

async function fetchPill(slug: string): Promise<PillDetail | null> {
  const res = await fetch(`${API_BASE}/api/pill/${encodeURIComponent(slug)}`, {
    next: { revalidate: 3600 },
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
    image_url: raw.image_url ?? (Array.isArray(raw.image_urls) ? raw.image_urls[0] : undefined),
    images: raw.images ?? raw.image_urls ?? [],
  }
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

  // Build SEO title: {Color} {Shape} {Drug Name} {Strength} Pill With Imprint {Imprint} | PillSeek
  const titleParts = [
    pill.color,
    pill.shape,
    pill.drug_name,
    pill.strength,
    'Pill',
    pill.imprint ? `With Imprint ${pill.imprint}` : null,
  ].filter(Boolean)
  const title = titleParts.join(' ')

  // Build meta description ≤155 chars
  const descParts = [
    `Identify the ${[pill.color, pill.shape].filter(Boolean).join(' ')} ${pill.drug_name}`,
    pill.strength ? `${pill.strength}` : null,
    pill.imprint ? `pill with imprint ${pill.imprint}` : 'pill',
    '— view images, drug info, ingredients, and manufacturer details.',
  ].filter(Boolean)
  const description = descParts.join(' ').slice(0, 155)

  const images = pill.images && pill.images.length > 0
    ? pill.images
    : pill.image_url
    ? [pill.image_url]
    : []

  const canonicalUrl = `${SITE_URL}/pill/${encodeURIComponent(slug)}`

  // Determine indexability — only index if we have meaningful data
  const hasData = !!(pill.drug_name && pill.drug_name !== 'Unknown' && (pill.imprint || pill.ndc))
  const robots = hasData
    ? { index: true, follow: true }
    : { index: false, follow: true }

  return {
    title,
    description,
    robots,
    alternates: { canonical: `/pill/${encodeURIComponent(slug)}` },
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
  const pill = await fetchPill(slug)
  if (!pill) notFound()

  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    ...(pill.drug_name && pill.drug_name !== 'Unknown'
      ? [{ name: pill.drug_name, url: `/drug/${encodeURIComponent(pill.drug_name.toLowerCase())}` }]
      : []),
    { name: pill.drug_name ?? slug, url: `/pill/${encodeURIComponent(slug)}` },
  ])

  const medPage = medicalWebPageSchema(pill, slug)

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
      <PillDetailClient pill={pill} slug={slug} />
    </>
  )
}
