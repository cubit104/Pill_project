'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '../../../lib/supabase'
import PillDetailClient from '../../../../(public)/pill/[slug]/PillDetailClient'
import type { PillDetail } from '../../../../types'

interface PreviewData {
  draft_id: string
  draft_status: string
  pill_id: string | null
  medicine_name?: string | null
  splimprint?: string | null
  splcolor_text?: string | null
  splshape_text?: string | null
  spl_strength?: string | null
  spl_ingredients?: string | null
  spl_inactive_ing?: string | null
  dosage_form?: string | null
  route?: string | null
  dea_schedule_name?: string | null
  pharmclass_fda_epc?: string | null
  ndc9?: string | null
  ndc11?: string | null
  rxcui?: string | null
  slug?: string | null
  meta_title?: string | null
  meta_description?: string | null
  image_filename?: string | null
  image_url?: string | null
  images?: string[]
  has_image?: boolean | null
  image_alt_text?: string | null
  brand_names?: string | null
  author?: string | null
  tags?: string | null
  status_rx_otc?: string | null
  splsize?: string | null
}

function mapToPillDetail(raw: PreviewData): PillDetail {
  return {
    drug_name: raw.medicine_name ?? 'Unknown',
    imprint: raw.splimprint ?? '',
    color: raw.splcolor_text ?? undefined,
    shape: raw.splshape_text ?? undefined,
    ndc: raw.ndc11 ?? undefined,
    ndc9: raw.ndc9 ?? undefined,
    rxcui: raw.rxcui ?? undefined,
    slug: raw.slug ?? '',
    strength: raw.spl_strength ?? undefined,
    manufacturer: raw.author ?? undefined,
    ingredients: raw.spl_ingredients ?? undefined,
    inactive_ingredients: raw.spl_inactive_ing ?? undefined,
    dea_schedule: raw.dea_schedule_name ?? undefined,
    pharma_class: raw.pharmclass_fda_epc ?? undefined,
    size: raw.splsize ? String(raw.splsize) : undefined,
    dosage_form: raw.dosage_form ?? undefined,
    brand_names: raw.brand_names ?? undefined,
    generic_name: null,
    brand_names_all: [],
    is_brand_row: false,
    brand_or_generic: undefined,
    generic_for: raw.brand_names ?? undefined,
    status_rx_otc: raw.status_rx_otc ?? undefined,
    route: raw.route ?? undefined,
    meta_title: raw.meta_title ?? undefined,
    image_url: raw.image_url ?? undefined,
    images: raw.images ?? [],
    spl_set_id: undefined,
    updated_at: undefined,
    meta_description: raw.meta_description ?? undefined,
    indication: null,
    history_ndc: null,
    history_source: null,
    has_medguide: undefined,
    has_medication_summary: undefined,
    has_dosage: undefined,
    has_adverse_reactions: undefined,
  }
}

export default function DraftPreviewPage() {
  const params = useParams()
  const router = useRouter()
  const rawId = params?.id
  const draftId = Array.isArray(rawId) ? rawId[0] : rawId

  const [previewData, setPreviewData] = useState<PreviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        setLoading(false)
        router.push('/admin/login')
        return
      }

      if (!draftId) {
        setError('Invalid draft ID.')
        setLoading(false)
        return
      }

      try {
        const res = await fetch(`/api/admin/drafts/${draftId}/preview`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (res.status === 404) {
          setError('Draft not found.')
          setLoading(false)
          return
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          setError(body.detail || `Request failed with status ${res.status}`)
          return
        }
        setPreviewData(await res.json())
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [draftId, router])

  if (loading) {
    return (
      <div className="p-8 text-gray-500 text-center">Loading preview…</div>
    )
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-md mb-4">{error}</div>
        <Link href="/admin/drafts" className="text-sm text-indigo-600 hover:underline">
          ← Back to Drafts
        </Link>
      </div>
    )
  }

  if (!previewData) return null

  const pill = mapToPillDetail(previewData)

  return (
    <div>
      {/* Preview banner */}
      <div className="sticky top-0 z-50 bg-yellow-400 text-yellow-900 px-4 py-2 flex items-center justify-between shadow-md">
        <span className="font-semibold text-sm">
          ⚠️ PREVIEW MODE — This draft has not been published. Status:{' '}
          <span className="uppercase font-bold">{previewData.draft_status}</span>
        </span>
        <Link
          href="/admin/drafts"
          className="text-sm font-medium underline hover:text-yellow-800"
        >
          ← Back to Drafts
        </Link>
      </div>

      {/* Pill detail rendered as it would appear on the public page */}
      <PillDetailClient
        pill={pill}
        slug={pill.slug || previewData.draft_id}
        lastUpdatedIso={undefined}
        formattedDate={undefined}
        related={[]}
        pharmaClass={undefined}
        similar={[]}
        conditionDrugs={[]}
        conditionTags={[]}
        faqItems={[]}
        identificationSummary=""
        priceInitialData={undefined}
      />
    </div>
  )
}
