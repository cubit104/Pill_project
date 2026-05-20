import type { AlternativePrice } from './AlternativesTable'
import type { PriceHistoryPoint } from './PriceHistorySparkline'
import type { StrengthOption } from './StrengthSelector'

const NDC_DIGIT_LENGTH = 11

export interface PriceResponse {
  ndc: string
  price_per_unit: number
  unit: string
  effective_date: string
  source: string
  total_acquisition_cost: number
  fair_retail_low: number
  fair_retail_high: number
  match_type?: string
  matched_ndc?: string
  source_rxcui?: string
  resolved_ingredient?: string
  resolved_rxcui?: string
  equivalent_count?: number
  disclaimers: string[]
}

export interface AlternativesResponse {
  alternatives: AlternativePrice[]
  generic_vs_brand_ratio?: number | null
}

export interface HistoryResponse {
  history: PriceHistoryPoint[]
}

export interface StrengthsResponse {
  ndc: string
  ingredient: string | null
  ingredient_rxcui: string | null
  strengths: StrengthOption[]
}

export interface PriceCardInitialData {
  price: PriceResponse
  alternatives?: AlternativePrice[]
  history?: PriceHistoryPoint[]
  history_source?: 'ndc' | 'matched_ndc' | 'rxcui' | 'name'
  generic_vs_brand_ratio?: number | null
  strengths?: StrengthOption[]
  ingredient?: string | null
}

export interface PriceCardDownstreamResult {
  alternatives: AlternativePrice[]
  history: PriceHistoryPoint[]
  genericVsBrandRatio: number | null
  alternativesFailed: boolean
  historyFailed: boolean
  strengths: StrengthOption[]
  ingredient: string | null
}

/** Normalize an input to digits-only NDC-11 so exported helpers can share one rule. */
function normalizeNdcDigits(value?: string): string | null {
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  return digits.length === NDC_DIGIT_LENGTH ? digits : null
}

export function resolveDownstreamNdc(priceData: PriceResponse, fallbackNdc?: string): string | null {
  const matchedNdc = normalizeNdcDigits(priceData.matched_ndc)
  if (priceData.match_type === 'equivalent' && matchedNdc) {
    return matchedNdc
  }
  const fallbackDigits = normalizeNdcDigits(fallbackNdc)
  if (fallbackDigits) {
    return fallbackDigits
  }
  return normalizeNdcDigits(priceData.ndc)
}

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

async function fetchJsonOrNull<T>(fetchImpl: FetchImpl, url: string): Promise<T | null> {
  try {
    const response = await fetchImpl(url)
    if (!response.ok) return null
    return await response.json() as T
  } catch {
    return null
  }
}

export async function fetchPriceCardDownstream({
  apiBase,
  downstreamNdc,
  historyNdc,
  fetchImpl = fetch,
}: {
  apiBase: string
  downstreamNdc: string
  historyNdc?: string
  fetchImpl?: FetchImpl
}): Promise<PriceCardDownstreamResult> {
  const encoded = encodeURIComponent(downstreamNdc)
  const historyEncoded = encodeURIComponent(historyNdc || downstreamNdc)
  const [alternativesData, historyData, strengthsData] = await Promise.all([
    fetchJsonOrNull<AlternativesResponse>(fetchImpl, `${apiBase}/api/prices/${encoded}/alternatives`),
    fetchJsonOrNull<HistoryResponse>(fetchImpl, `${apiBase}/api/prices/${historyEncoded}/history?weeks=52`),
    fetchJsonOrNull<StrengthsResponse>(fetchImpl, `${apiBase}/api/prices/${encoded}/strengths`),
  ])

  return {
    alternatives: alternativesData?.alternatives || [],
    history: historyData?.history || [],
    genericVsBrandRatio: alternativesData?.generic_vs_brand_ratio ?? null,
    alternativesFailed: alternativesData === null,
    historyFailed: historyData === null,
    strengths: strengthsData?.strengths || [],
    ingredient: strengthsData?.ingredient ?? null,
  }
}
