'use client'

import posthog from 'posthog-js'
import { PostHogProvider as PHProvider } from 'posthog-js/react'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

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
    posthog.init(key, {
      api_host: host || 'https://us.i.posthog.com',
      person_profiles: 'identified_only',
      capture_pageview: false, // handled manually via PostHogPageView
      capture_pageleave: true,
      autocapture: true,
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: '[data-private]',
      },
      disable_session_recording: false,
    })
  }, [])
  return (
    <PHProvider client={posthog}>
      <PostHogPageView />
      {children}
    </PHProvider>
  )
}
