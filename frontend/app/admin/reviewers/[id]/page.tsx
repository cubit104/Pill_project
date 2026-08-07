'use client'

export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Plus, X } from 'lucide-react'
import { createClient } from '../../lib/supabase'
import AvatarUpload from '../components/AvatarUpload'

const ROLE_OPTIONS = [
  { value: 'medical_reviewer', label: 'Medical Reviewer' },
  { value: 'author', label: 'Author' },
  { value: 'editor', label: 'Editor' },
  { value: 'fact_checker', label: 'Fact Checker' },
]

interface ReviewerForm {
  name: string
  credentials: string
  role: string
  specialty: string
  bio: string
  license_info: string
  same_as: string[]
  avatar_url: string
}

const EMPTY_FORM: ReviewerForm = {
  name: '',
  credentials: '',
  role: 'medical_reviewer',
  specialty: '',
  bio: '',
  license_info: '',
  same_as: [],
  avatar_url: '',
}

export default function ReviewerEditPage() {
  const params = useParams()
  const router = useRouter()
  const id = params?.id as string
  const isNew = id === 'new'

  const [form, setForm] = useState<ReviewerForm>(EMPTY_FORM)
  const [reviewerId, setReviewerId] = useState<string | null>(isNew ? null : id)
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [newSameAs, setNewSameAs] = useState('')

  const getToken = useCallback(async () => {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? ''
  }, [])

  useEffect(() => {
    if (isNew) return
    const load = async () => {
      try {
        const token = await getToken()
        const res = await fetch(`/api/admin/reviewers/${id}`, {
          headers: { Authorization: `****** },
        })
        if (!res.ok) throw new Error('Reviewer not found')
        const data = await res.json()
        setForm({
          name: data.name ?? '',
          credentials: data.credentials ?? '',
          role: data.role ?? 'medical_reviewer',
          specialty: data.specialty ?? '',
          bio: data.bio ?? '',
          license_info: data.license_info ?? '',
          same_as: data.same_as ?? [],
          avatar_url: data.avatar_url ?? '',
        })
        setReviewerId(data.id)
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load reviewer')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id, isNew, getToken])

  function setField<K extends keyof ReviewerForm>(key: K, value: ReviewerForm[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function addSameAs() {
    const url = newSameAs.trim()
    if (!url) return
    setField('same_as', [...form.same_as, url])
    setNewSameAs('')
  }

  function removeSameAs(index: number) {
    setField('same_as', form.same_as.filter((_, i) => i !== index))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!form.name.trim()) { setError('Name is required'); return }
    if (!form.credentials.trim()) { setError('Credentials are required'); return }

    setSaving(true)
    try {
      const token = await getToken()
      const body = {
        name: form.name.trim(),
        credentials: form.credentials.trim(),
        role: form.role,
        specialty: form.specialty.trim() || null,
        bio: form.bio.trim() || null,
        license_info: form.license_info.trim() || null,
        same_as: form.same_as,
      }

      let res: Response
      if (isNew) {
        res = await fetch('/api/admin/reviewers', {
          method: 'POST',
          headers: { Authorization: `****** 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      } else {
        res = await fetch(`/api/admin/reviewers/${reviewerId}`, {
          method: 'PUT',
          headers: { Authorization: `****** 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || 'Save failed')
      }

      const data = await res.json()
      if (isNew) {
        router.push(`/admin/reviewers/${data.id}`)
      } else {
        setSuccess('Saved successfully')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm('Deactivate this reviewer? They will no longer appear publicly.')) return
    setDeleting(true)
    setError('')
    try {
      const token = await getToken()
      const res = await fetch(`/api/admin/reviewers/${reviewerId}`, {
        method: 'DELETE',
        headers: { Authorization: `****** },
      })
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || 'Delete failed')
      }
      router.push('/admin/reviewers')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Delete failed')
      setDeleting(false)
    }
  }

  if (loading) {
    return <div className="p-6 text-gray-400 text-sm">Loading…</div>
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/admin/reviewers"
          className="text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-2xl font-bold text-white">
          {isNew ? 'Add Reviewer' : 'Edit Reviewer'}
        </h1>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-md p-3 text-sm mb-4">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-emerald-900/30 border border-emerald-700 text-emerald-300 rounded-md p-3 text-sm mb-4">
          {success}
        </div>
      )}

      {/* Avatar upload — only for existing reviewers */}
      {!isNew && reviewerId && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 mb-6 flex justify-center">
          <AvatarUpload
            reviewerId={reviewerId}
            currentUrl={form.avatar_url || null}
            onUpload={(url) => setField('avatar_url', url)}
          />
        </div>
      )}
      {isNew && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-6">
          <p className="text-gray-400 text-sm text-center">
            Save the reviewer first, then you can upload a photo.
          </p>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-5">
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Name <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setField('name', e.target.value)}
            placeholder="Dr. Jane Smith"
            className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {/* Credentials */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Credentials <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={form.credentials}
            onChange={(e) => setField('credentials', e.target.value)}
            placeholder="PharmD, RPh"
            className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {/* Role */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Role</label>
          <select
            value={form.role}
            onChange={(e) => setField('role', e.target.value)}
            className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Specialty */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Specialty</label>
          <input
            type="text"
            value={form.specialty}
            onChange={(e) => setField('specialty', e.target.value)}
            placeholder="Clinical Pharmacy"
            className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {/* Bio */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Bio</label>
          <textarea
            value={form.bio}
            onChange={(e) => setField('bio', e.target.value)}
            rows={4}
            placeholder="Licensed pharmacist with 15 years experience…"
            className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-vertical"
          />
        </div>

        {/* License Info */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">License Info</label>
          <input
            type="text"
            value={form.license_info}
            onChange={(e) => setField('license_info', e.target.value)}
            placeholder="CA RPH #12345"
            className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {/* Same As URLs */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            LinkedIn / ORCID / Profile URLs
          </label>
          <div className="space-y-2">
            {form.same_as.map((url, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="flex-1 text-sm text-gray-300 bg-gray-700 border border-gray-600 rounded-md px-3 py-2 truncate">
                  {url}
                </span>
                <button
                  type="button"
                  onClick={() => removeSameAs(i)}
                  className="text-gray-400 hover:text-red-400 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <input
                type="url"
                value={newSameAs}
                onChange={(e) => setNewSameAs(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSameAs() } }}
                placeholder="https://linkedin.com/in/…"
                className="flex-1 bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="button"
                onClick={addSameAs}
                className="flex items-center gap-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 border border-gray-600 text-white rounded-md text-sm transition-colors"
              >
                <Plus className="w-4 h-4" /> Add
              </button>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md text-sm font-medium transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : isNew ? 'Create Reviewer' : 'Save Changes'}
          </button>

          {!isNew && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="px-4 py-2 bg-red-900/40 hover:bg-red-900/60 border border-red-700 text-red-300 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
            >
              {deleting ? 'Deactivating…' : 'Deactivate'}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
