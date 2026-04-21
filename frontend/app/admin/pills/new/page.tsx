'use client'

export const dynamic = 'force-dynamic'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '../../lib/supabase'
import { ArrowLeft, Save } from 'lucide-react'

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
  { key: 'status_rx_otc', label: 'Rx/OTC Status', section: 'Identifiers' },
  { key: 'slug', label: 'Slug', section: 'SEO' },
  { key: 'meta_description', label: 'Meta Description', section: 'SEO' },
]

const SECTIONS = ['Basic Info', 'Clinical', 'Identifiers', 'SEO']

type PillForm = Record<string, string>

export default function NewPillPage() {
  const router = useRouter()
  const [form, setForm] = useState<PillForm>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleCreate = async () => {
    setSaving(true)
    setError('')
    const supabase = createClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) {
      router.push('/admin/login')
      return
    }

    try {
      const payload = Object.fromEntries(
        Object.entries(form).filter(([, v]) => v.trim() !== '')
      )
      const res = await fetch('/api/admin/pills', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Failed to create pill')
      }
      const data = await res.json()
      router.push(`/admin/pills/${data.id}`)
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
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
        <h1 className="text-2xl font-bold text-gray-900">Add New Pill</h1>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-2 rounded-md text-sm">{error}</div>
      )}

      <div className="flex gap-3">
        <button
          onClick={handleCreate}
          disabled={saving}
          className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:opacity-50 text-sm font-medium transition-colors"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Creating…' : 'Create Pill'}
        </button>
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
    </div>
  )
}
