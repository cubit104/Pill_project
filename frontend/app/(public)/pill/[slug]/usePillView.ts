'use client'

import { useEffect, useRef } from 'react'

/**
 * Fire-and-forget POST to /api/pill-views once per page mount.
 * Runs client-side only so the backend sees the real visitor IP.
 */
export function usePillView(slug: string | undefined) {
  const sent = useRef(false)

  useEffect(() => {
    if (!slug || sent.current) return
    sent.current = true

    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '')
    if (!apiBase) return

    fetch(`${apiBase}/api/pill-views`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
    }).catch(() => {
      // best-effort — swallow network errors silently
    })
  }, [slug])
}
