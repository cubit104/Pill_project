import type { AlternativePrice } from './AlternativesTable'
import type { PriceHistoryPoint } from './PriceHistorySparkline'
import type { StrengthOption } from './StrengthSelector'

const NDC_DIGIT_LENGTH = 11
const HISTORY_WARMING_RETRY_DELAY_MS = 12_000

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
  price?: PriceResponse
  alternatives?: AlternativePrice[]
  history?: PriceHistoryPoint[]
  history_source?: 'ndc' | 'matched_ndc' | 'rxcui' | 'by_name'
  generic_vs_brand_ratio?: number | null
  strengths?: StrengthOption[]
  ingredient?: string | null
  estimate_basis?: string | null
  display_disclaimer?: string | null
  snapshot_present?: boolean
}

export interface PriceSnapshot {
  slug: string
  pill_id?: string | null
  resolved_ndc11?: string | null
  match_type: 'exact' | 'equivalent' | 'approximate' | 'none'
  resolved_via?: 'self' | 'sibling' | 'rxcui' | 'name' | null
  price_per_unit?: number | null
  unit?: string | null
  effective_date?: string | null
  total_acquisition_cost?: number | null
  fair_retail_low?: number | null
  fair_retail_high?: number | null
  history_52w?: PriceHistoryPoint[]
  history_source_ndc?: string | null
  alternatives?: AlternativePrice[]
  is_estimate?: boolean
  estimate_basis?: string | null
  display_disclaimer?: string | null
  schema_offers_valid?: boolean
  resolved_at?: string | null
  resolver_version?: number | null
  resolver_notes?: string | null
  created_at?: string | null
  updated_at?: string | null
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

const SNAPSHOT_PRICE_DISCLAIMERS = [
  'NADAC reflects pharmacy acquisition cost, not your out-of-pocket cost.',
  'Actual prices vary by pharmacy, insurance, and location.',
  'This is not medical advice. Always consult your pharmacist.',
]

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

export function isPriceSnapshot(value: PriceCardInitialData | PriceSnapshot | undefined): value is PriceSnapshot {
  return !!value && !('price' in value)
}

export function snapshotToPriceCardInitialData(snapshot: PriceSnapshot): PriceCardInitialData {
  const hasPrice =
    snapshot.price_per_unit != null &&
    snapshot.unit != null &&
    snapshot.effective_date != null &&
    snapshot.total_acquisition_cost != null &&
    snapshot.fair_retail_low != null &&
    snapshot.fair_retail_high != null

  const price = hasPrice
    ? {
        ndc: snapshot.resolved_ndc11 || snapshot.slug,
        price_per_unit: Number(snapshot.price_per_unit),
        unit: String(snapshot.unit),
        effective_date: String(snapshot.effective_date),
        source: 'NADAC (CMS)',
        total_acquisition_cost: Number(snapshot.total_acquisition_cost),
        fair_retail_low: Number(snapshot.fair_retail_low),
        fair_retail_high: Number(snapshot.fair_retail_high),
        disclaimers: SNAPSHOT_PRICE_DISCLAIMERS,
        ...(snapshot.match_type !== 'exact' ? { match_type: snapshot.match_type } : {}),
        ...(snapshot.resolved_ndc11 && snapshot.match_type !== 'exact'
          ? { matched_ndc: snapshot.resolved_ndc11 }
          : {}),
      }
    : undefined

  return {
    ...(price ? { price } : {}),
    alternatives: Array.isArray(snapshot.alternatives) ? snapshot.alternatives : [],
    history: Array.isArray(snapshot.history_52w) ? snapshot.history_52w : [],
    estimate_basis: snapshot.estimate_basis ?? null,
    display_disclaimer: snapshot.display_disclaimer ?? null,
    snapshot_present: true,
  }
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

async function fetchHistoryWithWarmRetry(fetchImpl: FetchImpl, url: string): Promise<HistoryResponse | null> {
  try {
    const response = await fetchImpl(url)
    if (!response.ok) return null
    const history = await response.json() as HistoryResponse
    const isWarming = response.headers.get('X-Price-History')?.toLowerCase() === 'warming'
    if (isWarming && Array.isArray(history.history) && history.history.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, HISTORY_WARMING_RETRY_DELAY_MS))
      const retryResponse = await fetchImpl(url)
      if (!retryResponse.ok) return history
      return await retryResponse.json() as HistoryResponse
    }
    return history
  } catch {
    return null
  }
}

export async function fetchPriceCardDownstream({
  apiBase,
  downstreamNdc,
  historyNdc,
  priceResponse,
  fetchImpl = fetch,
}: {
  apiBase: string
  downstreamNdc: string
  historyNdc?: string | null
  priceResponse?: PriceResponse | null
  fetchImpl?: FetchImpl
}): Promise<PriceCardDownstreamResult> {
  const encoded = encodeURIComponent(downstreamNdc)
  // When the price card displays an equivalent-NDC fallback price (the user's own
  // NDC has no NADAC row, so we matched on RxCUI/ingredient), the history graph
  // must use the SAME equivalent NDC. Otherwise we'd query history for an NDC
  // we already know has zero NADAC rows and render an empty graph.
  const priceMatchedNdc =
    priceResponse?.match_type === 'equivalent' && priceResponse?.matched_ndc
      ? normalizeNdcDigits(String(priceResponse.matched_ndc))
      : null
  const ndcForHistory = priceMatchedNdc ?? historyNdc
  const historyPath = ndcForHistory === null
    ? null
    : `${apiBase}/api/prices/${encodeURIComponent(ndcForHistory || downstreamNdc)}/history?weeks=52`
  const [alternativesData, historyData, strengthsData] = await Promise.all([
    fetchJsonOrNull<AlternativesResponse>(fetchImpl, `${apiBase}/api/prices/${encoded}/alternatives`),
    historyPath ? fetchHistoryWithWarmRetry(fetchImpl, historyPath) : Promise.resolve({ history: [] }),
    fetchJsonOrNull<StrengthsResponse>(fetchImpl, `${apiBase}/api/prices/${encoded}/strengths`),
  ])

  return {
    alternatives: alternativesData?.alternatives || [],
    history: historyData?.history || [],
    genericVsBrandRatio: alternativesData?.generic_vs_brand_ratio ?? null,
    alternativesFailed: alternativesData === null,
    historyFailed: historyPath !== null && historyData === null,
    strengths: strengthsData?.strengths || [],
    ingredient: strengthsData?.ingredient ?? null,
  }
}
