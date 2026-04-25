'use client'

import { useEffect, useState } from 'react'
import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'

export default function PHProvider({ children }: { children: React.ReactNode }) {
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
    if (!key) return

    posthog.init(key, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
      capture_pageview: false,
      capture_pageleave: true,
      person_profiles: 'identified_only',
      autocapture: false,
      disable_session_recording: true,
    })
    setInitialized(true)
  }, [])

  if (!initialized) return <>{children}</>

  return <PostHogProvider client={posthog}>{children}</PostHogProvider>
}
