'use client'

import { useEffect, useRef } from 'react'

/**
 * Fire-and-forget POST to /api/pill-views once per page mount.
 * Runs client-side only so the backend sees the real visitor IP.
 *
 * Uses a relative URL so the request is proxied through the Next.js rewrite
 * (`/api/:path* → ${API_BASE_URL}/api/:path*`) and never goes cross-origin
 * from the browser — no CORS issues regardless of deployment origin.
 */
export function usePillView(slug: string | undefined) {
  const sent = useRef(false)

  useEffect(() => {
    if (!slug || sent.current) return
    sent.current = true

    fetch('/api/pill-views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
    }).catch(() => {
      // best-effort — swallow network errors silently
    })
  }, [slug])
}
