import { useEffect } from 'react'
import { HashRouter, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { App as CapApp } from '@capacitor/app'
import OfflineBanner from './components/OfflineBanner'
import TabBar from './components/TabBar'
import { ToastProvider } from './components/Toast'
import { BackStackProvider, useBackStack } from './lib/backstack'
import { applyStatusBar, hideSplash, isNative } from './lib/native'
import { SettingsProvider } from './lib/settings'
import { saveLastTab } from './lib/storage'
import AboutScreen from './screens/AboutScreen'
import IdentifyScreen from './screens/IdentifyScreen'
import RecentScreen from './screens/RecentScreen'
import SearchScreen from './screens/SearchScreen'

/** Native wiring that needs the router: back button, deep links, status bar, splash. */
function NativeBridges() {
  const navigate = useNavigate()
  const location = useLocation()
  const { pop } = useBackStack()

  useEffect(() => {
    void hideSplash()
    void applyStatusBar('auto')
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onTheme = () => void applyStatusBar('auto')
    mq.addEventListener('change', onTheme)
    return () => mq.removeEventListener('change', onTheme)
  }, [])

  useEffect(() => {
    const root = location.pathname.split('/')[1]
    if (root) void saveLastTab(`/${root}`)
  }, [location.pathname])

  useEffect(() => {
    if (!isNative()) return
    const backSub = CapApp.addListener('backButton', ({ canGoBack }) => {
      if (pop()) return
      if (canGoBack && window.history.length > 1 && location.pathname !== '/identify') {
        navigate(-1)
        return
      }
      void CapApp.exitApp()
    })
    // pillseek.com/search?q=... and /identify links open the matching tab.
    const urlSub = CapApp.addListener('appUrlOpen', ({ url }) => {
      try {
        const u = new URL(url)
        if (u.pathname.startsWith('/search')) navigate(`/search${u.search}`)
        else if (u.pathname.startsWith('/identify')) navigate('/identify')
      } catch {
        /* ignore malformed URLs */
      }
    })
    return () => {
      void backSub.then((s) => s.remove())
      void urlSub.then((s) => s.remove())
    }
  }, [navigate, pop, location.pathname])

  return null
}

const TABS = ['/identify', '/search', '/recent', '/about'] as const
type Tab = (typeof TABS)[number]

function isTab(p: string): p is Tab {
  return (TABS as readonly string[]).includes(p)
}

/**
 * All four tabs stay mounted and are shown/hidden, so switching tabs never
 * cancels an identification in flight or throws away photos, results or a
 * search. Inactive tabs are `inert` so they take no focus or taps.
 */
function Shell() {
  const { pathname } = useLocation()
  if (!isTab(pathname)) return <Navigate to="/identify" replace />
  const active: Tab = pathname
  const panes: Array<[Tab, React.ReactNode]> = [
    ['/identify', <IdentifyScreen key="identify" active={active === '/identify'} />],
    ['/search', <SearchScreen key="search" active={active === '/search'} />],
    ['/recent', <RecentScreen key="recent" active={active === '/recent'} />],
    ['/about', <AboutScreen key="about" />],
  ]
  return (
    <div className="app-shell flex h-full flex-col bg-canvas">
      <OfflineBanner />
      <div className="min-h-0 flex-1">
        {panes.map(([tab, node]) => (
          <div key={tab} className="h-full" hidden={tab !== active} inert={tab !== active ? true : undefined}>
            {node}
          </div>
        ))}
      </div>
      <TabBar />
      <NativeBridges />
    </div>
  )
}

export default function App() {
  return (
    <HashRouter>
      <BackStackProvider>
        <SettingsProvider>
          <ToastProvider>
            <Shell />
          </ToastProvider>
        </SettingsProvider>
      </BackStackProvider>
    </HashRouter>
  )
}
