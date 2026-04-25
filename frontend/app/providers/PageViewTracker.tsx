'use client'

import { Suspense, useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import posthog from 'posthog-js'

function InnerPageViewTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (posthog.__loaded) {
      posthog.capture('$pageview', { $current_url: window.location.href })
    }
  }, [pathname, searchParams])

  return null
}

export default function PageViewTracker() {
  return (
    <Suspense fallback={null}>
      <InnerPageViewTracker />
    </Suspense>
  )
}
