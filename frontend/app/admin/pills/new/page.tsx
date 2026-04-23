'use client'

export const dynamic = 'force-dynamic'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '../../lib/supabase'
import { ArrowLeft, Save } from 'lucide-react'
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

type PillForm = Record<string, string>
interface ValidationError { field: string; message: string }

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
        {field.tier === 'required_or_na' && !isNAValue && <span className="text-yellow-600 text-xs" title="Required or N/A">{'\u2020'}</span>}
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
            }`} title={isNAValue ? 'Clear N/A' : 'Mark as N/A'}>N/A</button>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

export default function NewPillPage() {
  const router = useRouter()
  const [form, setForm] = useState<PillForm>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const handleCreate = async (publish = false) => {
    setSaving(true); setError(''); setFieldErrors({})
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/admin/login'); return }

    try {
      const payload = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim() !== ''))
      const url = publish ? '/api/admin/pills?publish=true' : '/api/admin/pills'
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.status === 422) {
        const err = await res.json()
        const detail = err.detail
        if (detail && detail.errors) {
          const errMap: Record<string, string> = {}
          for (const e of detail.errors) errMap[e.field] = e.message
          setFieldErrors(errMap)
          setError(`Validation failed: ${detail.errors.map((e: ValidationError) => e.message).join(', ')}`)
          const firstKey = detail.errors[0]?.field
          if (firstKey) document.getElementById(`field-${firstKey}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
        return
      }
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Failed to create pill')
      }
      const data = await res.json()
      router.push(`/admin/pills/${data.id}`)
    } catch (e) { setError(String(e)) } finally { setSaving(false) }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link href="/admin/pills" className="text-gray-500 hover:text-gray-700 flex items-center gap-1 text-sm">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Add New Pill</h1>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-md text-sm border border-red-200">
          <strong>Error:</strong> {error}
          {Object.keys(fieldErrors).length > 0 && (
            <ul className="mt-2 list-disc list-inside space-y-1">
              {Object.entries(fieldErrors).map(([key, msg]) => (
                <li key={key}>{FIELD_SCHEMA_BY_KEY[key]?.label ?? key}: {msg}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={() => handleCreate(false)} disabled={saving}
          className="flex items-center gap-2 bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700 disabled:opacity-50 text-sm font-medium transition-colors">
          <Save className="w-4 h-4" />{saving ? 'Saving\u2026' : 'Save draft'}
        </button>
        <button onClick={() => handleCreate(true)} disabled={saving}
          className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:opacity-50 text-sm font-medium transition-colors">
          <Save className="w-4 h-4" />{saving ? 'Creating\u2026' : 'Create & publish'}
        </button>
      </div>

      {SECTION_GROUPS.map(({ section, title, keys }) => {
        const sectionFields = keys.map(k => FIELD_SCHEMA_BY_KEY[k]).filter(Boolean) as FieldSchemaEntry[]
        return (
          <div key={section} className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 rounded-t-lg">
              <h2 className="font-semibold text-gray-900">{title}</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                <span className="text-red-500 font-bold">*</span> required &nbsp;
                <span className="text-yellow-600">{'\u2020'}</span> required or N/A
              </p>
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              {sectionFields.map((field) => (
                <div key={field.key} id={`field-${field.key}`}
                  className={fieldErrors[field.key] ? 'ring-2 ring-red-400 rounded-md p-1' : ''}>
                  <FieldInput field={field} value={form[field.key] ?? ''} onChange={(val) => setForm({ ...form, [field.key]: val })}
                    error={fieldErrors[field.key]} />
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
