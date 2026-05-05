'use client'

export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback, Suspense } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '../../../lib/supabase'
import { ArrowLeft, Save, Send } from 'lucide-react'

interface DraftData {
  medicine_name?: string
  spl_strength?: string
  splimprint?: string
  splcolor_text?: string
  splshape_text?: string
  dosage_form?: string
  route?: string
  spl_ingredients?: string
  [key: string]: string | undefined
}

interface Draft {
  id: string
  pill_id: string | null
  status: string
  created_at: string
  updated_at: string
  review_notes: string | null
  draft_data: DraftData
  medicine_name: string | null
}

const EDITABLE_FIELDS: { key: keyof DraftData; label: string; multiline?: boolean }[] = [
  { key: 'medicine_name', label: 'Medicine Name' },
  { key: 'spl_strength', label: 'Strength' },
  { key: 'splimprint', label: 'Imprint' },
  { key: 'splcolor_text', label: 'Color' },
  { key: 'splshape_text', label: 'Shape' },
  { key: 'dosage_form', label: 'Dosage Form' },
  { key: 'route', label: 'Route' },
  { key: 'spl_ingredients', label: 'Active Ingredients', multiline: true },
]

async function safeErrorDetail(res: Response, fallback: string): Promise<string> {
  try {
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('application/json')) {
      const body = await res.json()
      if (body && typeof body.detail === 'string') return body.detail
      if (body && body.detail) return JSON.stringify(body.detail)
      return `${fallback} (HTTP ${res.status})`
    }
    const text = await res.text()
    if (text) return `${fallback}: ${text.slice(0, 500)} (HTTP ${res.status})`
  } catch {
    /* ignore */
  }
  return `${fallback} (HTTP ${res.status})`
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  pending_review: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  published: 'bg-blue-100 text-blue-700',
  rejected: 'bg-red-100 text-red-600',
}

function DraftEditInner() {
  const params = useParams()
  const draftId = params.id as string
  const router = useRouter()

  const [draft, setDraft] = useState<Draft | null>(null)
  const [form, setForm] = useState<DraftData>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const getSession = useCallback(async () => {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    return session
  }, [])

  const loadDraft = useCallback(async () => {
    const session = await getSession()
    if (!session) { router.push('/admin/login'); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/drafts/${draftId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) throw new Error(await safeErrorDetail(res, 'Failed to load draft'))
      const data: Draft = await res.json()
      setDraft(data)
      const dd = data.draft_data || {}
      const initialForm: DraftData = {}
      EDITABLE_FIELDS.forEach(({ key }) => {
        initialForm[key] = dd[key] ?? ''
      })
      setForm(initialForm)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [draftId, router, getSession])

  useEffect(() => { loadDraft() }, [loadDraft])

  const handleSave = async () => {
    setSaving(true); setError(''); setSuccess('')
    const session = await getSession()
    if (!session) return
    try {
      const updatedDraftData = { ...(draft?.draft_data || {}), ...form }
      const res = await fetch(`/api/admin/drafts/${draftId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft_data: updatedDraftData }),
      })
      if (!res.ok) throw new Error(await safeErrorDetail(res, 'Save failed'))
      setSuccess('Draft saved successfully')
      await loadDraft()
    } catch (e) { setError(String(e)) } finally { setSaving(false) }
  }

  const handleSubmit = async () => {
    setSubmitting(true); setError(''); setSuccess('')
    const session = await getSession()
    if (!session) return
    try {
      // Save current edits first if the draft is still in draft status
      if (draft?.status === 'draft') {
        const updatedDraftData = { ...(draft?.draft_data || {}), ...form }
        const saveRes = await fetch(`/api/admin/drafts/${draftId}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ draft_data: updatedDraftData }),
        })
        if (!saveRes.ok) throw new Error(await safeErrorDetail(saveRes, 'Save before submit failed'))
      }
      const res = await fetch(`/api/admin/drafts/${draftId}/submit`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error(await safeErrorDetail(res, 'Submit failed'))
      setSuccess('Draft submitted for review')
      await loadDraft()
    } catch (e) { setError(String(e)) } finally { setSubmitting(false) }
  }

  if (loading) return <div className="p-4 text-gray-500">Loading draft…</div>

  const isEditable = draft?.status === 'draft'

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Link href="/admin/drafts" className="text-gray-500 hover:text-gray-700 flex items-center gap-1 text-sm">
          <ArrowLeft className="w-4 h-4" /> Back to Drafts
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">
          Edit Draft #{draftId.slice(0, 8)}
        </h1>
        {draft && (
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[draft.status] || 'bg-gray-100 text-gray-600'}`}>
            {draft.status}
          </span>
        )}
      </div>

      {draft?.medicine_name && (
        <p className="text-gray-600 text-sm">Medicine: <strong>{draft.medicine_name}</strong></p>
      )}

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-md text-sm">{error}</div>
      )}
      {success && (
        <div className="bg-green-50 text-green-700 px-4 py-3 rounded-md text-sm">{success}</div>
      )}

      {!isEditable && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-md text-sm">
          This draft is in <strong>{draft?.status}</strong> status and cannot be edited. Only drafts with status &quot;draft&quot; can be modified.
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
        {EDITABLE_FIELDS.map(({ key, label, multiline }) => (
          <div key={key}>
            <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
            {multiline ? (
              <textarea
                rows={4}
                disabled={!isEditable}
                value={form[key] ?? ''}
                onChange={(e) => setForm(prev => ({ ...prev, [key]: e.target.value }))}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-y disabled:bg-gray-50 disabled:text-gray-500"
              />
            ) : (
              <input
                type="text"
                disabled={!isEditable}
                value={form[key] ?? ''}
                onChange={(e) => setForm(prev => ({ ...prev, [key]: e.target.value }))}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-50 disabled:text-gray-500"
              />
            )}
          </div>
        ))}
      </div>

      {draft?.review_notes && (
        <div className="bg-gray-50 border border-gray-200 rounded-md px-4 py-3 text-sm text-gray-700">
          <span className="font-medium">Review notes:</span> {draft.review_notes}
        </div>
      )}

      <div className="flex gap-3 flex-wrap">
        {isEditable && (
          <>
            <button
              onClick={handleSave}
              disabled={saving || submitting}
              className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium transition-colors"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving || submitting}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm font-medium transition-colors"
            >
              <Send className="w-4 h-4" />
              {submitting ? 'Submitting…' : 'Submit for Review'}
            </button>
          </>
        )}
        <Link
          href="/admin/drafts"
          className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-50 text-sm font-medium transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Drafts
        </Link>
      </div>
    </div>
  )
}

export default function DraftEditPage() {
  return (
    <Suspense fallback={<div className="p-4 text-gray-500">Loading…</div>}>
      <DraftEditInner />
    </Suspense>
  )
}
