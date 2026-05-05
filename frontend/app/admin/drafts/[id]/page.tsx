'use client'

export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback, useRef, useId } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '../../lib/supabase'
import { ArrowLeft, Save, Send } from 'lucide-react'
import {
  FIELD_SCHEMA_BY_KEY,
  FIELD_SCHEMA,
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
    keys: ['image_alt_text', 'meta_title', 'meta_description', 'tags', 'brand_names'],
  },
  {
    section: 'Advanced',
    title: 'Advanced',
    keys: ['splsize', 'pharmclass_fda_epc', 'rxcui', 'rxcui_1', 'imprint_status'],
  },
]

type PillForm = Record<string, string>

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

function ComboboxInput({
  value, onChange, suggestions, placeholder, className,
}: {
  value: string
  onChange: (val: string) => void
  suggestions: string[]
  placeholder?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const listId = useId()

  const valueLower = value.toLowerCase()
  const filtered = suggestions.filter(s => value === '' || s.toLowerCase().includes(valueLower))

  useEffect(() => {
    return () => { if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current) }
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHighlighted(filtered.length > 0 ? 0 : -1) }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, -1)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (highlighted >= 0) { onChange(filtered[highlighted]); setOpen(false); setHighlighted(-1) } else { setOpen(false) } }
    else if (e.key === 'Escape') { setOpen(false); setHighlighted(-1) }
  }

  const handleBlur = () => {
    if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current)
    blurTimeoutRef.current = setTimeout(() => { setOpen(false); setHighlighted(-1) }, 150)
  }

  const handleMouseDown = (s: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current)
    onChange(s); setOpen(false); setHighlighted(-1)
  }

  return (
    <div className="relative w-full">
      <input
        type="text"
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); setHighlighted(-1) }}
        onFocus={() => setOpen(true)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && filtered.length > 0}
        aria-controls={listId}
        aria-activedescendant={highlighted >= 0 ? `${listId}-option-${highlighted}` : undefined}
      />
      {open && filtered.length > 0 && (
        <ul id={listId} role="listbox"
          className="absolute z-50 w-full bg-white border border-gray-200 rounded-md shadow-lg mt-1 max-h-56 overflow-y-auto text-sm">
          {filtered.map((s, i) => (
            <li key={s} id={`${listId}-option-${i}`} role="option" aria-selected={i === highlighted}
              className={`px-3 py-2 cursor-pointer hover:bg-indigo-50 ${i === highlighted ? 'bg-indigo-100' : ''}`}
              onMouseDown={handleMouseDown(s)}>
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function FieldInput({
  field, value, onChange, error,
}: {
  field: FieldSchemaEntry; value: string; onChange: (val: string) => void; error?: string
}) {
  const isNAValue = isNA(value)
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
        {field.inputType === 'combobox' ? (
          <ComboboxInput
            value={isNAValue ? 'N/A' : value}
            onChange={onChange}
            suggestions={field.suggestions ?? []}
            placeholder={field.placeholder}
            className={inputClass}
          />
        ) : field.inputType === 'textarea' ? (
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
            }`} title={isNAValue ? 'Clear N/A' : 'Mark as N/A'}>N/A</button>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

export default function EditDraftPage() {
  const params = useParams()
  const draftId = params.id as string
  const router = useRouter()

  const [form, setForm] = useState<PillForm>({})
  const [status, setStatus] = useState<string>('')
  const [pillId, setPillId] = useState<string | null>(null)
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

  useEffect(() => {
    const load = async () => {
      const session = await getSession()
      if (!session) { router.push('/admin/login'); return }
      try {
        const res = await fetch(`/api/admin/drafts/${draftId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!res.ok) throw new Error(await safeErrorDetail(res, 'Failed to load draft'))
        const data = await res.json()
        setStatus(data.status)
        setPillId(data.pill_id)
        // Pre-populate form from draft_data
        const draftData: Record<string, string> = {}
        FIELD_SCHEMA.forEach(({ key }) => {
          const val = data.draft_data?.[key]
          draftData[key] = val != null ? String(val) : ''
        })
        setForm(draftData)
      } catch (e) {
        setError(String(e))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [draftId, getSession, router])

  const handleSave = async () => {
    setSaving(true); setError(''); setSuccess('')
    const session = await getSession()
    if (!session) return
    try {
      const res = await fetch(`/api/admin/drafts/${draftId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft_data: form }),
      })
      if (!res.ok) throw new Error(await safeErrorDetail(res, 'Failed to save draft'))
      setSuccess('Draft saved successfully')
    } catch (e) { setError(String(e)) } finally { setSaving(false) }
  }

  const handleSubmit = async () => {
    setSubmitting(true); setError(''); setSuccess('')
    const session = await getSession()
    if (!session) return
    try {
      // First save any pending changes, then submit
      const saveRes = await fetch(`/api/admin/drafts/${draftId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft_data: form }),
      })
      if (!saveRes.ok) throw new Error(await safeErrorDetail(saveRes, 'Failed to save draft'))

      const submitRes = await fetch(`/api/admin/drafts/${draftId}/submit`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!submitRes.ok) throw new Error(await safeErrorDetail(submitRes, 'Failed to submit draft'))
      setSuccess('Draft submitted for review')
      setStatus('pending_review')
      window.dispatchEvent(new Event('draft-count-changed'))
    } catch (e) { setError(String(e)) } finally { setSubmitting(false) }
  }

  if (loading) return <div className="p-4 text-gray-500">Loading draft…</div>

  const isEditable = status === 'draft'

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link href="/admin/drafts" className="text-gray-500 hover:text-gray-700 flex items-center gap-1 text-sm">
          <ArrowLeft className="w-4 h-4" /> Back to Drafts
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">
          Edit Draft{form.medicine_name ? `: ${form.medicine_name}` : ''}{' '}
          <span className="text-base font-normal text-gray-400">#{draftId.slice(0, 8)}</span>
        </h1>
      </div>

      {pillId && (
        <div className="text-sm text-gray-500">
          Linked pill:{' '}
          <Link href={`/admin/pills/${pillId}`} className="text-indigo-600 hover:underline">
            /admin/pills/{pillId.slice(0, 8)}…
          </Link>
        </div>
      )}

      {!isEditable && (
        <div className="bg-yellow-50 border border-yellow-300 rounded-md px-4 py-3 text-sm text-yellow-800">
          ⚠️ This draft is in <strong>{status}</strong> status and cannot be edited directly.
        </div>
      )}

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-md text-sm border border-red-200">
          <strong>Error:</strong> {error}
        </div>
      )}
      {success && (
        <div className="bg-green-50 text-green-700 px-4 py-3 rounded-md text-sm border border-green-200">
          {success}
        </div>
      )}

      {isEditable && (
        <div className="flex gap-3">
          <button onClick={handleSave} disabled={saving || submitting}
            className="flex items-center gap-2 bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700 disabled:opacity-50 text-sm font-medium transition-colors">
            <Save className="w-4 h-4" />{saving ? 'Saving…' : 'Save Draft'}
          </button>
          <button onClick={handleSubmit} disabled={saving || submitting}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium transition-colors">
            <Send className="w-4 h-4" />{submitting ? 'Submitting…' : 'Save & Submit for Review'}
          </button>
        </div>
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
                <div key={field.key} id={`field-${field.key}`}>
                  <FieldInput
                    field={field}
                    value={form[field.key] ?? ''}
                    onChange={isEditable ? (val) => setForm(prev => ({ ...prev, [field.key]: val })) : () => {}}
                  />
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {isEditable && (
        <div className="flex gap-3 pb-6">
          <button onClick={handleSave} disabled={saving || submitting}
            className="flex items-center gap-2 bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700 disabled:opacity-50 text-sm font-medium transition-colors">
            <Save className="w-4 h-4" />{saving ? 'Saving…' : 'Save Draft'}
          </button>
          <button onClick={handleSubmit} disabled={saving || submitting}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium transition-colors">
            <Send className="w-4 h-4" />{submitting ? 'Submitting…' : 'Save & Submit for Review'}
          </button>
        </div>
      )}
    </div>
  )
}
