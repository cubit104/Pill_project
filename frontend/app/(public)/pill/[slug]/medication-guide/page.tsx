import { notFound } from 'next/navigation'
import MedicationGuideClient from './MedicationGuideClient'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/

interface PillLite {
  drug_name: string
  spl_set_id?: string
  updated_at?: string
}

interface MedicationGuideApiResponse {
  medication_guide_html?: string
  medication_guide_text?: string
  medguide_html?: string
  medguide_text?: string
  professional_html?: string
  professional_text?: string
  full_prescribing_information_html?: string
  full_prescribing_information_text?: string
  boxed_warning_html?: string
  poison_help_text?: string
  source_url?: string
  dailymed_url?: string
  url?: string
  updated_at?: string
  fetched_at?: string
  condition_tags?: string[]
  mentioned_drugs?: string[]
  drug_names?: string[]
}

async function fetchPill(slug: string): Promise<PillLite | null> {
  try {
    const res = await fetch(`${API_BASE}/api/pill/${encodeURIComponent(slug)}`, {
      next: { revalidate: 900 },
    })
    if (res.status === 404) return null
    if (!res.ok) return null
    const raw = await res.json()
    return {
      drug_name: raw.drug_name ?? raw.medicine_name ?? 'Unknown',
      spl_set_id: raw.spl_set_id ?? raw.setid,
      updated_at: raw.updated_at ?? undefined,
    }
  } catch {
    return null
  }
}

function pickFirstString(payload: MedicationGuideApiResponse | null, keys: Array<keyof MedicationGuideApiResponse>): string {
  if (!payload) return ''
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

function pickStringArray(payload: MedicationGuideApiResponse | null, keys: Array<keyof MedicationGuideApiResponse>): string[] {
  if (!payload) return []
  for (const key of keys) {
    const value = payload[key]
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string' && !!item.trim())
    }
  }
  return []
}

async function fetchGuide(slug: string, splSetId?: string): Promise<MedicationGuideApiResponse | null> {
  const candidates: string[] = [
    `${API_BASE}/api/pill/${encodeURIComponent(slug)}/medication-guide?include_professional=true&include_boxed_warning=true`,
    `${API_BASE}/api/pill/${encodeURIComponent(slug)}/medication-guide`,
  ]

  if (splSetId) {
    candidates.push(`${API_BASE}/api/medication-guide/${encodeURIComponent(splSetId)}?include_professional=true&include_boxed_warning=true`)
    candidates.push(`${API_BASE}/api/medication-guide/${encodeURIComponent(splSetId)}`)
  }

  for (const url of candidates) {
    try {
      const res = await fetch(url, { next: { revalidate: 3600 } })
      if (!res.ok) continue
      return await res.json()
    } catch {
      continue
    }
  }
  return null
}

export default async function MedicationGuidePage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const pill = await fetchPill(slug)
  if (!pill) notFound()

  const guide = await fetchGuide(slug, pill.spl_set_id)

  const medicationGuideContent = pickFirstString(guide, [
    'medication_guide_html',
    'medguide_html',
    'medication_guide_text',
    'medguide_text',
  ])
  const professionalContent = pickFirstString(guide, [
    'professional_html',
    'full_prescribing_information_html',
    'professional_text',
    'full_prescribing_information_text',
  ])

  const sourceUrl = pickFirstString(guide, ['source_url', 'dailymed_url', 'url'])
  const warningContent = pickFirstString(guide, ['poison_help_text', 'boxed_warning_html'])

  const rawUpdatedAt = pickFirstString(guide, ['updated_at', 'fetched_at']) || pill.updated_at || ''
  const lastUpdatedIso =
    rawUpdatedAt && ISO_DATE_PATTERN.test(rawUpdatedAt)
      ? rawUpdatedAt
      : undefined
  const formattedDate = lastUpdatedIso
    ? new Date(lastUpdatedIso).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
      })
    : undefined

  const conditionTags = pickStringArray(guide, ['condition_tags'])
  const mentionedDrugNames = pickStringArray(guide, ['mentioned_drugs', 'drug_names'])

  return (
    <MedicationGuideClient
      slug={slug}
      drugName={pill.drug_name}
      medicationGuideContent={medicationGuideContent}
      professionalContent={professionalContent}
      sourceUrl={sourceUrl}
      warningContent={warningContent}
      lastUpdatedIso={lastUpdatedIso}
      formattedDate={formattedDate}
      conditionTags={conditionTags}
      mentionedDrugNames={mentionedDrugNames}
    />
  )
}
