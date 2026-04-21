'use client'

export const dynamic = 'force-dynamic'
import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '../../lib/supabase'
import { ArrowLeft, Save, FileEdit, Upload, Trash2 } from 'lucide-react'

const FIELDS = [
  { key: 'medicine_name', label: 'Drug Name', section: 'Basic Info' },
  { key: 'brand_names', label: 'Brand Names', section: 'Basic Info' },
  { key: 'splimprint', label: 'Imprint', section: 'Basic Info' },
  { key: 'splcolor_text', label: 'Color', section: 'Basic Info' },
  { key: 'splshape_text', label: 'Shape', section: 'Basic Info' },
  { key: 'splsize', label: 'Size', section: 'Basic Info' },
  { key: 'spl_strength', label: 'Strength', section: 'Clinical' },
  { key: 'spl_ingredients', label: 'Active Ingredients', section: 'Clinical' },
  { key: 'spl_inactive_ing', label: 'Inactive Ingredients', section: 'Clinical' },
  { key: 'dosage_form', label: 'Dosage Form', section: 'Clinical' },
  { key: 'route', label: 'Route', section: 'Clinical' },
  { key: 'dea_schedule_name', label: 'DEA Schedule', section: 'Clinical' },
  { key: 'pharmclass_fda_epc', label: 'Pharma Class (FDA EPC)', section: 'Clinical' },
  { key: 'ndc9', label: 'NDC-9', section: 'Identifiers' },
  { key: 'ndc11', label: 'NDC-11', section: 'Identifiers' },
  { key: 'rxcui', label: 'RxCUI', section: 'Identifiers' },
  { key: 'rxcui_1', label: 'RxCUI Alt', section: 'Identifiers' },
  { key: 'status_rx_otc', label: 'Rx/OTC Status', section: 'Identifiers' },
  { key: 'imprint_status', label: 'Imprint Status', section: 'Identifiers' },
  { key: 'slug', label: 'Slug', section: 'SEO' },
  { key: 'meta_description', label: 'Meta Description', section: 'SEO' },
]

const SECTIONS = ['Basic Info', 'Clinical', 'Identifiers', 'SEO']

type PillData = Record<string, string | null>

export default function EditPillPage() {
  const params = useParams()
  const pillId = params.id as string
  const router = useRouter()

  const [pill, setPill] = useState<PillData | null>(null)
  const [form, setForm] = useState<PillData>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [drafts, setDrafts] = useState<Array<{ id: string; status: string; created_at: string }>>([])
  const [uploadingImage, setUploadingImage] = useState(false)

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
        const res = await fetch(`/api/admin/pills/${pillId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!res.ok) throw new Error('Failed to fetch pill')
        const data = await res.json()
        setPill(data)
        setDrafts(data.drafts || [])
        const formData: PillData = {}
        FIELDS.forEach(({ key }) => {
          formData[key] = data[key] ?? ''
        })
        setForm(formData)
      } catch (e) {
        setError(String(e))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [pillId, router])

  const handleSave = async () => {
    setSaving(true)
    setError('')
    setSuccess('')
    const supabase = createClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) return

    // Only send fields that differ from the saved pill and are non-empty
    const changedFields: Record<string, string | null> = {}
    FIELDS.forEach(({ key }) => {
      const formVal = form[key]
      const pillVal = pill?.[key] ?? null
      // Treat empty string as "no change" to avoid blanking out existing data
      if (formVal !== '' && formVal !== pillVal) {
        changedFields[key] = formVal ?? null
      }
    })

    if (Object.keys(changedFields).length === 0) {
      setSuccess('No changes to save')
      setSaving(false)
      return
    }

    try {
      const res = await fetch(`/api/admin/pills/${pillId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...changedFields, updated_at: pill?.updated_at }),
      })
      if (res.status === 409) {
        const err = await res.json()
        setError(err.detail)
        return
      }
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Save failed')
      }
      setSuccess('Saved successfully')
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleSaveDraft = async () => {
    setSaving(true)
    setError('')
    const supabase = createClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) return

    try {
      const res = await fetch(`/api/admin/pills/${pillId}/drafts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ draft_data: form, status: 'draft' }),
      })
      if (!res.ok) throw new Error('Draft creation failed')
      const data = await res.json()
      setSuccess(`Draft created: ${data.id.slice(0, 8)}`)
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingImage(true)
    setError('')

    const supabase = createClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) return

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch(`/api/admin/pills/${pillId}/images`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData,
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Upload failed')
      }
      setSuccess('Image uploaded successfully')
    } catch (e) {
      setError(String(e))
    } finally {
      setUploadingImage(false)
    }
  }

  if (loading) {
    return <div className="p-4 text-gray-500">Loading pill…</div>
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/pills"
          className="text-gray-500 hover:text-gray-700 flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">
          Edit: {pill?.medicine_name || pillId}
        </h1>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-2 rounded-md text-sm">{error}</div>
      )}
      {success && (
        <div className="bg-green-50 text-green-700 px-4 py-2 rounded-md text-sm">{success}</div>
      )}

      <div className="flex gap-3 flex-wrap">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium transition-colors"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
        <button
          onClick={handleSaveDraft}
          disabled={saving}
          className="flex items-center gap-2 bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700 disabled:opacity-50 text-sm font-medium transition-colors"
        >
          <FileEdit className="w-4 h-4" />
          Save as Draft
        </button>
        <label className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 text-sm font-medium cursor-pointer transition-colors">
          <Upload className="w-4 h-4" />
          {uploadingImage ? 'Uploading…' : 'Upload Image'}
          <input
            type="file"
            accept=".jpg,.jpeg,.png,.webp"
            className="hidden"
            onChange={handleImageUpload}
            disabled={uploadingImage}
          />
        </label>
      </div>

      {SECTIONS.map((section) => {
        const sectionFields = FIELDS.filter((f) => f.section === section)
        return (
          <div key={section} className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 rounded-t-lg">
              <h2 className="font-semibold text-gray-900">{section}</h2>
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              {sectionFields.map(({ key, label }) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                  <input
                    type="text"
                    value={form[key] || ''}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {drafts.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 rounded-t-lg">
            <h2 className="font-semibold text-gray-900">Pending Drafts</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {drafts.map((draft) => (
              <div key={draft.id} className="px-4 py-3 flex items-center justify-between text-sm">
                <span className="text-gray-600">#{draft.id.slice(0, 8)}</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    draft.status === 'pending_review'
                      ? 'bg-yellow-100 text-yellow-700'
                      : draft.status === 'approved'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {draft.status}
                </span>
                <span className="text-gray-400 text-xs">
                  {new Date(draft.created_at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
