import { Suspense } from 'react'
import Header from '../components/Header'
import Footer from '../components/Footer'
import GoogleAnalytics from '../components/GoogleAnalytics'
import GoogleAnalyticsRouteTracker from '../components/GoogleAnalyticsRouteTracker'
import DeferredPublicTrackers from '../components/DeferredPublicTrackers'

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <GoogleAnalytics />
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
      <DeferredPublicTrackers />
      <Suspense fallback={null}>
        <GoogleAnalyticsRouteTracker />
      </Suspense>
    </>
  )
}
