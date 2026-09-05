import { describe, expect, it, vi } from 'vitest'
import { ApiError, mapFetchError, mapHttpError, tokenizeImprint } from '../lib/api'

describe('mapHttpError', () => {
  it('maps 404 on the photo endpoint to feature_off (not retryable)', () => {
    const e = mapHttpError(404, 'Photo identification is not enabled', 'photo')
    expect(e).toBeInstanceOf(ApiError)
    expect(e.kind).toBe('feature_off')
    expect(e.retryable).toBe(false)
    expect(e.status).toBe(404)
  })

  it('maps 404 elsewhere to not_found', () => {
    expect(mapHttpError(404, null).kind).toBe('not_found')
  })

  it('maps 413 / 422 / 429 / 503', () => {
    expect(mapHttpError(413, 'Photo too large (max 20MB)', 'photo').kind).toBe('too_large')
    expect(mapHttpError(422, 'Could not read that image', 'photo').kind).toBe('bad_image')
    expect(mapHttpError(422, 'Provide at least one imprint token', 'generic').kind).toBe('bad_request')
    const rl = mapHttpError(429, null, 'photo')
    expect(rl.kind).toBe('rate_limited')
    expect(rl.retryable).toBe(true)
    const wu = mapHttpError(503, 'Visual identification is warming up; please try again in a minute.', 'photo')
    expect(wu.kind).toBe('warming_up')
    expect(wu.message).toMatch(/warming up/i)
  })

  it('treats any 5xx as a retryable server error', () => {
    const e = mapHttpError(502, null)
    expect(e.kind).toBe('server')
    expect(e.retryable).toBe(true)
  })

  it('surfaces the server detail for unknown 4xx', () => {
    const e = mapHttpError(418, 'teapot')
    expect(e.kind).toBe('unknown')
    expect(e.message).toBe('teapot')
  })
})

describe('mapFetchError', () => {
  it('maps a timeout', () => {
    const e = mapFetchError(new DOMException('aborted', 'AbortError'), true)
    expect(e.kind).toBe('timeout')
    expect(e.retryable).toBe(true)
  })

  it('maps a user abort to cancelled', () => {
    expect(mapFetchError(new DOMException('aborted', 'AbortError'), false).kind).toBe('cancelled')
  })

  it('passes ApiError through untouched', () => {
    const original = new ApiError('rate_limited', 'x')
    expect(mapFetchError(original, false)).toBe(original)
  })

  it('maps network failures to a server error while online', () => {
    const e = mapFetchError(new TypeError('Failed to fetch'), false)
    expect(e.kind).toBe('server')
    expect(e.retryable).toBe(true)
  })

  it('maps network failures to offline only when the device is offline', () => {
    vi.stubGlobal('navigator', { onLine: false })
    try {
      expect(mapFetchError(new TypeError('Failed to fetch'), false).kind).toBe('offline')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('tokenizeImprint', () => {
  it('splits on spaces, commas and semicolons', () => {
    expect(tokenizeImprint('S 10')).toEqual(['S', '10'])
    expect(tokenizeImprint(' S;10, 20 ')).toEqual(['S', '10', '20'])
    expect(tokenizeImprint('')).toEqual([])
  })
})
