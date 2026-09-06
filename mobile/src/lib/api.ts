/**
 * Typed client for the PillSeek API.
 *
 * Native builds call https://pillseek.com directly (Vercel proxies /api/* to
 * the FastAPI backend). In the browser dev server the Vite proxy forwards the
 * same paths, so the base URL is empty there.
 */
import { Capacitor } from '@capacitor/core'

export const SITE_URL = 'https://pillseek.com'

const PHOTO_TIMEOUT_MS = 60_000
const DEFAULT_TIMEOUT_MS = 15_000

// ---- Response types --------------------------------------------------------

export interface Features {
  photo_id_enabled: boolean
  photo_id_reader_mode: 'original' | 'fast' | 'accurate'
}

export interface FilterColor {
  name: string
  hex: string
}

export interface FilterShape {
  name: string
  icon: string
}

export interface FiltersResponse {
  colors: FilterColor[]
  shapes: FilterShape[]
}

export type SearchType = 'imprint' | 'drug' | 'ndc' | 'name'

/** One grouped row from GET /api/search (see routes/search.py, `records`). */
export interface SearchResult {
  drug_name: string
  imprint: string
  color: string | null
  shape: string | null
  ndc: string | null
  rxcui: string | null
  slug: string | null
  strength: string | null
  image_url: string | null
  images: string[]
  has_multiple_images: boolean
}

export interface SearchResponse {
  results: SearchResult[]
  total: number
  page: number
  per_page: number
  total_pages: number
  fallback_used: boolean
  fallback_term: string | null
}

export interface IdentifyCandidate {
  slug: string
  medicine_name: string
  splimprint: string
  color: string
  shape: string
  strength: string
  score: number
  matched_tokens: string[]
  match_quality: 'exact' | 'strong' | 'partial'
  image_urls: string[]
}

export interface IdentifyResponse {
  candidates: IdentifyCandidate[]
  query_tokens: string[]
  disclaimer: string
}

export interface PhotoMatch {
  slug: string
  similarity: number
  medicine_name: string
  splimprint: string
  strength: string
  image_urls: string[]
  source?: 'imprint' | 'visual'
  color?: string
  shape?: string
  attr_fit?: number
}

export interface PhotoIdentifyResponse {
  matches: PhotoMatch[]
  imprint_read: string
  attrs_guess: { shape?: string; color?: string }
  capture_id: string | null
  disclaimer: string
}

export interface FeedbackRequest {
  capture_id: string
  verdict: 'up' | 'down'
  chosen_slug: string | null
  corrected_imprint: string | null
}

// ---- Errors ----------------------------------------------------------------

export type ApiErrorKind =
  | 'offline'
  | 'timeout'
  | 'cancelled'
  | 'feature_off'
  | 'too_large'
  | 'bad_image'
  | 'bad_request'
  | 'rate_limited'
  | 'warming_up'
  | 'not_found'
  | 'server'
  | 'unknown'

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number | null
  /** Short headline suitable for an error card. */
  readonly title: string
  /** Whether a plain "Try again" makes sense. */
  readonly retryable: boolean

  constructor(kind: ApiErrorKind, message: string, options: { status?: number | null; title?: string; retryable?: boolean } = {}) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = options.status ?? null
    this.title = options.title ?? DEFAULT_TITLES[kind]
    this.retryable = options.retryable ?? DEFAULT_RETRYABLE[kind]
  }
}

const DEFAULT_TITLES: Record<ApiErrorKind, string> = {
  offline: "You're offline",
  timeout: 'That took too long',
  cancelled: 'Cancelled',
  feature_off: 'Photo identification is paused',
  too_large: 'Photo is too large',
  bad_image: "Couldn't read that photo",
  bad_request: 'Something was missing',
  rate_limited: 'Slow down a moment',
  warming_up: 'Warming up',
  not_found: 'Not found',
  server: 'Something went wrong',
  unknown: 'Something went wrong',
}

const DEFAULT_RETRYABLE: Record<ApiErrorKind, boolean> = {
  offline: true,
  timeout: true,
  cancelled: true,
  feature_off: false,
  too_large: false,
  bad_image: false,
  bad_request: false,
  rate_limited: true,
  warming_up: true,
  not_found: false,
  server: true,
  unknown: true,
}

/**
 * Map an HTTP status (and optional server `detail`) onto a friendly error.
 * Exported so it can be unit tested without a network.
 */
export function mapHttpError(status: number, detail: string | null, context: 'photo' | 'generic' = 'generic'): ApiError {
  switch (status) {
    case 404:
      if (context === 'photo') {
        return new ApiError(
          'feature_off',
          'Photo identification is switched off right now. You can still search by imprint, name or NDC.',
          { status },
        )
      }
      return new ApiError('not_found', detail || "We couldn't find that.", { status })
    case 413:
      return new ApiError('too_large', 'That photo is over 20 MB. Try taking it again with the in-app camera.', { status })
    case 422:
      if (context === 'photo') {
        return new ApiError(
          'bad_image',
          detail || "We couldn't make out a pill in that photo. Fill the circle with the pill in good light and try again.",
          { status },
        )
      }
      return new ApiError('bad_request', detail || 'Please add an imprint, or pick a colour or shape.', { status })
    case 429:
      return new ApiError(
        'rate_limited',
        'You have reached the limit of 30 photo identifications per hour. Please try again a little later.',
        { status },
      )
    case 503:
      return new ApiError(
        'warming_up',
        detail || 'The pill reader is warming up. Give it a minute and try again.',
        { status },
      )
    default:
      if (status >= 500) {
        return new ApiError('server', 'The PillSeek server had a problem. Please try again.', { status })
      }
      return new ApiError('unknown', detail || `Request failed (${status}).`, { status })
  }
}

/** Map a thrown fetch error (network, abort, timeout) onto an ApiError. */
export function mapFetchError(err: unknown, timedOut: boolean): ApiError {
  if (err instanceof ApiError) return err
  if (timedOut) {
    return new ApiError('timeout', 'The server did not answer in time. Check your connection and try again.')
  }
  if (err instanceof DOMException && err.name === 'AbortError') {
    return new ApiError('cancelled', 'Request cancelled.')
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return new ApiError('offline', 'No internet connection. Reconnect and try again.')
  }
  // Online but the request still failed (blocked, TLS, CORS, DNS): not an "offline" situation.
  const message = err instanceof Error ? err.message : String(err)
  return new ApiError('server', `Could not reach PillSeek (${message || 'network error'}). Please try again in a moment.`, { retryable: true })
}

// ---- Transport -------------------------------------------------------------

export function apiBase(): string {
  const override = import.meta.env.VITE_API_BASE as string | undefined
  if (override) return override.replace(/\/$/, '')
  if (Capacitor.isNativePlatform()) return SITE_URL
  return ''
}

interface RequestOptions {
  method?: 'GET' | 'POST'
  body?: BodyInit | null
  headers?: Record<string, string>
  timeoutMs?: number
  signal?: AbortSignal
  context?: 'photo' | 'generic'
}

async function readDetail(res: Response): Promise<string | null> {
  try {
    const json = (await res.json()) as unknown
    if (json && typeof json === 'object' && 'detail' in json) {
      const d = (json as { detail: unknown }).detail
      if (typeof d === 'string') return d
      if (Array.isArray(d)) {
        const first = d[0] as { msg?: string } | undefined
        return first?.msg ?? null
      }
    }
  } catch {
    /* body was not JSON */
  }
  return null
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError('offline', 'No internet connection. Reconnect and try again.')
  }
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const onOuterAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onOuterAbort)

  try {
    const res = await fetch(`${apiBase()}${path}`, {
      method: options.method ?? 'GET',
      body: options.body ?? null,
      // X-PillSeek-App lets the Cloudflare WAF skip bot challenges for the app (rule keyed on this header).
      headers: { Accept: 'application/json', 'X-PillSeek-App': Capacitor.getPlatform(), ...(options.headers ?? {}) },
      signal: controller.signal,
    })
    if (!res.ok) {
      throw mapHttpError(res.status, await readDetail(res), options.context ?? 'generic')
    }
    return (await res.json()) as T
  } catch (err) {
    throw mapFetchError(err, timedOut)
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onOuterAbort)
  }
}

// ---- Endpoints -------------------------------------------------------------

export function getFeatures(signal?: AbortSignal): Promise<Features> {
  return request<Features>('/api/features', { signal })
}

export function getFilters(signal?: AbortSignal): Promise<FiltersResponse> {
  // Note: /filters, not /api/filters.
  return request<FiltersResponse>('/filters', { signal })
}

export interface SearchParams {
  q: string
  type: SearchType
  color?: string
  shape?: string
  page?: number
  perPage?: number
}

export function search(params: SearchParams, signal?: AbortSignal): Promise<SearchResponse> {
  const qs = new URLSearchParams()
  if (params.q) qs.set('q', params.q)
  qs.set('type', params.type)
  if (params.color) qs.set('color', params.color)
  if (params.shape) qs.set('shape', params.shape)
  qs.set('page', String(params.page ?? 1))
  qs.set('per_page', String(params.perPage ?? 25))
  return request<SearchResponse>(`/api/search?${qs.toString()}`, { signal })
}

export interface IdentifyParams {
  imprintTokens: string[]
  color?: string | null
  shape?: string | null
  limit?: number
}

export function identify(params: IdentifyParams, signal?: AbortSignal): Promise<IdentifyResponse> {
  return request<IdentifyResponse>('/api/identify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imprint_tokens: params.imprintTokens,
      color: params.color ?? null,
      shape: params.shape ?? null,
      limit: params.limit ?? 10,
    }),
    signal,
  })
}

export function identifyPhoto(side1: Blob, side2: Blob, consent: boolean, signal?: AbortSignal): Promise<PhotoIdentifyResponse> {
  const form = new FormData()
  form.append('photo', side1, 'side1.jpg')
  form.append('photo2', side2, 'side2.jpg')
  if (consent) form.append('consent', '1')
  return request<PhotoIdentifyResponse>('/api/identify/photo', {
    method: 'POST',
    body: form,
    timeoutMs: PHOTO_TIMEOUT_MS,
    context: 'photo',
    signal,
  })
}

export function sendFeedback(payload: FeedbackRequest, signal?: AbortSignal): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/api/identify/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })
}

export function pillPageUrl(slug: string): string {
  return `${SITE_URL}/pill/${encodeURIComponent(slug)}`
}

/** Split a typed imprint ("S 10", "S;10") into API tokens. */
export function tokenizeImprint(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12)
}

// ---- Pill detail (in-app pill page) -----------------------------------------

export interface PillDetail {
  slug: string
  drug_name: string
  generic_name: string | null
  brand_names_all: string[]
  brand_or_generic: 'brand' | 'generic' | null
  strength: string | null
  imprint: string | null
  color: string | null
  shape: string | null
  size: string | null
  dosage_form: string | null
  route: string | null
  manufacturer: string | null
  ingredients: string | null
  inactive_ingredients: string | null
  dea_schedule: string | null
  pharma_class: string | null
  status_rx_otc: string | null
  ndc: string | null
  rxcui: string | null
  images: string[]
  indication: { plain_text?: string | null; source?: string | null } | null
  pronunciation: string | null
  audio_url: string | null
  has_dosage: boolean
  has_adverse_reactions: boolean
  has_medguide: boolean
}

export interface PriceSnapshot {
  price_per_unit: number | null
  unit: string | null
  total_acquisition_cost: number | null
  fair_retail_low: number | null
  fair_retail_high: number | null
  is_estimate: boolean
  display_disclaimer: string | null
  effective_date: string | null
}

export interface SimilarPill {
  slug: string
  drug_name: string
  strength: string | null
  imprint: string | null
  color: string | null
  shape: string | null
  image_url: string | null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** GET /api/pill/{slug} — normalised to the fields the app shows. */
export async function getPill(slug: string, signal?: AbortSignal): Promise<PillDetail> {
  const raw = await request<Record<string, unknown>>(`/api/pill/${encodeURIComponent(slug)}`, { signal })
  const images = Array.isArray(raw.images) ? (raw.images as unknown[]).filter((x): x is string => typeof x === 'string') : []
  const bog = raw.brand_or_generic
  return {
    slug: str(raw.slug) ?? slug,
    drug_name: str(raw.drug_name) ?? str(raw.medicine_name) ?? 'Unknown pill',
    generic_name: str(raw.generic_name),
    brand_names_all: Array.isArray(raw.brand_names_all) ? (raw.brand_names_all as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    brand_or_generic: bog === 'brand' || bog === 'generic' ? bog : null,
    strength: str(raw.strength),
    imprint: str(raw.imprint),
    color: str(raw.color),
    shape: str(raw.shape),
    size: str(raw.size),
    dosage_form: str(raw.dosage_form),
    route: str(raw.route),
    manufacturer: str(raw.manufacturer),
    ingredients: str(raw.ingredients),
    inactive_ingredients: str(raw.inactive_ingredients),
    dea_schedule: str(raw.dea_schedule),
    pharma_class: str(raw.pharma_class),
    status_rx_otc: str(raw.status_rx_otc),
    ndc: str(raw.ndc),
    rxcui: str(raw.rxcui),
    images,
    indication: raw.indication && typeof raw.indication === 'object' ? (raw.indication as PillDetail['indication']) : null,
    pronunciation: str(raw.pronunciation),
    audio_url: str(raw.audio_url),
    has_dosage: raw.has_dosage === true,
    has_adverse_reactions: raw.has_adverse_reactions === true,
    has_medguide: raw.has_medguide === true,
  }
}

/** GET /api/snapshot/{slug} — weekly NADAC-based price snapshot; null when none. */
export async function getPriceSnapshot(slug: string, signal?: AbortSignal): Promise<PriceSnapshot | null> {
  try {
    const raw = await request<Record<string, unknown>>(`/api/snapshot/${encodeURIComponent(slug)}`, { signal, timeoutMs: 12_000 })
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
    if (num(raw.price_per_unit) === null && num(raw.fair_retail_low) === null) return null
    return {
      price_per_unit: num(raw.price_per_unit),
      unit: str(raw.unit),
      total_acquisition_cost: num(raw.total_acquisition_cost),
      fair_retail_low: num(raw.fair_retail_low),
      fair_retail_high: num(raw.fair_retail_high),
      is_estimate: raw.is_estimate === true,
      display_disclaimer: str(raw.display_disclaimer),
      effective_date: str(raw.effective_date),
    }
  } catch (err) {
    if (err instanceof ApiError && err.kind === 'cancelled') throw err
    return null // prices are a nice-to-have on the pill page
  }
}

/** GET /api/pill/{slug}/similar */
export async function getSimilar(slug: string, signal?: AbortSignal): Promise<SimilarPill[]> {
  try {
    const raw = await request<{ similar?: unknown }>(`/api/pill/${encodeURIComponent(slug)}/similar`, { signal, timeoutMs: 12_000 })
    if (!Array.isArray(raw.similar)) return []
    return (raw.similar as Record<string, unknown>[])
      .filter((s) => typeof s.slug === 'string' && typeof s.drug_name === 'string')
      .slice(0, 8)
      .map((s) => ({
        slug: s.slug as string,
        drug_name: s.drug_name as string,
        strength: str(s.strength),
        imprint: str(s.imprint),
        color: str(s.color),
        shape: str(s.shape),
        image_url: str(s.image_url),
      }))
  } catch (err) {
    if (err instanceof ApiError && err.kind === 'cancelled') throw err
    return []
  }
}

/** Website URLs for the deep guide sections (opened in the in-app browser). */
export function pillSectionUrl(slug: string, section: 'dosage' | 'adverse-reactions' | 'interactions' | 'price'): string {
  return `${pillPageUrl(slug)}/${section}`
}
