'use client'

import { useEffect, useState } from 'react'

type TrackerComponent = React.ComponentType

export default function DeferredPublicTrackers() {
  const [Analytics, setAnalytics] = useState<TrackerComponent | null>(null)
  const [SpeedInsights, setSpeedInsights] = useState<TrackerComponent | null>(null)
  const [PostHogTracker, setPostHogTracker] = useState<TrackerComponent | null>(null)

  useEffect(() => {
    let cancelled = false

    void import('@vercel/analytics/react').then((mod) => {
      if (!cancelled) setAnalytics(() => mod.Analytics)
    })
    void import('@vercel/speed-insights/next').then((mod) => {
      if (!cancelled) setSpeedInsights(() => mod.SpeedInsights)
    })
    void import('../lib/posthog').then((mod) => {
      if (!cancelled) setPostHogTracker(() => mod.PostHogTracker)
    })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      {Analytics ? <Analytics /> : null}
      {SpeedInsights ? <SpeedInsights /> : null}
      {PostHogTracker ? <PostHogTracker /> : null}
    </>
  )
}
