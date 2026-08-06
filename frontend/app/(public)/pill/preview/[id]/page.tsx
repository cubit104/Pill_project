'use client'

import { useEffect, useMemo, useState } from 'react'
import type { PillDetail, RelatedDrug, SimilarPill, ConditionDrug } from '../../../../types'
import PillDetailClient from '../../[slug]/PillDetailClient'
import { DEFAULT_REVIEWER } from '../../../../lib/reviewers'
import { buildIdentificationSummary } from '../../../../lib/structured-data'
import { createClient } from '../../../../admin/lib/supabase'

function mapRawPill(raw: any): PillDetail {
  const brandOrGeneric = raw.brand_or_generic === 'brand' || raw.brand_or_generic === 'generic'
    ? raw.brand_or_generic
    : undefined

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
    generic_name: raw.generic_name ?? null,
    brand_names_all: Array.isArray(raw.brand_names_all) ? raw.brand_names_all : [],
    is_brand_row: Boolean(raw.is_brand_row),
    brand_or_generic: brandOrGeneric,
    generic_for: raw.generic_for ?? raw.brand_names,
    status_rx_otc: raw.status_rx_otc,
    route: raw.route,
    meta_title: raw.meta_title ?? undefined,
    image_url: raw.image_url ?? (Array.isArray(raw.image_urls) ? raw.image_urls[0] : undefined),
    images: raw.images ?? raw.image_urls ?? [],
    spl_set_id: raw.spl_set_id ?? undefined,
    updated_at: raw.updated_at ?? undefined,
    meta_description: raw.meta_description ?? undefined,
    indication: raw.indication ?? null,
    history_ndc: raw.history_ndc ?? null,
    history_source: raw.history_source ?? null,
    has_medguide: typeof raw.has_medguide === 'boolean' ? raw.has_medguide : undefined,
    has_medication_summary:
      typeof raw.has_medication_summary === 'boolean' ? raw.has_medication_summary : undefined,
    has_dosage: typeof raw.has_dosage === 'boolean' ? raw.has_dosage : undefined,
    has_adverse_reactions:
      typeof raw.has_adverse_reactions === 'boolean' ? raw.has_adverse_reactions : undefined,
  }
}

function classifyDeaSchedule(raw: string | null | undefined): '1' | '2' | '3' | '4' | '5' | 'not-controlled' | 'no-data' {
  if (!raw || !raw.trim()) return 'no-data'
  const v = raw.trim().toLowerCase()
  const lookup: Record<string, '1' | '2' | '3' | '4' | '5'> = {
    ci: '1', cii: '2', ciii: '3', civ: '4', cv: '5',
    i: '1', ii: '2', iii: '3', iv: '4', v: '5',
    '1': '1', '2': '2', '3': '3', '4': '4', '5': '5',
    'schedule i': '1', 'schedule ii': '2', 'schedule iii': '3', 'schedule iv': '4', 'schedule v': '5',
    'schedule 1': '1', 'schedule 2': '2', 'schedule 3': '3', 'schedule 4': '4', 'schedule 5': '5',
  }
  if (lookup[v]) return lookup[v]
  const notControlled = ['na', 'n/a', 'none', 'unscheduled', '0', 'not applicable']
  if (notControlled.includes(v)) return 'not-controlled'
  return 'no-data'
}

function buildFaqItems(pill: PillDetail): Array<{ question: string; answer: string }> {
  const items: Array<{ question: string; answer: string }> = []

  if (pill.drug_name && pill.drug_name !== 'Unknown') {
    const namePart = `This pill is identified as ${pill.drug_name}${pill.strength ? ` ${pill.strength}` : ''}`
    const formPart = pill.dosage_form ? `, a ${pill.dosage_form}` : ''
    const mfrPart = pill.manufacturer ? ` manufactured by ${pill.manufacturer}` : ''
    items.push({ question: 'What is this pill?', answer: `${namePart}${formPart}${mfrPart}.` })
  }

  if (pill.imprint) {
    const physicalDesc = [pill.color, pill.shape].filter(Boolean).join(' ')
    items.push({
      question: `What does the imprint "${pill.imprint}" mean?`,
      answer: `The imprint "${pill.imprint}" on this${physicalDesc ? ` ${physicalDesc}` : ''} pill helps identify it as ${pill.drug_name && pill.drug_name !== 'Unknown' ? pill.drug_name : 'this medication'}${pill.strength ? ` (${pill.strength})` : ''}. Imprints are required by the FDA so each pill can be uniquely identified.`,
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

  const scheduleLabels: Record<string, string> = {
    '1': 'a Schedule I controlled substance with high abuse potential and no accepted medical use',
    '2': 'a Schedule II controlled substance with high abuse potential and severe dependence risk',
    '3': 'a Schedule III controlled substance with moderate abuse potential',
    '4': 'a Schedule IV controlled substance with low abuse potential',
    '5': 'a Schedule V controlled substance — the lowest abuse potential among controlled substances',
  }
  const deaResult = classifyDeaSchedule(pill.dea_schedule)
  const drugLabel = pill.drug_name && pill.drug_name !== 'Unknown' ? pill.drug_name : 'this medication'
  const deaAnswer = deaResult === 'no-data'
    ? 'No data available.'
    : deaResult === 'not-controlled'
    ? `No, ${drugLabel} is not a controlled substance.`
    : `Yes, ${drugLabel} is classified as ${scheduleLabels[deaResult]}.`

  items.push({ question: 'Is this medication a controlled substance?', answer: deaAnswer })
  return items
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, init)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export default function PillPreviewPage({ params }: { params: { id: string } }) {
  const pillId = params.id
  const [pill, setPill] = useState<PillDetail | null>(null)
  const [related, setRelated] = useState<RelatedDrug[]>([])
  const [pharmaClass, setPharmaClass] = useState<string | undefined>()
  const [similar, setSimilar] = useState<SimilarPill[]>([])
  const [conditionDrugs, setConditionDrugs] = useState<ConditionDrug[]>([])
  const [conditionTags, setConditionTags] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError(null)

      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) {
        if (!cancelled) {
          setError('Admin session expired. Please sign in again and reopen the preview.')
          setLoading(false)
        }
        return
      }

      const raw = await fetchJson<any>(`/api/pill/preview/${encodeURIComponent(pillId)}`, {
        headers: { Authorization: `****** },
        cache: 'no-store',
      })
      if (!raw) {
        if (!cancelled) {
          setError('Unable to load draft preview.')
          setLoading(false)
        }
        return
      }

      const nextPill = mapRawPill(raw)
      if (cancelled) return
      setPill(nextPill)

      if (!nextPill.slug) {
        setRelated([])
        setPharmaClass(undefined)
        setSimilar([])
        setConditionDrugs([])
        setConditionTags([])
        setLoading(false)
        return
      }

      const [relatedData, similarData, conditionData] = await Promise.all([
        fetchJson<{ pharma_class: string | null; related: RelatedDrug[] }>(`/api/related/${encodeURIComponent(nextPill.slug)}`),
        fetchJson<SimilarPill[]>(`/api/pill/${encodeURIComponent(nextPill.slug)}/similar`),
        fetchJson<{ tags: string[]; drugs: ConditionDrug[] }>(`/api/pill/${encodeURIComponent(nextPill.slug)}/condition-drugs`),
      ])

      if (cancelled) return
      setRelated(relatedData?.related ?? [])
      setPharmaClass(relatedData?.pharma_class ?? undefined)
      setSimilar(similarData ?? [])
      setConditionDrugs(conditionData?.drugs ?? [])
      setConditionTags(conditionData?.tags ?? [])
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [pillId])

  const lastUpdatedIso = useMemo(() => {
    const value = pill?.updated_at
    return value && !Number.isNaN(Date.parse(value)) ? value : undefined
  }, [pill?.updated_at])

  const formattedDate = useMemo(() => {
    if (!lastUpdatedIso) return undefined
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
  }, [lastUpdatedIso])

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="sticky top-0 z-50 border-b border-amber-300 bg-amber-100 px-4 py-3 text-center text-sm font-semibold text-amber-900">
        DRAFT - Not Published
      </div>
      {loading && (
        <div className="mx-auto max-w-3xl px-4 py-12 text-center text-slate-600">
          Loading draft preview…
        </div>
      )}
      {!loading && error && (
        <div className="mx-auto max-w-3xl px-4 py-12">
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        </div>
      )}
      {!loading && pill && (
        <PillDetailClient
          pill={pill}
          slug={pill.slug}
          lastUpdatedIso={lastUpdatedIso}
          formattedDate={formattedDate}
          reviewer={DEFAULT_REVIEWER}
          related={related}
          pharmaClass={pharmaClass}
          similar={similar}
          conditionDrugs={conditionDrugs}
          conditionTags={conditionTags}
          faqItems={buildFaqItems(pill)}
          identificationSummary={buildIdentificationSummary(pill)}
          trackView={false}
        />
      )}
    </div>
  )
}
