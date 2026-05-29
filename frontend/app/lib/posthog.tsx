'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

type PostHogClient = typeof import('posthog-js')['default']

function buildPageUrl(pathname: string, searchParams: ReturnType<typeof useSearchParams>) {
  const query = searchParams?.toString()
  return query ? `${pathname}?${query}` : pathname
}

export function PostHogTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const clientRef = useRef<PostHogClient | null>(null)

  useEffect(() => {
    if (!pathname) return

    const pagePath = buildPageUrl(pathname, searchParams)
    const client = clientRef.current
    if (!client || !client.__loaded) return

    client.capture('$pageview', {
      $current_url: window.location.href,
      $pathname: pagePath,
    })
  }, [pathname, searchParams])

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST
    if (!key) return

    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let idleId: number | null = null

    const loadPostHog = async () => {
      const posthog = (await import('posthog-js')).default
      if (cancelled) return

      if (!posthog.__loaded) {
        posthog.init(key, {
          api_host: host || 'https://us.i.posthog.com',
          person_profiles: 'identified_only',
          capture_pageview: false,
          capture_pageleave: true,
          autocapture: false,
          disable_session_recording: true,
        })
      }

      clientRef.current = posthog

      if (pathname) {
        posthog.capture('$pageview', {
          $current_url: window.location.href,
          $pathname: buildPageUrl(pathname, searchParams),
        })
      }
    }

    if ('requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(() => void loadPostHog(), { timeout: 1500 })
    } else {
      timeoutId = setTimeout(() => void loadPostHog(), 0)
    }

    return () => {
      cancelled = true
      if (timeoutId) clearTimeout(timeoutId)
      if (idleId && 'cancelIdleCallback' in window) window.cancelIdleCallback(idleId)
    }
  }, [pathname, searchParams])

  return null
}
