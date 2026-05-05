'use client'

export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '../lib/supabase'
import { CheckCircle, XCircle, Clock, Send, Pencil, X } from 'lucide-react'

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

interface DraftDetail extends Draft {
  draft_data: Record<string, string>
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  pending_review: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  published: 'bg-blue-100 text-blue-700',
  rejected: 'bg-red-100 text-red-600',
}

// Key fields to show in the inline edit form (most important first)
const EDIT_FORM_FIELDS = [
  { key: 'medicine_name', label: 'Drug Name' },
  { key: 'spl_strength', label: 'Strength' },
  { key: 'splimprint', label: 'Imprint' },
  { key: 'splcolor_text', label: 'Color' },
  { key: 'splshape_text', label: 'Shape' },
  { key: 'author', label: 'Manufacturer' },
  { key: 'dosage_form', label: 'Dosage Form' },
  { key: 'route', label: 'Route' },
  { key: 'ndc9', label: 'NDC-9' },
  { key: 'ndc11', label: 'NDC-11' },
  { key: 'status_rx_otc', label: 'Rx/OTC Status' },
  { key: 'dea_schedule_name', label: 'DEA Schedule' },
  { key: 'spl_ingredients', label: 'Active Ingredients', multiline: true },
  { key: 'spl_inactive_ing', label: 'Inactive Ingredients', multiline: true },
  { key: 'tags', label: 'Tags (comma-separated)' },
  { key: 'slug', label: 'Slug' },
  { key: 'meta_description', label: 'Meta Description', multiline: true },
  { key: 'brand_names', label: 'Brand Names' },
  { key: 'image_alt_text', label: 'Image Alt Text' },
]

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

  // Edit modal state
  const [editingDraft, setEditingDraft] = useState<DraftDetail | null>(null)
  const [editForm, setEditForm] = useState<Record<string, string>>({})
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')

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
        window.dispatchEvent(new Event('draft-count-changed'))
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setActioning(null)
    }
  }

  const startEditDraft = async (draftId: string) => {
    const supabase = createClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) return

    try {
      const res = await fetch(`/api/admin/drafts/${draftId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) {
        const err = await res.json()
        setError(err.detail || 'Failed to load draft')
        return
      }
      const data: DraftDetail = await res.json()
      setEditingDraft(data)
      setEditForm(data.draft_data || {})
      setEditError('')
    } catch (e) {
      setError(String(e))
    }
  }

  const handleEditSave = async () => {
    if (!editingDraft) return
    const supabase = createClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) return

    setEditSaving(true)
    setEditError('')
    try {
      const res = await fetch(`/api/admin/drafts/${editingDraft.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ draft_data: editForm }),
      })
      if (!res.ok) {
        const err = await res.json()
        setEditError(err.detail || 'Save failed')
        return
      }
      setEditingDraft(null)
      fetchDrafts()
    } catch (e) {
      setEditError(String(e))
    } finally {
      setEditSaving(false)
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
                        onClick={() => startEditDraft(draft.id)}
                        disabled={actioning === draft.id}
                        className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 disabled:opacity-50"
                      >
                        <Pencil className="w-3 h-3" /> Edit
                      </button>
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

      {/* Edit Draft Modal */}
      {editingDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Edit Draft</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  #{editingDraft.id.slice(0, 8)} — {editingDraft.medicine_name || '(new pill)'}
                </p>
              </div>
              <button
                onClick={() => setEditingDraft(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-4 space-y-4">
              {editError && (
                <div className="bg-red-50 text-red-700 px-3 py-2 rounded text-sm">{editError}</div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {EDIT_FORM_FIELDS.map(({ key, label, multiline }) => (
                  <div key={key} className={multiline ? 'sm:col-span-2' : ''}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                    {multiline ? (
                      <textarea
                        value={editForm[key] ?? ''}
                        onChange={(e) => setEditForm({ ...editForm, [key]: e.target.value })}
                        rows={3}
                        className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
                      />
                    ) : (
                      <input
                        type="text"
                        value={editForm[key] ?? ''}
                        onChange={(e) => setEditForm({ ...editForm, [key]: e.target.value })}
                        className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setEditingDraft(null)}
                className="px-4 py-2 text-sm text-gray-600 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleEditSave}
                disabled={editSaving}
                className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
              >
                {editSaving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
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

