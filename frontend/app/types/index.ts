export interface PillResult {
  drug_name: string
  imprint: string
  color?: string
  shape?: string
  ndc?: string
  rxcui?: string
  slug?: string
  image_url?: string
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
