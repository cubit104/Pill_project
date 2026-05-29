'use client'

import posthog from 'posthog-js'
import { PostHogProvider as PHProvider } from 'posthog-js/react'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

const POSTHOG_IDLE_TIMEOUT_MS = 2000
const POSTHOG_FALLBACK_TIMEOUT_MS = 1500

function PostHogPageView() {
  const pathname = usePathname()

  useEffect(() => {
    if (pathname && posthog.__loaded) {
      posthog.capture('$pageview', { $current_url: window.location.href })
    }
  }, [pathname])

  return null
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST
    if (!key) return
    if (posthog.__loaded) return

    const initPostHog = () => {
      if (posthog.__loaded) return
      posthog.init(key, {
        api_host: host || 'https://us.i.posthog.com',
        person_profiles: 'identified_only',
        capture_pageview: false, // handled manually via PostHogPageView
        capture_pageleave: true,
        autocapture: false,
        disable_session_recording: true,
        disable_surveys: true,
      })
    }

    const globalWindow = window as Window & typeof globalThis
    if (typeof globalWindow.requestIdleCallback === 'function') {
      const idleCallbackId = globalWindow.requestIdleCallback(initPostHog, { timeout: POSTHOG_IDLE_TIMEOUT_MS })
      return () => globalWindow.cancelIdleCallback?.(idleCallbackId)
    }

    const timeoutId = globalWindow.setTimeout(initPostHog, POSTHOG_FALLBACK_TIMEOUT_MS)
    return () => globalWindow.clearTimeout(timeoutId)
  }, [])
  return (
    <PHProvider client={posthog}>
      <PostHogPageView />
      {children}
    </PHProvider>
  )
}
