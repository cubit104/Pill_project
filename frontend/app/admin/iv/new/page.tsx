'use client'

export const dynamic = 'force-dynamic'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Plus, RefreshCw } from 'lucide-react'
import { adminApi } from '../../lib/api'

const SETID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Accepts a bare Set ID or a pasted DailyMed link (…drugInfo.cfm?setid=<id>). */
function readSetId(input: string): string {
  const match = input.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  return match ? match[0].toLowerCase() : input.trim()
}

export default function AdminAddIvDrugPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [setid, setSetid] = useState('')
  const [brands, setBrands] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const cleanSetid = readSetId(setid)
  const ready = name.trim().length >= 2 && SETID.test(cleanSetid)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const drug = (await adminApi.addIvDrug({
        name: name.trim(),
        spl_set_id: cleanSetid,
        brand_names: brands.split(',').map((b) => b.trim()).filter(Boolean),
      })) as { id: string }
      router.push(`/admin/iv/${drug.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the drug')
      setBusy(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-5">
      <Link href="/admin/iv" className="inline-flex items-center gap-1 text-sm text-sky-700 hover:underline">
        <ArrowLeft className="h-4 w-4" /> IV drugs
      </Link>
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Add an IV drug</h1>
        <p className="text-sm text-slate-600 mt-1">
          For a drug the FDA list missed. Most IV drugs are already here: search the list first. The drug starts hidden, with this label
          locked to it. Adding a tablet or capsule instead?{' '}
          <Link href="/admin/pills/new" className="text-sky-700 hover:underline">Add a pill</Link>.
        </p>
      </div>

      <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-slate-800">Drug name (generic)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="e.g. Daptomycin" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-800">DailyMed Set ID of the injection label</span>
          <input value={setid} onChange={(e) => setSetid(e.target.value)} placeholder="Paste the Set ID or the DailyMed link" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm" />
          <span className="mt-1 block text-xs text-slate-500">
            The label is checked before saving: it must have an injection product (intravenous, intramuscular, subcutaneous…). The label of the tablets or capsules is refused, so the
            two forms of a drug cannot get mixed up.
          </span>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-800">Brand names (optional, comma separated)</span>
          <input value={brands} onChange={(e) => setBrands(e.target.value)} placeholder="e.g. Cubicin, Cubicin RF" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </label>

        {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

        <button disabled={!ready || busy} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">
          {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {busy ? 'Checking the label…' : 'Add drug'}
        </button>
      </form>
    </div>
  )
}
