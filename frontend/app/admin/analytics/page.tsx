'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
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
  FlaskConical,
  Video,
  Timer,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createClient } from '../lib/supabase'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

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
import VisitorLocationsTable from './components/VisitorLocationsTable'
import PostHogVisitorLocationsTable from './components/PostHogVisitorLocationsTable'
import {
  useGA4Overview,
  useSearchConsoleOverview,
  usePageHealth,
  usePageSpeed,
  usePostHogOverview,
  usePostHogFunnel,
  usePostHogReplays,
  usePostHogRetention,
  usePostHogLive,
  useIndexingStats,
  type RangeOption,
} from './hooks/useAnalytics'

// Lazy-load WorldMap to avoid SSR issues with react-simple-maps
const WorldMap = dynamic(() => import('./components/WorldMap'), { ssr: false })

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
  { id: 'posthog', label: 'PostHog', icon: FlaskConical },
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

function TrafficTab({ range, onRangeChange, token }: { range: RangeOption; onRangeChange: (r: RangeOption) => void; token: string | null }) {
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

          {/* World map choropleth */}
          <WorldMap countries={ga4?.countries ?? []} />

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

          {/* Visitor locations table */}
          <VisitorLocationsTable range={range} token={token} />

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
  const indexing = useIndexingStats()

  if (error) return <ErrorCard message={error} onRetry={refetch} />
  const sc = data as any

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-sm font-semibold text-gray-700">SEO — Google Search Console</h2>
        <DateRangePicker value={range} onChange={onRangeChange} />
      </div>

      {range === '1d' && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-xs text-amber-700">
          <span>⚠️</span>
          <span>Search Console data has a 2–3 day delay — 24h may show no data.</span>
        </div>
      )}

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

          {/* Index Coverage */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Index Coverage</h3>
            {indexing.loading ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
              </div>
            ) : indexing.error ? (
              <p className="text-xs text-red-500">{indexing.error}</p>
            ) : indexing.data?.configured === false ? (
              <p className="text-xs text-gray-400">{indexing.data.message}</p>
            ) : indexing.data?.error ? (
              <p className="text-xs text-red-500">{indexing.data.error}</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-emerald-700">
                    {indexing.data?.indexed?.toLocaleString() ?? '—'}
                  </div>
                  <div className="text-xs text-emerald-600 mt-1 font-medium">✅ Indexed</div>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-red-700">
                    {indexing.data?.not_indexed?.toLocaleString() ?? '—'}
                  </div>
                  <div className="text-xs text-red-600 mt-1 font-medium">🚫 Not Indexed</div>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-gray-700">
                    {indexing.data?.submitted?.toLocaleString() ?? '—'}
                  </div>
                  <div className="text-xs text-gray-500 mt-1 font-medium">📋 Submitted</div>
                </div>
              </div>
            )}
            {indexing.data?.sitemaps?.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-gray-500 border-b border-gray-200">
                    <tr>
                      <th className="text-left py-2 pr-4">Sitemap</th>
                      <th className="text-right py-2 px-2">Submitted</th>
                      <th className="text-right py-2 px-2">Indexed</th>
                      <th className="text-right py-2 px-2">Warnings</th>
                      <th className="text-right py-2 px-2">Errors</th>
                      <th className="text-right py-2">Last Downloaded</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {indexing.data.sitemaps.map((s: any) => (
                      <tr key={s.path} className="text-gray-600">
                        <td className="py-2 pr-4 font-mono truncate max-w-xs">{s.path}</td>
                        <td className="text-right py-2 px-2">{s.submitted?.toLocaleString()}</td>
                        <td className="text-right py-2 px-2 text-emerald-600 font-medium">{s.indexed?.toLocaleString()}</td>
                        <td className="text-right py-2 px-2 text-amber-600">{s.warnings ?? '—'}</td>
                        <td className="text-right py-2 px-2 text-red-600">{s.errors ?? '—'}</td>
                        <td className="text-right py-2 text-gray-400">{s.last_downloaded ? new Date(s.last_downloaded).toLocaleDateString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
              <li>Cumulative Layout Shift (CLS)</li>
              <li>Interaction to Next Paint (INP)</li>
              <li>First Contentful Paint (FCP)</li>
              <li>Time to First Byte (TTFB)</li>
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
// PostHog Tab
// ─────────────────────────────────────────────────────────────────────────────

const PH_ORANGE = '#f3811e'

function PostHogFunnelWidget({ range }: { range: RangeOption }) {
  const { data, loading, error, refetch } = usePostHogFunnel(range)
  const ph = data as any

  if (loading) return <SkeletonChart height={180} />
  if (error) return <ErrorCard message={error} onRetry={refetch} />
  if (ph?.configured === false) return null
  if (ph?.error) return <ErrorCard message={ph.error} />
  const steps: any[] = ph?.steps ?? []
  if (steps.length === 0) return null

  const max = steps[0]?.count || 1

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
      <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
        <FlaskConical className="w-4 h-4 text-orange-500" />
        Core User Journey Funnel
      </h3>
      <div className="space-y-3">
        {steps.map((step: any, i: number) => (
          <div key={i} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-gray-700">{step.name}</span>
              <span className="text-gray-500 tabular-nums">
                {step.count.toLocaleString()} {i > 0 && <span className="text-orange-500">({step.conversion_from_prev}%)</span>}
              </span>
            </div>
            <div className="h-6 bg-gray-100 rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: PH_ORANGE, opacity: 0.8 - i * 0.15 }}
                initial={{ width: 0 }}
                animate={{ width: `${(step.count / max) * 100}%` }}
                transition={{ duration: 0.6, delay: i * 0.1 }}
              />
            </div>
            {i > 0 && step.drop_off > 0 && (
              <p className="text-xs text-gray-400">
                ↓ {step.drop_off.toLocaleString()} dropped off
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function PostHogRetentionGrid({ range = '12w' }: { range?: string }) {
  const { data, loading, error, refetch } = usePostHogRetention(range)
  const ph = data as any

  if (loading) return <SkeletonChart height={200} />
  if (error) return <ErrorCard message={error} onRetry={refetch} />
  if (ph?.configured === false) return null
  if (ph?.error) return <ErrorCard message={ph.error} />
  const cohorts: any[] = ph?.cohorts ?? []
  if (cohorts.length === 0) return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 text-center text-gray-400 text-sm py-10">
      No retention data available yet.
    </div>
  )

  const maxCols = Math.max(...cohorts.map(c => c.values.length))

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-3 overflow-x-auto">
      <h3 className="text-sm font-semibold text-gray-800">Weekly Retention Cohorts</h3>
      <table className="text-xs min-w-full">
        <thead>
          <tr>
            <th className="text-left pr-3 pb-2 text-gray-500 font-medium whitespace-nowrap">Cohort</th>
            <th className="text-right pr-2 pb-2 text-gray-500 font-medium">Size</th>
            {Array.from({ length: maxCols }).map((_, i) => (
              <th key={i} className="text-center px-1 pb-2 text-gray-500 font-medium whitespace-nowrap">
                Week {i}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((cohort: any, ri: number) => (
            <tr key={ri} className="border-t border-gray-50">
              <td className="pr-3 py-1.5 text-gray-600 whitespace-nowrap">
                {cohort.date ? new Date(cohort.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : `Cohort ${ri + 1}`}
              </td>
              <td className="text-right pr-2 py-1.5 text-gray-600 tabular-nums">{cohort.cohort_size.toLocaleString()}</td>
              {Array.from({ length: maxCols }).map((_, ci) => {
                const v = cohort.values[ci]
                const pct = v?.percentage ?? 0
                const alpha = Math.min(pct / 100, 1)
                return (
                  <td
                    key={ci}
                    className="text-center px-1 py-1.5 tabular-nums rounded"
                    style={{
                      backgroundColor: pct > 0 ? `rgba(243,129,30,${alpha * 0.7 + 0.1})` : 'transparent',
                      color: pct > 40 ? '#fff' : '#374151',
                    }}
                  >
                    {v ? `${pct}%` : '—'}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function countryFlag(code: string): string {
  if (!code || code.length !== 2) return '🌐'
  return String.fromCodePoint(
    ...code.toUpperCase().split('').map(c => 0x1F1E6 + c.charCodeAt(0) - 65)
  )
}

function timeAgo(ts: string | null): string {
  if (!ts) return '—'
  const diffMs = Date.now() - new Date(ts).getTime()
  if (!Number.isFinite(diffMs)) return '—'
  const clampedMs = Math.max(0, diffMs)
  const diffSec = Math.floor(clampedMs / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  return `${diffHr}h ago`
}

const PAGE_SIZE = 20

function PostHogLiveWidget() {
  const { data, loading, error, refetch } = usePostHogLive()
  const live = data as any
  const [page, setPage] = useState(0)

  useEffect(() => {
    setPage(0)
  }, [data])

  if (loading && !live) return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <SkeletonTable rows={4} />
    </div>
  )
  if (error) return <ErrorCard message={error} onRetry={refetch} />
  if (live?.configured === false) return null
  if (live?.error) return <ErrorCard message={live.error} onRetry={refetch} />

  const activeUsers: number = live?.active_users ?? 0
  const events: any[] = live?.events ?? []
  const asOf: string | null = live?.as_of ?? null
  const lastUpdated = asOf
    ? new Date(asOf).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null

  const totalPages = Math.ceil(events.length / PAGE_SIZE)
  const pageStart = page * PAGE_SIZE
  const pageEnd = Math.min(pageStart + PAGE_SIZE, events.length)
  const pageRows = events.slice(pageStart, pageEnd)

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
          </span>
          <span className="text-sm font-semibold text-gray-700">Live Visitors</span>
        </div>
        {lastUpdated && (
          <span className="text-xs text-gray-400">Last updated: {lastUpdated}</span>
        )}
      </div>

      {/* Active users count */}
      {activeUsers === 0 ? (
        <p className="text-sm text-gray-400 text-center py-2">No active visitors right now</p>
      ) : (
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-bold text-emerald-600">{activeUsers}</span>
          <span className="text-sm text-gray-500">user{activeUsers !== 1 ? 's' : ''} active now</span>
        </div>
      )}

      {/* Live feed table */}
      {events.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 border-b border-gray-100">
                  <th className="text-left pb-2 font-medium">Time</th>
                  <th className="text-left pb-2 font-medium">Page</th>
                  <th className="text-left pb-2 font-medium">Country</th>
                  <th className="text-left pb-2 font-medium">City</th>
                  <th className="text-left pb-2 font-medium">IP</th>
                  <th className="text-left pb-2 font-medium">Device</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {pageRows.map((ev: any, i: number) => (
                  <tr key={`${ev.timestamp ?? ''}-${ev.path ?? ''}-${pageStart + i}`} className="hover:bg-gray-50 transition-colors">
                    <td className="py-2 pr-3 text-gray-400 whitespace-nowrap">{timeAgo(ev.timestamp)}</td>
                    <td className="py-2 pr-3 text-gray-800 font-medium truncate max-w-[180px]">{ev.path || '/'}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {countryFlag(ev.country_code)} {ev.country}
                    </td>
                    <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">{ev.city || '—'}</td>
                    <td className="py-2 pr-3 font-mono text-gray-500 whitespace-nowrap">{ev.ip || '—'}</td>
                    <td className="py-2 text-gray-500 whitespace-nowrap">
                      {ev.device === 'Mobile' ? (
                        <Smartphone className="w-3.5 h-3.5 inline text-gray-400" aria-label="Mobile" />
                      ) : (
                        <Monitor className="w-3.5 h-3.5 inline text-gray-400" aria-label="Desktop" />
                      )}
                      {ev.browser && <span className="ml-1">{ev.browser}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {events.length > PAGE_SIZE && (
            <div className="flex items-center justify-between pt-2 border-t border-gray-100">
              <span className="text-xs text-gray-400">
                Showing {pageStart + 1}–{pageEnd} of {events.length}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-2.5 py-1 rounded text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Prev
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="px-2.5 py-1 rounded text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function PostHogReplaysCard({ range }: { range: RangeOption }) {
  const { data, loading, error, refetch } = usePostHogReplays(10, range)
  const ph = data as any

  if (loading) return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <SkeletonTable rows={5} />
    </div>
  )
  if (error) return <ErrorCard message={error} onRetry={refetch} />
  if (ph?.configured === false) return null
  if (ph?.error) return <ErrorCard message={ph.error} />
  const replays: any[] = ph?.replays ?? []

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-3">
      <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
        <Video className="w-4 h-4 text-orange-500" />
        Recent Session Replays
      </h3>
      {replays.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-6">No replays recorded yet.</p>
      ) : (
        <div className="divide-y divide-gray-50">
          {replays.map((replay: any, i: number) => {
            const durationSec = Math.round((replay.duration || 0))
            const durationStr = durationSec >= 60
              ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`
              : `${durationSec}s`
            const startDate = replay.start_time
              ? new Date(replay.start_time).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
              : '—'
            return (
              <motion.div
                key={replay.session_id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="flex items-center justify-between py-2.5 gap-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-800 truncate">{replay.start_url || '(unknown)'}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {startDate} · <Timer className="w-3 h-3 inline" aria-hidden="true" /> {durationStr}
                    {replay.click_count > 0 && ` · ${replay.click_count} clicks`}
                  </p>
                </div>
                <a
                  href={replay.replay_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-orange-600 hover:text-orange-700 border border-orange-200 hover:border-orange-400 px-2.5 py-1 rounded-lg transition-colors"
                >
                  <Play className="w-3 h-3" />
                  Watch
                </a>
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function PostHogTab({ range, onRangeChange, token }: { range: RangeOption; onRangeChange: (r: RangeOption) => void; token: string | null }) {
  const { data, loading, error, refetch } = usePostHogOverview(range)
  const ph = data as any

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-orange-100">
              <FlaskConical className="w-3 h-3 text-orange-600" />
            </span>
            PostHog — Product Analytics
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">Traffic, funnels, session replays, and retention.</p>
        </div>
        <DateRangePicker value={range} onChange={onRangeChange} />
      </div>

      {error && <ErrorCard message={error} onRetry={refetch} />}

      {!loading && ph?.configured === false ? (
        <NotConfiguredCard
          service="PostHog"
          message={ph.message}
          steps={[
            'Go to PostHog (app.posthog.com) → Personal Settings → Personal API Keys',
            'Click "Create personal API key" — give it scopes: query:read, session_recording:read, project:read',
            'Copy the key and set POSTHOG_PERSONAL_API_KEY in your environment variables',
            'Optionally set POSTHOG_PROJECT_ID (default: 396739) and POSTHOG_HOST (default: https://us.i.posthog.com)',
            'The public site tracking (NEXT_PUBLIC_POSTHOG_KEY) is already pre-configured',
          ]}
        />
      ) : (
        <>
          {/* Live Visitors widget — always first */}
          <PostHogLiveWidget />

          {/* Stat cards */}
          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : ph?.error ? (
            <ErrorCard message={ph.error} onRetry={refetch} />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <StatCard
                label={`Pageviews (${range})`}
                value={ph?.summary?.pageviews ?? null}
                icon={<Eye className="w-4 h-4" />}
                delay={0}
              />
              <StatCard
                label={`Sessions (${range})`}
                value={ph?.summary?.sessions ?? null}
                icon={<Activity className="w-4 h-4" />}
                delay={0.05}
              />
              <StatCard
                label={`Users (${range})`}
                value={ph?.summary?.users ?? null}
                icon={<Users className="w-4 h-4" />}
                delay={0.1}
              />
            </div>
          )}

          {/* Pageviews timeseries */}
          {loading ? (
            <SkeletonChart height={240} />
          ) : ph?.timeseries?.length > 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-800 mb-4">Pageviews Over Time</h3>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={ph.timeseries} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="phGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={PH_ORANGE} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={PH_ORANGE} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={40} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }} />
                  <Area type="monotone" dataKey="pageviews" stroke={PH_ORANGE} strokeWidth={2} fill="url(#phGrad)" dot={false} activeDot={{ r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : null}

          {/* Top pages + Top events */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {loading ? (
              <>
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5"><SkeletonTable /></div>
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5"><SkeletonTable /></div>
              </>
            ) : (
              <>
                {/* Top Pages */}
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-3">
                  <h3 className="text-sm font-semibold text-gray-800">Top Pages</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-400 border-b border-gray-100">
                          <th className="text-left pb-2 font-medium">Path</th>
                          <th className="text-right pb-2 font-medium">Pageviews</th>
                          <th className="text-right pb-2 font-medium">Visitors</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {(ph?.top_pages ?? []).slice(0, 10).map((p: any, i: number) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="py-1.5 text-gray-700 truncate max-w-[180px]">{p.path}</td>
                            <td className="py-1.5 text-right tabular-nums text-gray-600">{p.pageviews.toLocaleString()}</td>
                            <td className="py-1.5 text-right tabular-nums text-gray-600">{p.unique_visitors.toLocaleString()}</td>
                          </tr>
                        ))}
                        {(ph?.top_pages ?? []).length === 0 && (
                          <tr><td colSpan={3} className="py-6 text-center text-gray-400">No data yet</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Top Events */}
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-3">
                  <h3 className="text-sm font-semibold text-gray-800">Top Events</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-400 border-b border-gray-100">
                          <th className="text-left pb-2 font-medium">Event</th>
                          <th className="text-right pb-2 font-medium">Count</th>
                          <th className="text-right pb-2 font-medium">Users</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {(ph?.top_events ?? []).slice(0, 10).map((e: any, i: number) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="py-1.5 text-gray-700 font-mono truncate max-w-[180px]">{e.event}</td>
                            <td className="py-1.5 text-right tabular-nums text-gray-600">{e.count.toLocaleString()}</td>
                            <td className="py-1.5 text-right tabular-nums text-gray-600">{e.unique_users.toLocaleString()}</td>
                          </tr>
                        ))}
                        {(ph?.top_events ?? []).length === 0 && (
                          <tr><td colSpan={3} className="py-6 text-center text-gray-400">No data yet</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Top referrers + Country breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {loading ? (
              <>
                <SkeletonChart height={220} />
                <SkeletonChart height={220} />
              </>
            ) : (
              <>
                <SimpleBarChart
                  title="Top Referrers"
                  data={(ph?.top_referrers ?? []).map((r: any) => ({ label: r.referrer, value: r.sessions }))}
                  color={PH_ORANGE}
                  valueLabel="Sessions"
                />
                <SimpleBarChart
                  title="Top Countries"
                  data={(ph?.countries ?? []).map((c: any) => ({ label: c.country, value: c.users }))}
                  color="#6366f1"
                  valueLabel="Users"
                />
              </>
            )}
          </div>

          {/* World map choropleth */}
          {!loading && (ph?.countries ?? []).length > 0 && (
            <WorldMap countries={ph?.countries ?? []} />
          )}

          {/* PostHog visitor IP/location table */}
          <PostHogVisitorLocationsTable range={range} token={token} />

          {/* Device breakdown */}
          {!loading && (ph?.devices ?? []).length > 0 && (
            <DonutChart
              title="Device Breakdown"
              data={(ph.devices).map((d: any) => ({ name: d.device, value: d.users }))}
              valueLabel="Users"
            />
          )}

          {/* Funnel */}
          <PostHogFunnelWidget range={range} />

          {/* Session replays */}
          <PostHogReplaysCard range={range} />

          {/* Retention */}
          {range === '1d' ? (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-8 text-center text-gray-400 text-sm">
              Weekly retention is not meaningful for the 24h view. Switch to 7 days or longer.
            </div>
          ) : (
            <PostHogRetentionGrid range={{ '7d': '4w', '28d': '8w', '90d': '12w' }[range] ?? '8w'} />
          )}
        </>
      )}
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
  const [token, setToken] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    const init = async () => {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push('/admin/login')
        return
      }
      setToken(session.access_token)
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
                  isActive
                    ? tab.id === 'posthog' ? 'text-orange-600' : 'text-emerald-700'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="sr-only sm:not-sr-only">{tab.label}</span>
                {isActive && (
                  <motion.div
                    layoutId="tab-underline"
                    className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
                    style={{ backgroundColor: tab.id === 'posthog' ? '#f3811e' : '#059669' }}
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
          {activeTab === 'traffic' && <TrafficTab range={range} onRangeChange={setRange} token={token} />}
          {activeTab === 'seo' && <SeoTab range={range} onRangeChange={setRange} />}
          {activeTab === 'performance' && <PerformanceTab />}
          {activeTab === 'page-health' && <PageHealthTab />}
          {activeTab === 'vercel' && <VercelTab />}
          {activeTab === 'posthog' && <PostHogTab range={range} onRangeChange={setRange} token={token} />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
