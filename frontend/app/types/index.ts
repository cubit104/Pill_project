export interface PillResult {
  drug_name: string
  imprint: string
  color?: string
  shape?: string
  ndc?: string
  ndc9?: string
  rxcui?: string
  slug?: string
  image_url?: string
  images?: string[]
  has_multiple_images?: boolean
  carousel_images?: Array<{ id: number; url: string }>
  strength?: string
  manufacturer?: string
}

export interface DrugIndication {
  plain_text: string
  source_url: string | null
  source: string
  fetched_at: string | null
}

export interface PillDetail extends PillResult {
  ingredients?: string
  inactive_ingredients?: string
  dea_schedule?: string
  pharma_class?: string
  size?: string
  images?: string[]
  dosage_form?: string
  brand_names?: string
  status_rx_otc?: string
  route?: string
  /** DailyMed SPL Set ID — links to https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=... */
  spl_set_id?: string
  /** ISO 8601 timestamp from the DB (updated_at / last_updated / ingested_at). */
  updated_at?: string
  /** Alt text for the pill image (accessibility + SEO). */
  image_alt_text?: string
  /** Stored SEO title — auto-generated from pill fields and editable in admin. */
  meta_title?: string
  /** Pre-generated SEO meta description stored in the DB. */
  meta_description?: string
  /** Patient-friendly drug indication from drug_indications table. */
  indication?: DrugIndication | null
}

export interface SimilarPill {
  slug: string
  drug_name: string
  strength?: string
  imprint?: string
  color?: string
  shape?: string
  manufacturer?: string
  image_url?: string
}

export interface RelatedDrug {
  drug_name: string
  strength?: string
  slug: string
  color?: string
  shape?: string
  image_url?: string
}

export interface ConditionDrug {
  drug_name: string
  strength?: string
  slug: string
  image_url?: string
  shared_tags: string[]
}

export interface FilterOption {
  name: string
  hex?: string
  icon?: string
}

export interface FiltersResponse {
  colors: FilterOption[]
  shapes: FilterOption[]
}

export interface SearchResponse {
  results: PillResult[]
  total: number
  page: number
  per_page: number
  total_pages: number
}
