import {
  fetchPriceCardDownstream,
  resolveDownstreamNdc,
  type PriceCardInitialData,
  type PriceSnapshot,
  type PriceResponse,
} from '../pricing/priceCardData'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const PRICE_DATA_FETCH_TIMEOUT_MS = 2500

async function fetchPriceJson(
  url: string,
  signal: AbortSignal,
): Promise<PriceResponse | null> {
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal,
    })
    if (!response.ok) return null
    return await response.json() as PriceResponse
  } catch {
    return null
  }
}

export async function fetchPriceSnapshot(slug: string): Promise<PriceSnapshot | null> {
  try {
    const response = await fetch(`${API_BASE}/api/snapshot/${encodeURIComponent(slug)}`, {
      next: { revalidate: 300 },
    })
    if (response.status === 404) return null
    if (!response.ok) return null
    return await response.json() as PriceSnapshot
  } catch {
    return null
  }
}

export async function fetchInitialPriceData({
  ndc,
  rxcui,
  medicineName,
  historyNdc,
  historySource,
}: {
  ndc?: string
  rxcui?: string
  medicineName?: string
  historyNdc?: string | null
  historySource?: 'ndc' | 'matched_ndc' | 'rxcui' | 'by_name' | null
}): Promise<PriceCardInitialData | undefined> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PRICE_DATA_FETCH_TIMEOUT_MS)
  try {
    const price =
      (ndc && await fetchPriceJson(`${API_BASE}/api/prices/${encodeURIComponent(ndc)}`, controller.signal)) ||
      (rxcui && await fetchPriceJson(`${API_BASE}/api/prices/by-rxcui/${encodeURIComponent(rxcui)}`, controller.signal)) ||
      (medicineName && await fetchPriceJson(`${API_BASE}/api/prices/by-name/${encodeURIComponent(medicineName)}`, controller.signal))

    if (!price) return undefined

    const downstreamNdc = resolveDownstreamNdc(price, ndc)
    if (!downstreamNdc) {
      return { price }
    }

    const downstream = await fetchPriceCardDownstream({
      apiBase: API_BASE,
      downstreamNdc,
      historyNdc: historyNdc === null ? null : (historyNdc || undefined),
      priceResponse: price,
      fetchImpl: (input, init) => fetch(input, {
        ...init,
        cache: 'no-store',
        signal: controller.signal,
      }),
    })

    return {
      price,
      alternatives: downstream.alternatives,
      history: downstream.history,
      history_source: historySource ?? undefined,
      generic_vs_brand_ratio: downstream.genericVsBrandRatio,
      strengths: downstream.strengths,
      ingredient: downstream.ingredient,
    }
  } finally {
    clearTimeout(timeout)
  }
}
