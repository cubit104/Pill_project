import { useEffect, useRef } from 'react'
import { HashRouter, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { App as CapApp } from '@capacitor/app'
import OfflineBanner from './components/OfflineBanner'
import TabBar from './components/TabBar'
import { ToastProvider } from './components/Toast'
import { BackStackProvider, useBackStack } from './lib/backstack'
import { applyStatusBar, hideSplash, isNative } from './lib/native'
import { SettingsProvider } from './lib/settings'
import { parsePillPath } from './lib/goals'
import { saveLastTab } from './lib/storage'
import AboutScreen from './screens/AboutScreen'
import HomeScreen from './screens/HomeScreen'
import IdentifyScreen from './screens/IdentifyScreen'
import PillScreen from './screens/PillScreen'
import RecentScreen from './screens/RecentScreen'
import SearchScreen from './screens/SearchScreen'
import SectionScreen from './screens/SectionScreen'

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
      if (canGoBack && window.history.length > 1 && location.pathname !== '/home') {
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
        else if (parsePillPath(u.pathname)) navigate(u.pathname)
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

const TABS = ['/home', '/identify', '/search', '/recent', '/about'] as const
type Tab = (typeof TABS)[number]

function isTab(p: string): p is Tab {
  return (TABS as readonly string[]).includes(p)
}

/**
 * All tab panes stay mounted and are shown/hidden, so switching tabs never
 * cancels an identification in flight or throws away photos, results or a
 * search. Inactive tabs are `inert` so they take no focus or taps.
 */
function Shell() {
  const { pathname } = useLocation()
  // Remember which tab is underneath while a pill page is pushed on top.
  const lastTab = useRef<Tab>('/home')
  if (isTab(pathname)) lastTab.current = pathname
  const pillRoute = parsePillPath(pathname)
  const pillSlug = pillRoute?.slug ?? null
  if (!isTab(pathname) && !pillRoute) return <Navigate to="/home" replace />
  const active: Tab = isTab(pathname) ? pathname : lastTab.current
  const panes: Array<[Tab, React.ReactNode]> = [
    // A tab counts as active only while it is actually on screen (not under a pill page),
    // so its URL syncing and reloads pause while the pill page owns the URL.
    ['/home', <HomeScreen key="home" active={active === '/home' && pillSlug === null} />],
    ['/identify', <IdentifyScreen key="identify" active={active === '/identify' && pillSlug === null} />],
    ['/search', <SearchScreen key="search" active={active === '/search' && pillSlug === null} />],
    ['/recent', <RecentScreen key="recent" active={active === '/recent' && pillSlug === null} />],
    ['/about', <AboutScreen key="about" active={active === '/about' && pillSlug === null} />],
  ]
  return (
    <div className="app-shell flex h-full flex-col bg-canvas">
      <OfflineBanner />
      <div className="relative min-h-0 flex-1">
        {panes.map(([tab, node]) => (
          <div key={tab} className="h-full" hidden={tab !== active || pillSlug !== null} inert={tab !== active || pillSlug !== null ? true : undefined}>
            {node}
          </div>
        ))}
        {pillRoute && (
          <div className="absolute inset-0 z-30">
            {pillRoute.section ? (
              <SectionScreen key={`section:${pillRoute.slug}`} slug={pillRoute.slug} section={pillRoute.section} />
            ) : (
              <PillScreen key={pillRoute.slug} slug={pillRoute.slug} />
            )}
          </div>
        )}
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
