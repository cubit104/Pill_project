import {
  fetchPriceCardDownstream,
  resolveDownstreamNdc,
  type PriceCardInitialData,
  type PriceResponse,
} from '../pricing/priceCardData'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const PRICE_DATA_FETCH_TIMEOUT_MS = 2500
const NDC_DIGIT_LENGTH = 11

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

async function fetchHistoryJson(
  url: string,
  signal: AbortSignal,
): Promise<{ history?: PriceCardInitialData['history'] } | null> {
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal,
    })
    if (!response.ok) return null
    return await response.json() as { history?: PriceCardInitialData['history'] }
  } catch {
    return null
  }
}

function normalizeNdcDigits(value?: string): string | null {
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  return digits.length === NDC_DIGIT_LENGTH ? digits : null
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
      historyNdc: normalizeNdcDigits(price.ndc) || downstreamNdc,
      fetchImpl: (input, init) => fetch(input, {
        ...init,
        cache: 'no-store',
        signal: controller.signal,
      }),
    })

    let history: NonNullable<PriceCardInitialData['history']> = downstream.history
    let historySource: 'ndc' | 'matched_ndc' | 'rxcui' | 'name' = 'ndc'
    const primaryHistoryNdc = normalizeNdcDigits(price.ndc) || downstreamNdc

    if (!history.length) {
      const matchedNdc = normalizeNdcDigits(price.matched_ndc)
      if (
        price.match_type === 'equivalent' &&
        matchedNdc &&
        matchedNdc !== primaryHistoryNdc
      ) {
        const matchedHistory = await fetchHistoryJson(
          `${API_BASE}/api/prices/${encodeURIComponent(matchedNdc)}/history?weeks=52`,
          controller.signal,
        )
        const matchedRows = matchedHistory?.history || []
        if (matchedRows.length > 0) {
          history = matchedRows as NonNullable<PriceCardInitialData['history']>
          historySource = 'matched_ndc'
        }
      }
    }

    if (!history.length && rxcui) {
      const rxcuiHistory = await fetchHistoryJson(
        `${API_BASE}/api/prices/by-rxcui/${encodeURIComponent(rxcui)}/history?weeks=52`,
        controller.signal,
      )
      const rxcuiRows = rxcuiHistory?.history || []
      if (rxcuiRows.length > 0) {
        history = rxcuiRows as NonNullable<PriceCardInitialData['history']>
        historySource = 'rxcui'
      }
    }

    if (!history.length && medicineName && medicineName !== 'Unknown') {
      const nameHistory = await fetchHistoryJson(
        `${API_BASE}/api/prices/by-name/${encodeURIComponent(medicineName)}/history?weeks=52`,
        controller.signal,
      )
      const nameRows = nameHistory?.history || []
      if (nameRows.length > 0) {
        history = nameRows as NonNullable<PriceCardInitialData['history']>
        historySource = 'name'
      }
    }

    return {
      price,
      alternatives: downstream.alternatives,
      history,
      history_source: historySource,
      generic_vs_brand_ratio: downstream.genericVsBrandRatio,
      strengths: downstream.strengths,
      ingredient: downstream.ingredient,
    }
  } finally {
    clearTimeout(timeout)
  }
}
