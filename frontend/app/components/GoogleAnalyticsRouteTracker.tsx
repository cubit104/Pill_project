'use client'
import { useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

declare global {
  interface Window {
    gtag?: (...args: any[]) => void
  }
}

export default function GoogleAnalyticsRouteTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    const gaId = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID
    if (!gaId || typeof window.gtag !== 'function') return
    const url = pathname + (searchParams?.toString() ? `?${searchParams.toString()}` : '')
    window.gtag('event', 'page_view', {
      page_path: url,
      page_location: window.location.href,
    })
  }, [pathname, searchParams])

  return null
}
