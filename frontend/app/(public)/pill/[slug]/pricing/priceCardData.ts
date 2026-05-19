import type { AlternativePrice } from './AlternativesTable'
import type { PriceHistoryPoint } from './PriceHistorySparkline'

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

export interface PriceCardInitialData {
  price: PriceResponse
  alternatives?: AlternativePrice[]
  history?: PriceHistoryPoint[]
  generic_vs_brand_ratio?: number | null
}

export interface PriceCardDownstreamResult {
  alternatives: AlternativePrice[]
  history: PriceHistoryPoint[]
  genericVsBrandRatio: number | null
  alternativesFailed: boolean
  historyFailed: boolean
}

function normalizeNdcDigits(value?: string): string | null {
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  return digits.length === 11 ? digits : null
}

export function resolveDownstreamNdc(priceData: PriceResponse, fallbackNdc?: string): string | null {
  const matchedNdc = normalizeNdcDigits(priceData.matched_ndc)
  if (priceData.match_type === 'equivalent' && matchedNdc) {
    return matchedNdc
  }
  return normalizeNdcDigits(fallbackNdc)
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
  fetchImpl = fetch,
}: {
  apiBase: string
  downstreamNdc: string
  fetchImpl?: FetchImpl
}): Promise<PriceCardDownstreamResult> {
  const encoded = encodeURIComponent(downstreamNdc)
  const [alternativesData, historyData] = await Promise.all([
    fetchJsonOrNull<AlternativesResponse>(fetchImpl, `${apiBase}/api/prices/${encoded}/alternatives`),
    fetchJsonOrNull<HistoryResponse>(fetchImpl, `${apiBase}/api/prices/${encoded}/history?weeks=52`),
  ])

  return {
    alternatives: alternativesData?.alternatives || [],
    history: historyData?.history || [],
    genericVsBrandRatio: alternativesData?.generic_vs_brand_ratio ?? null,
    alternativesFailed: alternativesData === null,
    historyFailed: historyData === null,
  }
}
