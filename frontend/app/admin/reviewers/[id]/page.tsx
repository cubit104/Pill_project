'use client'

export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Plus, X, createLucideIcon } from 'lucide-react'
import { createClient } from '../../lib/supabase'
import AvatarUpload from '../components/AvatarUpload'

const ROLE_OPTIONS = [
  { value: 'medical_reviewer', label: 'Medical Reviewer' },
  { value: 'author', label: 'Author' },
  { value: 'editor', label: 'Editor' },
  { value: 'fact_checker', label: 'Fact Checker' },
]

interface EducationEntry {
  institution: string
  degree: string
}

interface RegistrationEntry {
  title: string
  board: string
  url: string
}

interface ReviewerForm {
  name: string
  credentials: string
  role: string
  is_public: boolean
  specialty: string
  linkedin_url: string
  bio: string
  education: EducationEntry[]
  registrations: RegistrationEntry[]
  license_info: string
  same_as: string[]
  avatar_url: string
}

const EMPTY_EDUCATION: EducationEntry = {
  institution: '',
  degree: '',
}

const EMPTY_REGISTRATION: RegistrationEntry = {
  title: '',
  board: '',
  url: '',
}

const EMPTY_FORM: ReviewerForm = {
  name: '',
  credentials: '',
  role: 'medical_reviewer',
  is_public: false,
  specialty: '',
  linkedin_url: '',
  bio: '',
  education: [],
  registrations: [],
  license_info: '',
  same_as: [],
  avatar_url: '',
}

const labelClass = 'block text-sm font-medium text-gray-700 mb-1.5'
const inputClass = 'w-full bg-white border border-gray-300 rounded-md px-3 py-2 text-gray-900 placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500'
const textareaClass = `${inputClass} resize-vertical`
const sectionCardClass = 'rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-4'

const Linkedin = createLucideIcon('Linkedin', [
  ['circle', { cx: '4', cy: '4', r: '2', key: 'linkedin-dot' }],
  ['path', { d: 'M2 9h4v12H2z', key: 'linkedin-bar' }],
  ['path', { d: 'M10 9h4v1.8h.1c.6-1 1.9-2.1 4-2.1 4.2 0 4.9 2.7 4.9 6.2V21h-4v-5.6c0-1.3 0-3-2.1-3-2.2 0-2.5 1.7-2.5 3.4V21h-4z', key: 'linkedin-body' }],
])

function authHeader(token: string): Record<string, string> {
  return { Authorization: 'Bearer ' + token }
}

function normalizeEducation(value: unknown): EducationEntry[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => ({
    institution: typeof item?.institution === 'string' ? item.institution : '',
    degree: typeof item?.degree === 'string' ? item.degree : '',
  }))
}

function normalizeRegistrations(value: unknown): RegistrationEntry[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => ({
    title: typeof item?.title === 'string' ? item.title : '',
    board: typeof item?.board === 'string' ? item.board : '',
    url: typeof item?.url === 'string' ? item.url : '',
  }))
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
          headers: authHeader(token),
        })
        if (!res.ok) throw new Error('Reviewer not found')
        const data = await res.json()
        setForm({
          name: data.name ?? '',
          credentials: data.credentials ?? '',
          role: data.role ?? 'medical_reviewer',
          is_public: data.is_public ?? false,
          specialty: data.specialty ?? '',
          linkedin_url: data.linkedin_url ?? '',
          bio: data.bio ?? '',
          education: normalizeEducation(data.education),
          registrations: normalizeRegistrations(data.registrations),
          license_info: data.license_info ?? '',
          same_as: Array.isArray(data.same_as) ? data.same_as : [],
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

  function addEducation() {
    setField('education', [...form.education, { ...EMPTY_EDUCATION }])
  }

  function updateEducation(index: number, key: keyof EducationEntry, value: string) {
    setField(
      'education',
      form.education.map((entry, i) => (
        i === index ? { ...entry, [key]: value } : entry
      )),
    )
  }

  function removeEducation(index: number) {
    setField('education', form.education.filter((_, i) => i !== index))
  }

  function addRegistration() {
    setField('registrations', [...form.registrations, { ...EMPTY_REGISTRATION }])
  }

  function updateRegistration(index: number, key: keyof RegistrationEntry, value: string) {
    setField(
      'registrations',
      form.registrations.map((entry, i) => (
        i === index ? { ...entry, [key]: value } : entry
      )),
    )
  }

  function removeRegistration(index: number) {
    setField('registrations', form.registrations.filter((_, i) => i !== index))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!form.name.trim()) { setError('Name is required'); return }
    if (!form.credentials.trim()) { setError('Credentials are required'); return }

    const education = form.education
      .map((entry) => ({
        institution: entry.institution.trim(),
        degree: entry.degree.trim(),
      }))
      .filter((entry) => entry.institution || entry.degree)

    const registrations = form.registrations
      .map((entry) => ({
        title: entry.title.trim(),
        board: entry.board.trim(),
        url: entry.url.trim(),
      }))
      .filter((entry) => entry.title || entry.board || entry.url)

    setSaving(true)
    try {
      const token = await getToken()
      const body = {
        name: form.name.trim(),
        credentials: form.credentials.trim(),
        role: form.role,
        is_public: form.is_public,
        specialty: form.specialty.trim() || null,
        linkedin_url: form.linkedin_url.trim() || null,
        bio: form.bio.trim() || null,
        education,
        registrations,
        license_info: form.license_info.trim() || null,
        same_as: form.same_as.map((url) => url.trim()).filter(Boolean),
      }

      let res: Response
      if (isNew) {
        res = await fetch('/api/admin/reviewers', {
          method: 'POST',
          headers: { ...authHeader(token), 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      } else {
        res = await fetch(`/api/admin/reviewers/${reviewerId}`, {
          method: 'PUT',
          headers: { ...authHeader(token), 'Content-Type': 'application/json' },
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
        headers: authHeader(token),
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
    <div className="p-6 max-w-4xl mx-auto">
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

      <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
        <div className="pb-6 mb-6 border-b border-gray-200 flex justify-center">
          {!isNew && reviewerId ? (
            <AvatarUpload
              reviewerId={reviewerId}
              currentUrl={form.avatar_url || null}
              onUpload={(url) => setField('avatar_url', url)}
            />
          ) : (
            <div className="text-center">
              <div className="w-24 h-24 rounded-full bg-gray-100 border border-gray-200 mx-auto mb-3" />
              <p className="text-sm text-gray-600">
                Save the reviewer first, then you can upload a photo.
              </p>
            </div>
          )}
        </div>

        <form onSubmit={handleSave} className="space-y-6">
          <div className="flex items-center justify-between p-4 rounded-lg border border-gray-200 bg-gray-50">
            <div>
              <label className="text-sm font-medium text-gray-700">Show on Public Site</label>
              <p className="text-xs text-gray-500 mt-0.5">
                When enabled, this reviewer appears on the public /editorial-team page
              </p>
            </div>
            <button
              type="button"
              onClick={() => setField('is_public', !form.is_public)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                form.is_public ? 'bg-emerald-600' : 'bg-gray-300'
              }`}
              aria-pressed={form.is_public}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  form.is_public ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div>
            <label className={labelClass}>
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              placeholder="Dr. Jane Smith"
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>
              Credentials <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.credentials}
              onChange={(e) => setField('credentials', e.target.value)}
              placeholder="PharmD, RPh"
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>Role</label>
            <select
              value={form.role}
              onChange={(e) => setField('role', e.target.value)}
              className={inputClass}
            >
              {ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>Specialty</label>
            <input
              type="text"
              value={form.specialty}
              onChange={(e) => setField('specialty', e.target.value)}
              placeholder="Clinical Pharmacy"
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>LinkedIn URL</label>
            <div className="relative">
              <Linkedin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="url"
                value={form.linkedin_url}
                onChange={(e) => setField('linkedin_url', e.target.value)}
                placeholder="https://linkedin.com/in/jane-smith"
                className={`${inputClass} pl-10`}
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>Bio</label>
            <textarea
              value={form.bio}
              onChange={(e) => setField('bio', e.target.value)}
              rows={4}
              placeholder="Licensed pharmacist with 15 years experience…"
              className={textareaClass}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-medium text-gray-700">Education</label>
              <button
                type="button"
                onClick={addEducation}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-gray-100 border border-gray-300 text-gray-700 rounded-md text-sm transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Education
              </button>
            </div>
            <div className="space-y-3">
              {form.education.map((entry, index) => (
                <div key={index} className={sectionCardClass}>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-700">Education #{index + 1}</p>
                    <button
                      type="button"
                      onClick={() => removeEducation(index)}
                      className="text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className={labelClass}>Institution</label>
                      <input
                        type="text"
                        value={entry.institution}
                        onChange={(e) => updateEducation(index, 'institution', e.target.value)}
                        placeholder="University of Otago, Dunedin, New Zealand"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Degree</label>
                      <input
                        type="text"
                        value={entry.degree}
                        onChange={(e) => updateEducation(index, 'degree', e.target.value)}
                        placeholder="Bachelor of Pharmacy"
                        className={inputClass}
                      />
                    </div>
                  </div>
                </div>
              ))}
              {form.education.length === 0 && (
                <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500">
                  No education entries yet.
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-medium text-gray-700">Registrations</label>
              <button
                type="button"
                onClick={addRegistration}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-gray-100 border border-gray-300 text-gray-700 rounded-md text-sm transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Registration
              </button>
            </div>
            <div className="space-y-3">
              {form.registrations.map((entry, index) => (
                <div key={index} className={sectionCardClass}>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-700">Registration #{index + 1}</p>
                    <button
                      type="button"
                      onClick={() => removeRegistration(index)}
                      className="text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className={labelClass}>Title</label>
                      <input
                        type="text"
                        value={entry.title}
                        onChange={(e) => updateRegistration(index, 'title', e.target.value)}
                        placeholder="Registered Pharmacist #6368"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Board</label>
                      <input
                        type="text"
                        value={entry.board}
                        onChange={(e) => updateRegistration(index, 'board', e.target.value)}
                        placeholder="Pharmacy Council of New Zealand"
                        className={inputClass}
                      />
                    </div>
                  </div>
                  <div>
                    <label className={labelClass}>URL</label>
                    <input
                      type="url"
                      value={entry.url}
                      onChange={(e) => updateRegistration(index, 'url', e.target.value)}
                      placeholder="https://pharmacycouncil.org.nz"
                      className={inputClass}
                    />
                  </div>
                </div>
              ))}
              {form.registrations.length === 0 && (
                <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500">
                  No registration entries yet.
                </div>
              )}
            </div>
          </div>

          <div>
            <label className={labelClass}>License Info</label>
            <input
              type="text"
              value={form.license_info}
              onChange={(e) => setField('license_info', e.target.value)}
              placeholder="CA RPH #12345"
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>
              ORCID / Other Profile URLs
            </label>
            <div className="space-y-2">
              {form.same_as.map((url, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="flex-1 text-sm text-gray-700 bg-gray-50 border border-gray-300 rounded-md px-3 py-2 truncate">
                    {url}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeSameAs(i)}
                    className="text-gray-400 hover:text-red-500 transition-colors"
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
                  placeholder="https://orcid.org/0000-0000-0000-0000"
                  className={`flex-1 ${inputClass}`}
                />
                <button
                  type="button"
                  onClick={addSameAs}
                  className="flex items-center gap-1 px-3 py-2 bg-white hover:bg-gray-100 border border-gray-300 text-gray-700 rounded-md text-sm transition-colors"
                >
                  <Plus className="w-4 h-4" /> Add
                </button>
              </div>
            </div>
          </div>

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
                className="px-4 py-2 bg-white hover:bg-red-50 border border-red-200 text-red-600 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
              >
                {deleting ? 'Deactivating…' : 'Deactivate'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
