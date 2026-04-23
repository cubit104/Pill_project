'use client'

export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '../../lib/supabase'
import { ArrowLeft, Save, FileEdit, Upload, Trash2, Star, X, RotateCcw } from 'lucide-react'
import {
  FIELD_SCHEMA,
  FIELD_SCHEMA_BY_KEY,
  isNA,
  type FieldSchemaEntry,
} from '../../lib/fieldSchema'

const SECTION_GROUPS: { section: string; title: string; keys: string[] }[] = [
  {
    section: 'Identification',
    title: 'Identification',
    keys: ['medicine_name', 'author', 'spl_strength', 'splimprint', 'splcolor_text', 'splshape_text', 'slug'],
  },
  {
    section: 'Clinical',
    title: 'Clinical',
    keys: ['dosage_form', 'route', 'spl_ingredients', 'spl_inactive_ing', 'dea_schedule_name', 'status_rx_otc', 'ndc9', 'ndc11'],
  },
  {
    section: 'MediaSEO',
    title: 'Media & SEO',
    keys: ['image_alt_text', 'meta_description', 'tags', 'brand_names'],
  },
  {
    section: 'Advanced',
    title: 'Advanced',
    keys: ['splsize', 'pharmclass_fda_epc', 'rxcui', 'rxcui_1', 'imprint_status'],
  },
]

type PillData = Record<string, string | null>
interface ValidationError { field: string; message: string }
interface CompletenessData {
  score: number
  missing_required: string[]
  needs_na_confirmation: string[]
  optional_empty: string[]
}

function CompletenessBar({ completeness }: { completeness: CompletenessData | null }) {
  if (!completeness) return null
  const { score, missing_required, needs_na_confirmation } = completeness
  const color = missing_required.length > 0 ? 'bg-red-500' : score === 100 ? 'bg-green-500' : 'bg-yellow-500'
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-gray-700">Completeness</span>
        <span className="font-bold text-gray-900">{score}%</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${score}%` }} />
      </div>
      <div className="flex gap-4 text-xs text-gray-500 flex-wrap">
        {missing_required.length > 0 && (
          <span className="text-red-600 font-medium">
            {missing_required.length} required field{missing_required.length > 1 ? 's' : ''} missing
          </span>
        )}
        {needs_na_confirmation.length > 0 && (
          <span className="text-yellow-600 font-medium">
            {needs_na_confirmation.length} field{needs_na_confirmation.length > 1 ? 's' : ''} need N/A confirmation
          </span>
        )}
        {missing_required.length === 0 && needs_na_confirmation.length === 0 && (
          <span className="text-green-600 font-medium">All required fields complete</span>
        )}
      </div>
    </div>
  )
}

/** Pre-flight warning banner: shown when Tier-1 required fields are empty. */
function PreflightBanner({
  completeness,
}: {
  completeness: CompletenessData | null
}) {
  if (!completeness || completeness.missing_required.length === 0) return null
  return (
    <div className="bg-yellow-50 border border-yellow-300 rounded-md px-4 py-3 text-sm text-yellow-800">
      <strong>⚠ Required fields missing — cannot publish yet:</strong>
      <ul className="mt-1 list-disc list-inside space-y-0.5">
        {completeness.missing_required.map((key) => {
          const label = FIELD_SCHEMA_BY_KEY[key]?.label ?? key
          return (
            <li key={key}>
              {label}{' '}
              <button
                type="button"
                className="text-yellow-700 underline hover:text-yellow-900 font-medium"
                onClick={() => {
                  const el = document.getElementById(`field-${key}`)
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    const input = el.querySelector<HTMLInputElement | HTMLTextAreaElement>('input,textarea')
                    input?.focus()
                  }
                }}
              >
                Jump to field
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ImageGallery({
  imageFilename,
  resolvedImageUrls,
  pillId,
  token,
  onRefresh,
}: {
  imageFilename: string | null
  resolvedImageUrls: string[]
  pillId: string
  token: string
  onRefresh: () => void
}) {
  const [deleting, setDeleting] = useState<string | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [imgError, setImgError] = useState('')
  const [settingPrimary, setSettingPrimary] = useState<string | null>(null)

  const filenames = (imageFilename || '').split(',').map(s => s.trim()).filter(Boolean)

  const handleDelete = async (fn: string) => {
    if (!confirm(`Delete image "${fn}"? This cannot be undone.`)) return
    setDeleting(fn)
    setImgError('')
    try {
      const res = await fetch(`/api/admin/pills/${pillId}/images/${encodeURIComponent(fn)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Delete failed')
      }
      onRefresh()
    } catch (e) {
      setImgError(String(e))
    } finally {
      setDeleting(null)
    }
  }

  const handleSetPrimary = async (fn: string) => {
    const rest = filenames.filter(f => f !== fn)
    const newOrder = [fn, ...rest].join(', ')
    setSettingPrimary(fn)
    setImgError('')
    try {
      const res = await fetch(`/api/admin/pills/${pillId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_filename: newOrder }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Reorder failed')
      }
      onRefresh()
    } catch (e) {
      setImgError(String(e))
    } finally {
      setSettingPrimary(null)
    }
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingImage(true)
    setImgError('')
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await fetch(`/api/admin/pills/${pillId}/images`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Upload failed')
      }
      onRefresh()
    } catch (e) {
      setImgError(String(e))
    } finally {
      setUploadingImage(false)
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 rounded-t-lg flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">Images</h2>
        <label className="flex items-center gap-2 bg-green-600 text-white px-3 py-1.5 rounded-md hover:bg-green-700 text-xs font-medium cursor-pointer transition-colors">
          <Upload className="w-3 h-3" />
          {uploadingImage ? 'Uploading\u2026' : 'Upload Image'}
          <input type="file" accept=".jpg,.jpeg,.png,.webp" className="hidden" onChange={handleImageUpload} disabled={uploadingImage} />
        </label>
      </div>
      <div className="p-4">
        {imgError && <div className="mb-3 text-red-600 text-xs">{imgError}</div>}
        {filenames.length === 0 ? (
          <p className="text-sm text-gray-400">No images — upload one above.</p>
        ) : (
          <div className="flex flex-wrap gap-4">
            {filenames.map((fn, idx) => {
              // Use resolved URL from backend when available; fall back to the
              // redirect route as a safety net for images not yet in state.
              const imgSrc = resolvedImageUrls[idx] ?? `/api/pill-image/${encodeURIComponent(fn)}`
              return (
                <div key={fn} className="relative border border-gray-200 rounded-lg overflow-hidden w-36">
                  <img
                    src={imgSrc}
                    alt={fn}
                    className="w-36 h-24 object-contain bg-gray-50"
                    onError={(e) => { ;(e.currentTarget as HTMLImageElement).style.display = 'none' }}
                  />
                  <div className="p-1.5 bg-white">
                    <p className="text-xs text-gray-500 truncate" title={fn}>{fn}</p>
                    <div className="flex items-center gap-1 mt-1">
                      {idx === 0 ? (
                        <span className="text-xs text-yellow-600 font-medium flex items-center gap-0.5">
                          <Star className="w-3 h-3" /> Primary
                        </span>
                      ) : (
                        <button onClick={() => handleSetPrimary(fn)} disabled={settingPrimary === fn}
                          className="text-xs text-indigo-600 hover:underline disabled:opacity-50">
                          Set primary
                        </button>
                      )}
                      <button onClick={() => handleDelete(fn)} disabled={deleting === fn}
                        className="ml-auto text-red-600 hover:text-red-800 disabled:opacity-50">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function FieldInput({
  field, value, onChange, error, hasImage,
}: {
  field: FieldSchemaEntry; value: string; onChange: (val: string) => void; error?: string; hasImage: boolean
}) {
  if (field.conditional === 'has_image' && !hasImage) return null
  const isNAValue = isNA(value)
  const isEmpty = !isNAValue && (value === '' || value === null)
  const borderClass = error
    ? 'border-red-400 focus:ring-red-400'
    : isNAValue ? 'border-gray-200 bg-gray-50'
    : 'border-gray-300 focus:ring-indigo-500'
  const inputClass = `w-full px-3 py-1.5 border rounded-md text-sm focus:outline-none focus:ring-2 ${borderClass} ${isNAValue ? 'text-gray-400 italic' : ''}`

  return (
    <div>
      <label className="flex items-center gap-1 text-xs font-medium text-gray-600 mb-1">
        {field.label}
        {field.tier === 'required' && <span className="text-red-500 font-bold" title="Required">*</span>}
        {field.tier === 'required_or_na' && !isNAValue && <span className="text-yellow-600 text-xs" title="Required or N/A">†</span>}
      </label>
      <div className="flex gap-1">
        {field.inputType === 'textarea' ? (
          <textarea value={isNAValue ? 'N/A' : value} onChange={e => onChange(e.target.value)}
            placeholder={field.placeholder} rows={3} className={`${inputClass} resize-y`} />
        ) : (
          <input type="text" value={isNAValue ? 'N/A' : value} onChange={e => onChange(e.target.value)}
            placeholder={field.placeholder} className={inputClass} />
        )}
        {field.tier === 'required_or_na' && (
          <button type="button" onClick={() => onChange(isNAValue ? '' : 'N/A')}
            className={`shrink-0 px-2 py-1 text-xs rounded border transition-colors ${
              isNAValue ? 'bg-gray-100 border-gray-300 text-gray-600 font-bold' : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
            }`} title={isNAValue ? 'Clear N/A' : 'Mark as N/A'}>
            N/A
          </button>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {!error && field.tier === 'required' && isEmpty && (
        <p className="mt-1 text-xs text-red-400">⚠ Required to publish</p>
      )}
    </div>
  )
}

export default function EditPillPage() {
  const params = useParams()
  const pillId = params.id as string
  const router = useRouter()

  const [pill, setPill] = useState<PillData | null>(null)
  const [form, setForm] = useState<PillData>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [errorDismissed, setErrorDismissed] = useState(false)
  const [success, setSuccess] = useState('')
  const [successDismissed, setSuccessDismissed] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [drafts, setDrafts] = useState<Array<{ id: string; status: string; created_at: string }>>([])
  const [completeness, setCompleteness] = useState<CompletenessData | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [resolvedImageUrls, setResolvedImageUrls] = useState<string[]>([])

  const getSession = useCallback(async () => {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    return session
  }, [])

  const loadPill = useCallback(async () => {
    const session = await getSession()
    if (!session) { router.push('/admin/login'); return }
    setToken(session.access_token)
    try {
      const res = await fetch(`/api/admin/pills/${pillId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) throw new Error('Failed to fetch pill')
      const data = await res.json()
      setPill(data)
      const loadedDrafts = data.drafts || []
      setDrafts(loadedDrafts)
      console.log(`[loadPill] pill=${pillId} drafts=${loadedDrafts.length}`, loadedDrafts)
      setResolvedImageUrls(data.resolved_image_urls || [])
      const formData: PillData = {}
      FIELD_SCHEMA.forEach(({ key }) => { formData[key] = data[key] ?? '' })
      formData['has_image'] = data['has_image'] ?? ''
      setForm(formData)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [pillId, router, getSession])

  const fetchCompleteness = useCallback(async () => {
    const session = await getSession()
    if (!session) return
    try {
      const res = await fetch(`/api/admin/pills/${pillId}/completeness`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (res.ok) setCompleteness(await res.json())
    } catch { /* silently fail */ }
  }, [pillId, getSession])

  // Refresh both pill data and completeness after image changes
  const handleImageRefresh = useCallback(async () => {
    await loadPill()
    await fetchCompleteness()
  }, [loadPill, fetchCompleteness])

  useEffect(() => { loadPill() }, [loadPill])
  useEffect(() => { fetchCompleteness() }, [fetchCompleteness])

  const hasImage = (form['has_image'] ?? '').toUpperCase() === 'TRUE'

  /**
   * Return only fields that changed compared to the loaded pill.
   * - If a field was non-empty in `pill` and is now empty in `form`, send `null`
   *   so the backend clears the column.
   * - Absent fields (unchanged) are excluded so the backend's exclude_unset
   *   logic leaves them untouched.
   */
  const getChangedFields = () => {
    const changed: Record<string, string | null> = {}
    FIELD_SCHEMA.forEach(({ key }) => {
      const formVal = form[key] ?? ''
      const pillVal = pill?.[key] ?? ''
      // No change at all — skip
      if (formVal === pillVal) return
      // Field was cleared (now empty but was not before) → send null to clear DB column
      if (formVal === '' || formVal === null) {
        if (pillVal !== '' && pillVal !== null) {
          changed[key] = null
        }
        // If pillVal was also empty, there's nothing to change
        return
      }
      changed[key] = formVal
    })
    return changed
  }

  const handleDiscard = () => {
    if (!pill) return
    const formData: PillData = {}
    FIELD_SCHEMA.forEach(({ key }) => { formData[key] = pill[key] ?? '' })
    formData['has_image'] = pill['has_image'] ?? ''
    setForm(formData)
    setFieldErrors({})
    setError('')
    setErrorDismissed(false)
    setSuccess('Form reset to last saved state.')
    setSuccessDismissed(false)
  }

  const handleSave = async () => {
    setSaving(true); setError(''); setErrorDismissed(false); setSuccess(''); setSuccessDismissed(false); setFieldErrors({})
    const session = await getSession()
    if (!session) return
    const changedFields = getChangedFields()
    if (Object.keys(changedFields).length === 0) {
      setSuccess('No text fields changed. If you just uploaded an image it was saved automatically \u2014 no further action needed.')
      setSuccessDismissed(false)
      setSaving(false)
      return
    }
    try {
      const res = await fetch(`/api/admin/pills/${pillId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...changedFields, updated_at: pill?.updated_at }),
      })
      if (res.status === 409) { setError((await res.json()).detail); return }
      if (!res.ok) throw new Error((await res.json()).detail || 'Save failed')
      setSuccess('Changes saved')
      setSuccessDismissed(false)
      await loadPill(); await fetchCompleteness()
    } catch (e) { setError(String(e)); setErrorDismissed(false) } finally { setSaving(false) }
  }

  const handlePublish = async () => {
    setSaving(true); setError(''); setErrorDismissed(false); setSuccess(''); setSuccessDismissed(false); setFieldErrors({})
    const session = await getSession()
    if (!session) return
    const changedFields = getChangedFields()
    const allFields: Record<string, string | null> = {}
    FIELD_SCHEMA.forEach(f => { allFields[f.key] = form[f.key] ?? '' })
    Object.assign(allFields, changedFields)
    try {
      const res = await fetch(`/api/admin/pills/${pillId}?publish=true`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...allFields, updated_at: pill?.updated_at }),
      })
      if (res.status === 422) {
        const err = await res.json()
        const detail = err.detail
        if (detail && detail.errors) {
          const errMap: Record<string, string> = {}
          for (const e of detail.errors) errMap[e.field] = e.message
          setFieldErrors(errMap)
          setError(`Validation failed: ${detail.errors.map((e: ValidationError) => e.message).join(', ')}`)
          setErrorDismissed(false)
          // Auto-focus the first invalid input (not just scroll)
          const firstKey = detail.errors[0]?.field
          if (firstKey) {
            const container = document.getElementById(`field-${firstKey}`)
            if (container) {
              container.scrollIntoView({ behavior: 'smooth', block: 'center' })
              const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>('input,textarea')
              // Use setTimeout to let the scroll finish before focusing
              setTimeout(() => input?.focus(), 300)
            }
          }
        }
        return
      }
      if (res.status === 409) { setError((await res.json()).detail); setErrorDismissed(false); return }
      if (!res.ok) throw new Error((await res.json()).detail || 'Publish failed')
      setSuccess('Saved & published successfully')
      setSuccessDismissed(false)
      await loadPill(); await fetchCompleteness()
    } catch (e) { setError(String(e)); setErrorDismissed(false) } finally { setSaving(false) }
  }

  const handleSaveDraft = async () => {
    setSaving(true); setError(''); setErrorDismissed(false)
    const session = await getSession()
    if (!session) return
    try {
      const res = await fetch(`/api/admin/pills/${pillId}/drafts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft_data: form, status: 'draft' }),
      })
      if (!res.ok) throw new Error('Draft creation failed')
      const data = await res.json()
      console.log('[handleSaveDraft] draft created:', data)
      setSuccess(`Workflow draft created: #${data.id.slice(0, 8)} — view all drafts at /admin/drafts`)
      setSuccessDismissed(false)
      await loadPill()
      console.log('[handleSaveDraft] loadPill complete, drafts state updated')
    } catch (e) { setError(String(e)); setErrorDismissed(false) } finally { setSaving(false) }
  }

  if (loading) return <div className="p-4 text-gray-500">Loading pill…</div>

  const showError = error && !errorDismissed
  const showSuccess = success && !successDismissed

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link href="/admin/pills" className="text-gray-500 hover:text-gray-700 flex items-center gap-1 text-sm">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Edit: {pill?.medicine_name || pillId}</h1>
      </div>

      <CompletenessBar completeness={completeness} />

      {/* Prominent blue banner — visible whenever pending drafts exist */}
      {drafts.length > 0 && (
        <div className="bg-blue-50 border border-blue-300 rounded-md px-4 py-3 text-sm text-blue-800 flex items-center justify-between gap-2">
          <span>
            📝 This pill has <strong>{drafts.length}</strong> pending workflow draft{drafts.length !== 1 ? 's' : ''}.
          </span>
          <Link href={`/admin/drafts?pill_id=${pillId}`} className="text-blue-700 font-medium underline hover:text-blue-900 whitespace-nowrap">
            View drafts →
          </Link>
        </div>
      )}

      {/* Pre-flight Tier-1 warning banner — visible before the user tries to publish */}
      <PreflightBanner completeness={completeness} />

      {/* Sticky error banner — stays until user dismisses or re-saves */}
      {showError && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-md text-sm border border-red-200">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <strong>Error:</strong> {error}
              {Object.keys(fieldErrors).length > 0 && (
                <ul className="mt-2 list-disc list-inside space-y-1">
                  {Object.entries(fieldErrors).map(([key, msg]) => (
                    <li key={key}>{FIELD_SCHEMA_BY_KEY[key]?.label ?? key}: {msg}</li>
                  ))}
                </ul>
              )}
            </div>
            <button onClick={() => setErrorDismissed(true)} className="shrink-0 text-red-500 hover:text-red-700" aria-label="Dismiss error">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Success banner — stays until dismissed */}
      {showSuccess && (
        <div className="bg-green-50 text-green-700 px-4 py-2 rounded-md text-sm border border-green-200 flex items-center justify-between gap-2">
          <span>{success}</span>
          <button onClick={() => setSuccessDismissed(true)} className="shrink-0 text-green-600 hover:text-green-800" aria-label="Dismiss message">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex gap-3 flex-wrap">
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700 disabled:opacity-50 text-sm font-medium transition-colors">
          <Save className="w-4 h-4" />{saving ? 'Saving…' : 'Save changes'}
        </button>
        <button onClick={handlePublish} disabled={saving}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium transition-colors">
          <Save className="w-4 h-4" />{saving ? 'Saving…' : 'Save & publish'}
        </button>
        <button onClick={handleSaveDraft} disabled={saving}
          className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-50 disabled:opacity-50 text-sm font-medium transition-colors"
          title="Creates a reviewable draft that goes through the approval workflow. Use 'Save changes' to save directly to the live record without creating a draft.">
          <FileEdit className="w-4 h-4" />Save as workflow draft
        </button>
        <button onClick={handleDiscard} disabled={saving}
          className="flex items-center gap-2 bg-white border border-gray-300 text-gray-500 px-4 py-2 rounded-md hover:bg-gray-50 disabled:opacity-50 text-sm font-medium transition-colors"
          title="Discard unsaved changes and reset form to last saved state">
          <RotateCcw className="w-4 h-4" />Discard changes
        </button>
      </div>

      {token && (
        <ImageGallery
          imageFilename={pill?.image_filename ?? null}
          resolvedImageUrls={resolvedImageUrls}
          pillId={pillId}
          token={token}
          onRefresh={handleImageRefresh}
        />
      )}

      {SECTION_GROUPS.map(({ section, title, keys }) => {
        const sectionFields = keys.map(k => FIELD_SCHEMA_BY_KEY[k]).filter(Boolean) as FieldSchemaEntry[]
        return (
          <div key={section} className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 rounded-t-lg">
              <h2 className="font-semibold text-gray-900">{title}</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                <span className="text-red-500 font-bold">*</span> required &nbsp;
                <span className="text-yellow-600">†</span> required or N/A
              </p>
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              {sectionFields.map((field) => (
                <div key={field.key} id={`field-${field.key}`}
                  className={fieldErrors[field.key] ? 'ring-2 ring-red-400 rounded-md p-1' : ''}>
                  <FieldInput field={field} value={form[field.key] ?? ''} onChange={(val) => setForm({ ...form, [field.key]: val })}
                    error={fieldErrors[field.key]} hasImage={hasImage} />
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {drafts.length > 0 && (
        <div className="bg-white rounded-lg shadow border-2 border-blue-200" id="pending-drafts">
          <div className="px-4 py-3 border-b border-blue-200 bg-blue-50 rounded-t-lg flex items-center justify-between">
            <h2 className="font-bold text-blue-900">📝 Pending Drafts ({drafts.length})</h2>
            <Link href={`/admin/drafts?pill_id=${pillId}`} className="text-blue-700 text-sm font-medium underline hover:text-blue-900">
              View all →
            </Link>
          </div>
          <div className="divide-y divide-gray-100">
            {drafts.map((draft) => (
              <div key={draft.id} className="px-4 py-3 flex items-center justify-between text-sm">
                <span className="text-gray-700 font-medium">#{draft.id.slice(0, 8)}</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  draft.status === 'pending_review' ? 'bg-yellow-100 text-yellow-700'
                  : draft.status === 'approved' ? 'bg-green-100 text-green-700'
                  : 'bg-gray-100 text-gray-600'}`}>{draft.status}</span>
                <span className="text-gray-400 text-xs">{new Date(draft.created_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
