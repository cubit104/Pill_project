'use client'

import { useEffect, useState } from 'react'

type TrackerComponent = React.ComponentType

export default function DeferredPublicTrackers() {
  const [trackers, setTrackers] = useState<{
    Analytics: TrackerComponent | null
    SpeedInsights: TrackerComponent | null
    PostHogTracker: TrackerComponent | null
  }>({
    Analytics: null,
    SpeedInsights: null,
    PostHogTracker: null,
  })

  useEffect(() => {
    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let idleId: number | null = null

    const loadTrackers = async () => {
      const [analyticsMod, speedInsightsMod, posthogMod] = await Promise.all([
        import('@vercel/analytics/react'),
        import('@vercel/speed-insights/next'),
        import('../lib/posthog'),
      ])
      if (cancelled) return
      setTrackers({
        Analytics: analyticsMod.Analytics,
        SpeedInsights: speedInsightsMod.SpeedInsights,
        PostHogTracker: posthogMod.PostHogTracker,
      })
    }

    if ('requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(() => void loadTrackers(), { timeout: 4000 })
    } else {
      timeoutId = setTimeout(() => void loadTrackers(), 0)
    }

    return () => {
      cancelled = true
      if (timeoutId) clearTimeout(timeoutId)
      if (idleId !== null && 'cancelIdleCallback' in window) window.cancelIdleCallback(idleId)
    }
  }, [])

  return (
    <>
      {trackers.Analytics ? <trackers.Analytics /> : null}
      {trackers.SpeedInsights ? <trackers.SpeedInsights /> : null}
      {trackers.PostHogTracker ? <trackers.PostHogTracker /> : null}
    </>
  )
}
