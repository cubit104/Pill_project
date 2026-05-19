import {
  fetchPriceCardDownstream,
  resolveDownstreamNdc,
  type PriceCardInitialData,
  type PriceResponse,
} from '../pricing/priceCardData'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'

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

export async function fetchInitialPriceData({
  ndc,
  rxcui,
  medicineName,
}: {
  ndc?: string
  rxcui?: string
  medicineName?: string
}): Promise<PriceCardInitialData | undefined> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
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
      generic_vs_brand_ratio: downstream.genericVsBrandRatio,
    }
  } finally {
    clearTimeout(timeout)
  }
}
