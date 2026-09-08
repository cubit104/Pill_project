import { Suspense } from 'react'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { PostHogProvider } from '../lib/posthog'
import GoogleAnalytics from '../components/GoogleAnalytics'
import GoogleAnalyticsRouteTracker from '../components/GoogleAnalyticsRouteTracker'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'

/** Photo ID is switched on/off from Admin → Settings; read it here so the header link renders server-side. */
async function photoIdEnabled(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/features`, { next: { revalidate: 60 } })
    if (!res.ok) return false
    const flags = (await res.json()) as { photo_id_enabled?: boolean }
    return Boolean(flags.photo_id_enabled)
  } catch {
    return false
  }
}

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const photoId = await photoIdEnabled()
  return (
    <PostHogProvider>
      <GoogleAnalytics />
      <Header photoIdEnabled={photoId} />
      <main className="flex-1">{children}</main>
      <Footer />
      <Analytics />
      <SpeedInsights />
      <Suspense fallback={null}>
        <GoogleAnalyticsRouteTracker />
      </Suspense>
    </PostHogProvider>
  )
}
