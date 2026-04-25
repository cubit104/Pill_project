'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BarChart2,
  TrendingUp,
  Search,
  Zap,
  ShieldCheck,
  Users,
  Eye,
  MousePointerClick,
  AlertTriangle,
  Globe,
  Smartphone,
  Monitor,
  RefreshCw,
  Play,
  Activity,
  ExternalLink,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createClient } from '../lib/supabase'

import StatCard from './components/StatCard'
import TrafficChart from './components/TrafficChart'
import TopPagesTable from './components/TopPagesTable'
import TopQueriesTable from './components/TopQueriesTable'
import DonutChart from './components/DonutChart'
import SimpleBarChart from './components/SimpleBarChart'
import PositionDistribution from './components/PositionDistribution'
import CtrScatterPlot from './components/CtrScatterPlot'
import CoreWebVitalsCard from './components/CoreWebVitalsCard'
import PageHealthList from './components/PageHealthList'
import DateRangePicker from './components/DateRangePicker'
import NotConfiguredCard from './components/NotConfiguredCard'
import ErrorCard from './components/ErrorCard'
import { SkeletonCard, SkeletonTable, SkeletonChart } from './components/SkeletonCard'
import {
  useGA4Overview,
  useSearchConsoleOverview,
  usePageHealth,
  usePageSpeed,
  type RangeOption,
} from './hooks/useAnalytics'

// ─────────────────────────────────────────────────────────────────────────────
// Tab definitions
// ─────────────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'overview', label: 'Overview', icon: BarChart2 },
  { id: 'traffic', label: 'Traffic', icon: TrendingUp },
  { id: 'seo', label: 'SEO', icon: Search },
  { id: 'performance', label: 'Performance', icon: Zap },
  { id: 'page-health', label: 'Page Health', icon: ShieldCheck },
  { id: 'vercel', label: 'Vercel', icon: Activity },
] as const

type TabId = (typeof TABS)[number]['id']

// ─────────────────────────────────────────────────────────────────────────────
// Overview Tab
// ─────────────────────────────────────────────────────────────────────────────

function OverviewTab({ range, onRangeChange }: { range: RangeOption; onRangeChange: (r: RangeOption) => void }) {
  const { data, loading, error, refetch } = useGA4Overview(range)
  const { data: scData, loading: scLoading } = useSearchConsoleOverview(range)
  const { data: healthData } = usePageHealth()

  if (error) return <ErrorCard message={error} onRetry={refetch} />

  const ga4 = data as any
  const sc = scData as any

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-sm font-semibold text-gray-700">Overview Dashboard</h2>
        <DateRangePicker value={range} onChange={onRangeChange} />
      </div>

      {/* KPI stat cards */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : ga4?.configured === false ? (
        <NotConfiguredCard service="GA4" message={ga4.message} />
      ) : sc?.configured === false ? (
        <div className="space-y-4">
          <NotConfiguredCard service="Search Console" message={sc.message} />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <StatCard label={`Total Users (${range})`} value={ga4?.summary?.users ?? null} icon={<Users className="w-4 h-4" />} delay={0} />
            <StatCard label={`Pageviews (${range})`} value={ga4?.summary?.pageviews ?? null} icon={<Eye className="w-4 h-4" />} delay={0.05} />
            <StatCard
              label="Critical SEO Issues"
              value={healthData?.critical_count ?? null}
              icon={<AlertTriangle className="w-4 h-4" />}
              colorClass="from-white to-red-50"
              delay={0.1}
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <StatCard label={`Total Users (${range})`} value={ga4?.summary?.users ?? null} icon={<Users className="w-4 h-4" />} delay={0} />
          <StatCard label={`Pageviews (${range})`} value={ga4?.summary?.pageviews ?? null} icon={<Eye className="w-4 h-4" />} delay={0.05} />
          <StatCard
            label="Avg. Google Position"
            value={sc?.summary?.position ?? null}
            format="position"
            icon={<Search className="w-4 h-4" />}
            delay={0.1}
          />
          <StatCard
            label={`Clicks from Google (${range})`}
            value={sc?.summary?.clicks ?? null}
            icon={<MousePointerClick className="w-4 h-4" />}
            delay={0.15}
          />
          <StatCard
            label="Critical SEO Issues"
            value={healthData?.critical_count ?? null}
            icon={<AlertTriangle className="w-4 h-4" />}
            colorClass="from-white to-red-50"
            delay={0.2}
          />
        </div>
      )}

      {/* Traffic chart */}
      {loading ? (
        <SkeletonChart height={280} />
      ) : ga4?.timeseries?.length > 0 ? (
        <TrafficChart data={ga4.timeseries} />
      ) : null}

      {/* Tables row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {loading ? (
          <>
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5"><SkeletonTable /></div>
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5"><SkeletonTable /></div>
          </>
        ) : (
          <>
            <TopPagesTable data={ga4?.top_pages ?? []} title="Top 10 Pages (GA4)" mode="ga4" />
            <TopQueriesTable data={sc?.top_queries?.slice(0, 10) ?? []} title="Top 10 Search Queries" />
          </>
        )}
      </div>

      {/* Donut row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {loading ? (
          <>
            <SkeletonChart height={240} />
            <SkeletonChart height={240} />
          </>
        ) : (
          <>
            <DonutChart
              title="Traffic Sources"
              data={(ga4?.traffic_sources ?? []).map((s: any) => ({ name: s.source, value: s.sessions }))}
              valueLabel="Sessions"
            />
            <DonutChart
              title="Device Breakdown"
              data={(ga4?.devices ?? []).map((d: any) => ({ name: d.device, value: d.sessions }))}
              valueLabel="Sessions"
            />
          </>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Traffic Tab
// ─────────────────────────────────────────────────────────────────────────────

function TrafficTab({ range, onRangeChange }: { range: RangeOption; onRangeChange: (r: RangeOption) => void }) {
  const { data, loading, error, refetch } = useGA4Overview(range)

  if (error) return <ErrorCard message={error} onRetry={refetch} />
  const ga4 = data as any

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-sm font-semibold text-gray-700">Traffic Analytics (GA4)</h2>
        <DateRangePicker value={range} onChange={onRangeChange} />
      </div>

      {loading ? <SkeletonChart height={260} /> : ga4?.configured === false ? (
        <NotConfiguredCard service="GA4" message={ga4.message} />
      ) : (
        <>
          {/* Stat summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="Users" value={ga4?.summary?.users} icon={<Users className="w-4 h-4" />} delay={0} />
            <StatCard label="Sessions" value={ga4?.summary?.sessions} delay={0.05} />
            <StatCard label="Pageviews" value={ga4?.summary?.pageviews} icon={<Eye className="w-4 h-4" />} delay={0.1} />
            <StatCard label="Bounce Rate" value={ga4?.summary?.bounce_rate} format="percent" delay={0.15} />
          </div>

          {/* Traffic over time */}
          {ga4?.timeseries?.length > 0 && <TrafficChart data={ga4.timeseries} />}

          {/* Country + Device row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SimpleBarChart
              title="Top Countries"
              data={(ga4?.countries ?? []).map((c: any) => ({ label: c.country, value: c.users }))}
              color="#6366f1"
              valueLabel="Users"
            />
            <DonutChart
              title="Device Breakdown"
              data={(ga4?.devices ?? []).map((d: any) => ({ name: d.device, value: d.sessions }))}
              valueLabel="Sessions"
            />
          </div>

          {/* Tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <TopPagesTable data={ga4?.top_pages ?? []} title="Top Landing Pages" mode="ga4" />
            <SimpleBarChart
              title="Traffic Sources"
              data={(ga4?.traffic_sources ?? []).map((s: any) => ({ label: s.source, value: s.sessions }))}
              color="#10b981"
              valueLabel="Sessions"
            />
          </div>
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SEO Tab
// ─────────────────────────────────────────────────────────────────────────────

function SeoTab({ range, onRangeChange }: { range: RangeOption; onRangeChange: (r: RangeOption) => void }) {
  const { data, loading, error, refetch } = useSearchConsoleOverview(range)

  if (error) return <ErrorCard message={error} onRetry={refetch} />
  const sc = data as any

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-sm font-semibold text-gray-700">SEO — Google Search Console</h2>
        <DateRangePicker value={range} onChange={onRangeChange} />
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : sc?.configured === false ? (
        <NotConfiguredCard service="Search Console" message={sc.message} />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="Total Clicks" value={sc?.summary?.clicks} icon={<MousePointerClick className="w-4 h-4" />} delay={0} />
            <StatCard label="Impressions" value={sc?.summary?.impressions} icon={<Eye className="w-4 h-4" />} delay={0.05} />
            <StatCard label="Avg. CTR" value={sc?.summary?.ctr} format="percent" delay={0.1} />
            <StatCard label="Avg. Position" value={sc?.summary?.position} format="position" icon={<Search className="w-4 h-4" />} delay={0.15} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <TopQueriesTable data={sc?.top_queries ?? []} title="Top Queries" />
            <TopPagesTable data={sc?.top_pages ?? []} title="Top Pages (GSC)" mode="gsc" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <PositionDistribution data={sc?.position_distribution ?? []} />
            <CtrScatterPlot data={sc?.ctr_scatter ?? []} />
          </div>
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Performance Tab
// ─────────────────────────────────────────────────────────────────────────────

function PerformanceTab() {
  const defaultUrl =
    (typeof window !== 'undefined' && (process.env.NEXT_PUBLIC_SITE_URL || window.location.origin)) ||
    'https://pillseek.com'

  const [url, setUrl] = useState(defaultUrl)
  const [strategy, setStrategy] = useState<'mobile' | 'desktop'>('mobile')
  const [results, setResults] = useState<any[]>([])
  const { result, loading, error, run } = usePageSpeed()

  const handleRun = async () => {
    await run(url, strategy)
  }

  useEffect(() => {
    if (result) {
      setResults(prev => {
        const filtered = prev.filter(r => !(r.url === result.url && r.strategy === result.strategy))
        return [result, ...filtered].slice(0, 10)
      })
    }
  }, [result])

  return (
    <div className="space-y-6">
      <h2 className="text-sm font-semibold text-gray-700">Core Web Vitals — PageSpeed Insights</h2>

      {/* Run audit form */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-3">
        <h3 className="font-semibold text-gray-800 text-sm">Run Audit</h3>
        <div className="flex flex-wrap gap-3">
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://pillseek.com"
            className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
          />
          <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
            {(['mobile', 'desktop'] as const).map(s => (
              <button
                key={s}
                onClick={() => setStrategy(s)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  strategy === s ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {s === 'mobile' ? <Smartphone className="w-3 h-3" /> : <Monitor className="w-3 h-3" />}
                {s}
              </button>
            ))}
          </div>
          <button
            onClick={handleRun}
            disabled={loading || !url}
            className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {loading ? 'Running…' : 'Run Audit'}
          </button>
        </div>
      </div>

      {error && <ErrorCard message={error} />}

      {result?.configured === false && (
        <NotConfiguredCard service="PageSpeed Insights" message={result.message} />
      )}

      {result?.error && (
        <ErrorCard message={result.error} />
      )}

      {/* Results */}
      <div className="space-y-4">
        {results.filter(r => r.configured !== false && !r.error).map((r, i) => (
          <motion.div
            key={`${r.url}-${r.strategy}-${i}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <CoreWebVitalsCard
              url={r.url}
              strategy={r.strategy}
              scores={r.scores ?? {}}
              metrics={r.metrics ?? {}}
            />
          </motion.div>
        ))}
      </div>

      {results.length === 0 && !loading && (
        <div className="text-center py-12 text-gray-400">
          <Zap className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Enter a URL above and click Run Audit to see Core Web Vitals</p>
        </div>
      )}
      {/* TODO: PostHog integration could plug in here for RUM data */}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Page Health Tab
// ─────────────────────────────────────────────────────────────────────────────

function PageHealthTab() {
  const { data, loading, error, refetch } = usePageHealth()
  const health = data as any

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-700">Page Health Audit</h2>
          <p className="text-xs text-gray-400 mt-0.5">Scans your pill database for SEO & data quality issues</p>
        </div>
        <button
          onClick={refetch}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 px-3 py-1.5 rounded-lg transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          Re-scan
        </button>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <SkeletonTable rows={8} />
          </div>
        </div>
      ) : error ? (
        <ErrorCard message={error} onRetry={refetch} />
      ) : health ? (
        <PageHealthList
          issues={health.issues ?? []}
          totalPages={health.total_pages_checked ?? 0}
        />
      ) : null}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Vercel Tab
// ─────────────────────────────────────────────────────────────────────────────

function VercelTab() {
  const vercelUrl = process.env.NEXT_PUBLIC_VERCEL_PROJECT_URL
    ? `https://vercel.com/${process.env.NEXT_PUBLIC_VERCEL_PROJECT_URL}/analytics`
    : 'https://vercel.com/dashboard'

  const speedInsightsUrl = process.env.NEXT_PUBLIC_VERCEL_PROJECT_URL
    ? `https://vercel.com/${process.env.NEXT_PUBLIC_VERCEL_PROJECT_URL}/speed-insights`
    : 'https://vercel.com/dashboard'

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-gray-700">Vercel Web Analytics &amp; Speed Insights</h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Real-user traffic and performance data collected by the Vercel platform.
        </p>
      </div>

      {/* Status card */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
            <Activity className="w-5 h-5 text-emerald-700" />
          </div>
          <div>
            <h3 className="font-semibold text-emerald-800 text-sm">Integration active</h3>
            <p className="text-xs text-emerald-600 mt-0.5">
              <code className="font-mono">@vercel/analytics</code> and{' '}
              <code className="font-mono">@vercel/speed-insights</code> are injected into every public page.
            </p>
          </div>
        </div>

        <p className="text-xs text-emerald-700">
          Data is collected automatically on every page visit. No additional configuration is required.
          View detailed reports in the Vercel dashboard using the links below.
        </p>
      </div>

      {/* Quick-access links */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <a
          href={vercelUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between bg-white rounded-xl border border-gray-100 shadow-sm p-5 hover:border-emerald-300 hover:shadow-md transition-all group"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-black flex items-center justify-center">
              <Globe className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800">Web Analytics</p>
              <p className="text-xs text-gray-400">Page views, visitors, referrers</p>
            </div>
          </div>
          <ExternalLink className="w-4 h-4 text-gray-300 group-hover:text-emerald-500 transition-colors" />
        </a>

        <a
          href={speedInsightsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between bg-white rounded-xl border border-gray-100 shadow-sm p-5 hover:border-emerald-300 hover:shadow-md transition-all group"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-black flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800">Speed Insights</p>
              <p className="text-xs text-gray-400">Real-user Core Web Vitals</p>
            </div>
          </div>
          <ExternalLink className="w-4 h-4 text-gray-300 group-hover:text-emerald-500 transition-colors" />
        </a>
      </div>

      {/* What's being tracked */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
        <h3 className="text-sm font-semibold text-gray-800">What&apos;s being tracked</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-gray-600">
          <div>
            <p className="font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-emerald-600" /> Web Analytics
            </p>
            <ul className="space-y-1 list-disc list-inside">
              <li>Page views &amp; unique visitors</li>
              <li>Referrer / traffic source</li>
              <li>Country &amp; region</li>
              <li>Browser &amp; OS</li>
              <li>Top pages by traffic</li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-emerald-600" /> Speed Insights
            </p>
            <ul className="space-y-1 list-disc list-inside">
              <li>Largest Contentful Paint (LCP)</li>
              <li>First Input Delay (FID)</li>
              <li>Cumulative Layout Shift (CLS)</li>
              <li>First Contentful Paint (FCP)</li>
              <li>Interaction to Next Paint (INP)</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Privacy note */}
      <p className="text-xs text-gray-400 text-center">
        Vercel Analytics is privacy-friendly and does not use cookies or fingerprinting.
        Data is only visible to project members in the Vercel dashboard.
      </p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Analytics Page
// ─────────────────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [range, setRange] = useState<RangeOption>('28d')
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    const init = async () => {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push('/admin/login')
        return
      }
      setLoading(false)
    }
    init()
  }, [router])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400 text-sm">Loading…</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Analytics & SEO</h1>
        <p className="text-sm text-gray-500 mt-0.5">Traffic, search visibility, performance, and page health at a glance.</p>
      </div>

      {/* Tab navigation */}
      <div className="relative border-b border-gray-200">
        <nav className="flex gap-0 overflow-x-auto" aria-label="Analytics tabs">
          {TABS.map(tab => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                  isActive ? 'text-emerald-700' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                {isActive && (
                  <motion.div
                    layoutId="tab-underline"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-600 rounded-full"
                    transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                  />
                )}
              </button>
            )
          })}
        </nav>
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {activeTab === 'overview' && <OverviewTab range={range} onRangeChange={setRange} />}
          {activeTab === 'traffic' && <TrafficTab range={range} onRangeChange={setRange} />}
          {activeTab === 'seo' && <SeoTab range={range} onRangeChange={setRange} />}
          {activeTab === 'performance' && <PerformanceTab />}
          {activeTab === 'page-health' && <PageHealthTab />}
          {activeTab === 'vercel' && <VercelTab />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
