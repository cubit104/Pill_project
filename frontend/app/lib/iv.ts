/**
 * IV drugs and the all-drugs A to Z index: types and server-side fetchers.
 *
 * One IV drug = one row in the backend (public.iv_drugs). Its FDA label comes through the same
 * by-setid guide endpoint the pill pages use, so every label page can share the pill templates.
 */

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const IV_REVALIDATE_SECONDS = 3600
const GUIDE_REVALIDATE_SECONDS = 86400

export type CardStatus = 'stated' | 'not_stated' | 'not_applicable'

export interface IvCardField {
  status: CardStatus
  value: string
  quotes: Array<{ section: string; text: string }>
}

export interface IvCard {
  fields: Record<string, IvCardField>
  reviewed_at: string | null
  label_version: number | null
  label_updated_since: boolean
}

export interface IvStrength {
  strength: string
  form: string
  makers: number
}

export interface IvDrug {
  slug: string
  name: string
  brand_names: string[]
  drug_class: string[]
  routes: string[]
  dea_schedule: string | null
  spl_set_id: string
  label: {
    type: 'brand' | 'authorized_generic' | 'generic' | 'unapproved' | null
    brand: string | null
    maker: string | null
    presentation: string | null
    version: number | null
    date: string | null
    source_url: string
  }
  label_pages: {
    has_professional: boolean
    has_dosage: boolean
    has_adverse_reactions: boolean
    has_medguide: boolean
    has_boxed_warning: boolean
  }
  strengths: IvStrength[]
  product_count: number
  maker_count: number
  card: IvCard | null
  pill_drugs: Array<{ name: string; pill_count: number }>
  meta_title: string | null
  meta_description: string | null
  updated_at: string | null
}

export interface IvListItem {
  slug: string
  name: string
  brand_names: string[]
  drug_class: string[]
  has_card: boolean
}

export interface DrugIndexEntry {
  name: string
  pill_count: number
  iv_slug: string | null
}

export interface DrugIndex {
  prefix: string
  entries: DrugIndexEntry[]
  letters: Record<string, number>
  pairs: Record<string, number>
}

export const INDEX_LETTERS = [...'abcdefghijklmnopqrstuvwxyz', '0-9']

async function getJson<T>(path: string, revalidate: number): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { next: { revalidate } })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

export function fetchIvDrug(slug: string): Promise<IvDrug | null> {
  return getJson<IvDrug>(`/api/iv/${encodeURIComponent(slug)}`, IV_REVALIDATE_SECONDS)
}

export async function fetchIvList(): Promise<IvListItem[]> {
  const data = await getJson<{ results: IvListItem[] }>('/api/iv?per_page=600', IV_REVALIDATE_SECONDS)
  return data?.results ?? []
}

/** True once at least one IV drug is published: until then no menu link, home card or sitemap entry points at /iv. */
export async function hasPublishedIvDrugs(): Promise<boolean> {
  const data = await getJson<{ total: number }>('/api/iv?per_page=1', IV_REVALIDATE_SECONDS)
  return (data?.total ?? 0) > 0
}

/** The published IV drug with the same name as a pill drug page (`/drug/<slug>`), for its "Also given by IV" box. */
export async function fetchIvForPillDrug(pillDrugSlug: string): Promise<Array<{ name: string; slug: string }>> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(pillDrugSlug)) return []
  const data = await getJson<{ results: Array<{ name: string; slug: string }> }>(
    `/api/iv/for-pill-drug?name=${encodeURIComponent(pillDrugSlug)}`,
    IV_REVALIDATE_SECONDS,
  )
  return data?.results ?? []
}

/**
 * An IV drug page is worth indexing once it has something of its own: an approved card, or a label behind its tabs.
 * The label pages themselves are always noindex (they reprint the label), the same rule the pill label pages follow.
 */
export function isIvPageIndexable(page: {
  hasCard: boolean
  hasProfessional: boolean
  hasDosage: boolean
  hasAdverseReactions: boolean
}): boolean {
  return page.hasCard || page.hasProfessional || page.hasDosage || page.hasAdverseReactions
}

export function fetchDrugIndex(prefix: string): Promise<DrugIndex | null> {
  return getJson<DrugIndex>(`/api/drug-index?prefix=${encodeURIComponent(prefix)}`, IV_REVALIDATE_SECONDS)
}

export interface IvLabelSections {
  name: string
  spl_set_id: string
  dosage_administration: string | null
  dosage_forms_and_strengths: string | null
  adverse_reactions: string | null
  boxed_warning_html: string | null
  source_url: string | null
  fetched_at: string | null
}

export function fetchIvLabelSections(slug: string): Promise<IvLabelSections | null> {
  return getJson<IvLabelSections>(`/api/iv/${encodeURIComponent(slug)}/label-sections`, GUIDE_REVALIDATE_SECONDS)
}

/** The FDA label of an IV drug, from the same cache and endpoint the pill label pages use. */
export function fetchIvGuide<T>(
  splSetId: string,
  include: { professional?: boolean; medguide?: boolean; boxedWarning?: boolean } = {},
): Promise<T | null> {
  const params = new URLSearchParams({
    include_professional: String(Boolean(include.professional)),
    include_medguide: String(Boolean(include.medguide)),
    include_boxed_warning: String(Boolean(include.boxedWarning)),
  })
  return getJson<T>(`/api/drugs/by-setid/${encodeURIComponent(splSetId)}/guide?${params}`, GUIDE_REVALIDATE_SECONDS)
}

/** Links shared by every page of one IV drug; a tab is null when the label has nothing for it. */
export function ivTabHrefs(drug: IvDrug) {
  const base = `/iv/${drug.slug}`
  return {
    ivCardHref: base,
    // few IV drugs have an FDA medication guide; that page is not built yet, so no tab for now
    medicationGuideHref: null as string | null,
    dosageHref: drug.label_pages.has_dosage ? `${base}/dosage` : null,
    adverseReactionsHref: drug.label_pages.has_adverse_reactions ? `${base}/side-effects` : null,
    professionalHref: `${base}/professional-information`,
  }
}

// some injections are also labelled for a non-injection route (vancomycin vials can be given by mouth);
// on an IV page that reads as a mistake, so the header lists injection routes only
const NON_INJECTION_ROUTES = /oral|topical|ophthalmic|rectal|nasal|irrigation|inhalation|dental/i

export function ivHeaderProps(drug: IvDrug) {
  const routes = drug.routes.filter((route) => !NON_INJECTION_ROUTES.test(route))
  return {
    drugName: drug.name,
    genericName: drug.name,
    brandName: drug.brand_names.join(', ') || null,
    drugClass: drug.drug_class.join('; ') || null,
    dosageForm: `Injection (${routes.join(', ') || 'Intravenous'})`,
    isBrandPrimary: false,
    slug: drug.slug,
  }
}
