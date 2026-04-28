'use client'

export const dynamic = 'force-dynamic'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from './lib/supabase'

interface Stats {
  total_pills: number
  unique_drugs: number
  missing_images: number
  pending_drafts: number
  score_80_90: number
  score_90_100: number
  recent_activity: Array<{
    id: number
    occurred_at: string
    actor_email: string
    action: string
    entity_type: string
    entity_id: string
  }>
}

interface RecentPill {
  id: string
  medicine_name: string | null
  splimprint: string | null
  spl_strength: string | null
  updated_at: string | null
  slug: string | null
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [recentPills, setRecentPills] = useState<RecentPill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const router = useRouter()

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        router.push('/admin/login')
        return
      }

      try {
        const res = await fetch('/api/admin/stats', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (res.status === 401 || res.status === 403) {
          router.push('/admin/login')
          return
        }
        const data = await res.json()
        setStats(data)

        const recentRes = await fetch('/api/admin/pills/recent?limit=10', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (recentRes.ok) {
          const recentData = await recentRes.json()
          setRecentPills(recentData)
        }
      } catch {
        setError('Failed to load dashboard stats')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [router])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading dashboard…</div>
      </div>
    )
  }

  if (error) {
    return <div className="text-red-600 p-4 bg-red-50 rounded-md">{error}</div>
  }

  const cards = [
    { label: 'Total Pills',    value: stats?.total_pills    ?? 0, color: 'bg-blue-50 text-blue-700 border-blue-200',     href: null },
    { label: 'Unique Drugs',   value: stats?.unique_drugs   ?? 0, color: 'bg-green-50 text-green-700 border-green-200',   href: null },
    { label: 'Missing Images', value: stats?.missing_images ?? 0, color: 'bg-yellow-50 text-yellow-700 border-yellow-200', href: '/admin/pills/missing-images' },
    { label: 'Pending Drafts', value: stats?.pending_drafts ?? 0, color: 'bg-purple-50 text-purple-700 border-purple-200', href: null },
    {
      label: 'Score 80–90',
      value: stats?.score_80_90 ?? 0,
      color: 'bg-orange-50 text-orange-700 border-orange-200',
      href: '/admin/pills/incomplete',
      badge: true,
    },
    {
      label: 'Score 90–100',
      value: stats?.score_90_100 ?? 0,
      color: 'bg-teal-50 text-teal-700 border-teal-200',
      href: '/admin/pills/incomplete',
      badge: true,
    },
  ]

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {cards.map(({ label, value, color, href }) => {
          const content = (
            <>
              <div className="text-3xl font-bold">{value.toLocaleString()}</div>
              <div className="text-sm font-medium mt-1 opacity-80">{label}</div>
              {href && <div className="text-xs mt-2 opacity-60">Click to view →</div>}
            </>
          )
          return href ? (
            <Link
              key={label}
              href={href}
              className={`${color} border rounded-lg p-6 hover:opacity-90 transition-opacity`}
            >
              {content}
            </Link>
          ) : (
            <div key={label} className={`${color} border rounded-lg p-6`}>
              {content}
            </div>
          )
        })}
      </div>

      <div className="flex gap-3 flex-wrap">
        <Link
          href="/admin/pills"
          className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 text-sm font-medium transition-colors"
        >
          Search Pills
        </Link>
        <Link
          href="/admin/pills/new"
          className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 text-sm font-medium transition-colors"
        >
          + Add New Pill
        </Link>
        <Link
          href="/admin/drafts?status=pending_review"
          className="bg-purple-600 text-white px-4 py-2 rounded-md hover:bg-purple-700 text-sm font-medium transition-colors"
        >
          Review Queue
          {(stats?.pending_drafts ?? 0) > 0 && (
            <span className="ml-2 bg-white text-purple-700 text-xs font-bold px-1.5 py-0.5 rounded-full">
              {stats?.pending_drafts}
            </span>
          )}
        </Link>
        <Link
          href="/admin/duplicates"
          className="bg-yellow-600 text-white px-4 py-2 rounded-md hover:bg-yellow-700 text-sm font-medium transition-colors"
        >
          Duplicates
        </Link>
        <Link
          href="/admin/pills/incomplete"
          className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 text-sm font-medium transition-colors"
        >
          Incomplete Pills
        </Link>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="p-4 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">Recent Activity</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {!stats?.recent_activity?.length && (
            <div className="p-4 text-gray-500 text-sm">No recent activity</div>
          )}
          {stats?.recent_activity?.map((entry) => (
            <div key={entry.id} className="p-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <span className="font-medium text-sm text-gray-900">{entry.actor_email}</span>
                <span className="text-gray-500 text-sm"> {entry.action} </span>
                <span className="text-sm text-gray-700">
                  {entry.entity_type}
                  {entry.entity_id ? ` #${entry.entity_id.slice(0, 8)}` : ''}
                </span>
              </div>
              <div className="text-xs text-gray-400 shrink-0">
                {entry.occurred_at ? new Date(entry.occurred_at).toLocaleString() : ''}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Recently Edited</h2>
          <Link href="/admin/pills?sort=recent" className="text-xs text-indigo-500 hover:underline">View all →</Link>
        </div>
        <div className="divide-y divide-gray-100">
          {!recentPills?.length && (
            <div className="p-4 text-gray-500 text-sm">No recent edits</div>
          )}
          {recentPills?.map((pill) => (
            <div key={pill.id} className="p-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <Link href={`/admin/pills/${pill.id}`} className="font-medium text-sm text-indigo-600 hover:underline">
                  {pill.medicine_name || '(no name)'}
                </Link>
                {pill.splimprint && <span className="ml-2 text-xs text-gray-500">{pill.splimprint}</span>}
                {pill.spl_strength && <div className="text-xs text-gray-400">{pill.spl_strength}</div>}
              </div>
              <div className="text-xs text-gray-400 shrink-0">
                {pill.updated_at ? new Date(pill.updated_at).toLocaleString() : ''}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
