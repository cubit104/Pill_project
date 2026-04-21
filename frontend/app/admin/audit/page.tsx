'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '../lib/supabase'

interface AuditEntry {
  id: number
  occurred_at: string
  actor_email: string
  action: string
  entity_type: string
  entity_id: string
  diff: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
}

const ACTION_COLORS: Record<string, string> = {
  create: 'bg-green-100 text-green-700',
  update: 'bg-blue-100 text-blue-700',
  delete: 'bg-red-100 text-red-600',
  restore: 'bg-purple-100 text-purple-700',
  publish: 'bg-indigo-100 text-indigo-700',
  approve_draft: 'bg-green-100 text-green-700',
  reject_draft: 'bg-red-100 text-red-600',
  upload_image: 'bg-yellow-100 text-yellow-700',
}

function AuditLogInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const entityType = searchParams.get('entity_type') || ''
  const action = searchParams.get('action') || ''

  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)

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

      const params = new URLSearchParams({ limit: '100', offset: '0' })
      if (entityType) params.set('entity_type', entityType)
      if (action) params.set('action', action)

      setLoading(true)
      try {
        const res = await fetch(`/api/admin/audit?${params}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!res.ok) throw new Error('Failed to fetch audit log')
        setEntries(await res.json())
      } catch (e) {
        setError(String(e))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [entityType, action, router])

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-2 rounded-md text-sm">{error}</div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Time</th>
              <th className="px-4 py-3 text-left">Actor</th>
              <th className="px-4 py-3 text-left">Action</th>
              <th className="px-4 py-3 text-left">Entity</th>
              <th className="px-4 py-3 text-left">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && entries.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  No audit entries found
                </td>
              </tr>
            )}
            {entries.map((entry) => (
              <React.Fragment key={entry.id}>
                <tr
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
                >
                  <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                    {entry.occurred_at ? new Date(entry.occurred_at).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{entry.actor_email || '—'}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${ACTION_COLORS[entry.action] || 'bg-gray-100 text-gray-600'}`}
                    >
                      {entry.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {entry.entity_type}
                    {entry.entity_id && (
                      <span className="text-xs text-gray-400 ml-1">#{entry.entity_id.slice(0, 8)}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-indigo-500">
                    {(entry.diff || entry.metadata) ? '▼ expand' : '—'}
                  </td>
                </tr>
                {expanded === entry.id && (entry.diff || entry.metadata) && (
                  <tr>
                    <td colSpan={5} className="px-4 pb-3 bg-gray-50">
                      <pre className="text-xs text-gray-600 overflow-auto max-h-48 bg-white border border-gray-200 rounded p-2">
                        {JSON.stringify(entry.diff || entry.metadata, null, 2)}
                      </pre>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function AdminAuditPage() {
  return (
    <Suspense fallback={<div className="p-4 text-gray-500">Loading…</div>}>
      <AuditLogInner />
    </Suspense>
  )
}
