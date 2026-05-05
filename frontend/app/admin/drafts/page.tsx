'use client'

export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '../lib/supabase'
import { CheckCircle, XCircle, Clock, Send, Pencil } from 'lucide-react'

interface Draft {
  id: string
  pill_id: string | null
  status: string
  created_at: string
  updated_at: string
  review_notes: string | null
  medicine_name: string | null
  created_by: string | null
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  pending_review: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  published: 'bg-blue-100 text-blue-700',
  rejected: 'bg-red-100 text-red-600',
}

function DraftsListInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const statusFilter = searchParams.get('status') || ''

  const [drafts, setDrafts] = useState<Draft[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actioning, setActioning] = useState<string | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [pendingCount, setPendingCount] = useState<number | null>(null)

  const fetchDrafts = useCallback(async () => {
    const supabase = createClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) {
      router.push('/admin/login')
      return
    }

    setLoading(true)
    try {
      const [draftsRes, meRes, countRes] = await Promise.all([
        fetch(`/api/admin/drafts${statusFilter ? `?status=${statusFilter}` : ''}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
        fetch('/api/admin/me', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
        fetch('/api/admin/drafts/count', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
      ])
      if (!draftsRes.ok) throw new Error('Failed to fetch drafts')
      setDrafts(await draftsRes.json())
      if (meRes.ok) {
        const meData = await meRes.json()
        setRole(meData.role)
      }
      if (countRes.ok) {
        const countData = await countRes.json()
        setPendingCount(countData.count ?? null)
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [statusFilter, router])

  useEffect(() => {
    fetchDrafts()
  }, [fetchDrafts])

  const action = async (draftId: string, endpoint: string) => {
    const supabase = createClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) return

    setActioning(draftId)
    try {
      const res = await fetch(`/api/admin/drafts/${draftId}/${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const err = await res.json()
        setError(err.detail || 'Action failed')
      } else {
        fetchDrafts()
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setActioning(null)
    }
  }

  const STATUSES = ['', 'draft', 'pending_review', 'approved', 'published', 'rejected']

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Drafts</h1>
        {pendingCount != null && pendingCount > 0 && (
          <span className="bg-yellow-400 text-yellow-900 text-sm font-bold px-2 py-0.5 rounded-full">
            {pendingCount}
          </span>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        {STATUSES.map((s) => (
          <button
            key={s || 'all'}
            onClick={() => {
              const params = new URLSearchParams()
              if (s) params.set('status', s)
              router.push(`/admin/drafts${s ? `?${params}` : ''}`)
            }}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              statusFilter === s
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-2 rounded-md text-sm">{error}</div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Draft ID</th>
              <th className="px-4 py-3 text-left">Pill</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Created</th>
              <th className="px-4 py-3 text-left">Notes</th>
              <th className="px-4 py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && drafts.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  No drafts found
                </td>
              </tr>
            )}
            {drafts.map((draft) => (
              <tr key={draft.id} className={`hover:bg-gray-50 ${draft.pill_id ? 'cursor-pointer' : ''}`}>
                <td className="px-4 py-3 font-mono text-xs text-gray-600">
                  {draft.pill_id ? (
                    <Link href={`/admin/pills/${draft.pill_id}`} className="hover:text-indigo-600 hover:underline">
                      #{draft.id.slice(0, 8)}
                    </Link>
                  ) : (
                    `#${draft.id.slice(0, 8)}`
                  )}
                </td>
                <td className="px-4 py-3 text-gray-700">{draft.medicine_name || '(new pill)'}</td>
                <td className="px-4 py-3">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[draft.status] || 'bg-gray-100 text-gray-600'}`}
                  >
                    {draft.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">
                  {new Date(draft.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs max-w-xs truncate">
                  {draft.review_notes || '—'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2 items-center">
                    {draft.pill_id && (
                      <Link
                        href={`/admin/pills/${draft.pill_id}#pending-drafts`}
                        className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800"
                      >
                        <Pencil className="w-3 h-3" /> Edit
                      </Link>
                    )}
                    {draft.status === 'draft' && (
                      <button
                        onClick={() => action(draft.id, 'submit')}
                        disabled={actioning === draft.id}
                        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50"
                      >
                        <Send className="w-3 h-3" /> Submit
                      </button>
                    )}
                    {draft.status === 'pending_review' && (role === 'superuser' || role === 'superadmin' || role === 'editor') && (
                      <>
                        <button
                          onClick={() => action(draft.id, 'approve')}
                          disabled={actioning === draft.id}
                          className="flex items-center gap-1 text-xs text-green-600 hover:text-green-800 disabled:opacity-50"
                        >
                          <CheckCircle className="w-3 h-3" /> Approve
                        </button>
                        <button
                          onClick={() => action(draft.id, 'reject')}
                          disabled={actioning === draft.id}
                          className="flex items-center gap-1 text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
                        >
                          <XCircle className="w-3 h-3" /> Reject
                        </button>
                      </>
                    )}
                    {draft.status === 'approved' && (role === 'superuser' || role === 'superadmin' || role === 'editor') && (
                      <button
                        onClick={() => action(draft.id, 'publish')}
                        disabled={actioning === draft.id}
                        className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
                      >
                        <Clock className="w-3 h-3" /> Publish
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function AdminDraftsPage() {
  return (
    <Suspense fallback={<div className="p-4 text-gray-500">Loading…</div>}>
      <DraftsListInner />
    </Suspense>
  )
}
