import Header from '../components/Header'
import Footer from '../components/Footer'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { PostHogProvider } from '../lib/posthog'

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <PostHogProvider>
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
      <Analytics />
      <SpeedInsights />
    </PostHogProvider>
  )
}
