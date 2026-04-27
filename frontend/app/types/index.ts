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
  /** Pre-generated SEO meta description stored in the DB (≤155 chars). */
  meta_description?: string
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
