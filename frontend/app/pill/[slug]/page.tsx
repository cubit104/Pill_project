import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import PillDetailClient from './PillDetailClient'
import type { PillDetail } from '../../types'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'

async function fetchPill(slug: string): Promise<PillDetail | null> {
  try {
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
  } catch {
    return null
  }
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params
  const pill = await fetchPill(slug)
  if (!pill) {
    return { title: 'Pill Not Found — IDMyPills' }
  }
  const title = `${pill.drug_name}${pill.imprint ? ` (${pill.imprint})` : ''} — IDMyPills`
  const description = `Identify ${pill.drug_name} pill${pill.imprint ? ` with imprint ${pill.imprint}` : ''}.${pill.color ? ` ${pill.color}` : ''}${pill.shape ? ` ${pill.shape}` : ''}${pill.strength ? ` ${pill.strength}` : ''}. View images and full drug information.`
  const images = pill.images && pill.images.length > 0
    ? pill.images
    : pill.image_url
    ? [pill.image_url]
    : []
  return {
    title,
    description,
    alternates: { canonical: `/pill/${slug}` },
    openGraph: {
      title,
      description,
      ...(images.length > 0 && { images: [{ url: images[0] }] }),
    },
  }
}

export default async function PillDetailPage(
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const pill = await fetchPill(slug)
  if (!pill) notFound()
  return <PillDetailClient pill={pill} />
}
