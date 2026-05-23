'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { createClient } from '../lib/supabase'

interface SnapshotAttentionRow {
  slug: string
  pill_id: string | null
  match_type: string
  resolved_via: string | null
  is_estimate: boolean
  resolver_notes: string | null
  resolved_at: string | null
}

export default function AdminSnapshotsPage() {
  const router = useRouter()
  const [rows, setRows] = useState<SnapshotAttentionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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
        const res = await fetch('/api/admin/snapshots/attention?limit=200', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (res.status === 401 || res.status === 403) {
          router.push('/admin/login')
          return
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        const data = await res.json()
        setRows(Array.isArray(data.rows) ? data.rows : [])
      } catch {
        setError('Failed to load pricing snapshots that need attention.')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [router])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading snapshot queue…</div>
      </div>
    )
  }

  if (error) {
    return <div className="text-red-600 p-4 bg-red-50 rounded-md">{error}</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Pricing snapshots needing attention</h1>
        <p className="mt-2 text-sm text-gray-600">
          These pills still need an exact snapshot match or a valid offers payload for search indexing.
        </p>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">Slug</th>
                <th className="px-4 py-3 font-medium">Match</th>
                <th className="px-4 py-3 font-medium">Resolved via</th>
                <th className="px-4 py-3 font-medium">Estimate</th>
                <th className="px-4 py-3 font-medium">Resolved at</th>
                <th className="px-4 py-3 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    No snapshot rows currently need attention.
                  </td>
                </tr>
              ) : rows.map((row) => (
                <tr key={row.slug}>
                  <td className="px-4 py-3 font-medium text-gray-900">{row.slug}</td>
                  <td className="px-4 py-3 text-gray-700">{row.match_type}</td>
                  <td className="px-4 py-3 text-gray-700">{row.resolved_via || '—'}</td>
                  <td className="px-4 py-3 text-gray-700">{row.is_estimate ? 'Yes' : 'No'}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {row.resolved_at ? new Date(row.resolved_at).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{row.resolver_notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
