'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'
import { adminApi } from '../../lib/api'

interface LabelStatus {
  spl_set_id: string
  cached: boolean
  pills_using_this_label: number
  fetched_at?: string | null
  professional_chars?: number
  medguide_chars?: number
  dosage_chars?: number
  side_effects_chars?: number
  has_boxed_warning?: boolean
}

function Part({ label, chars }: { label: string; chars?: number }) {
  const has = (chars ?? 0) > 0
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs ${has ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
      {label}: {has ? `${chars!.toLocaleString('en-US')} characters` : 'none'}
    </span>
  )
}

/**
 * The FDA label text behind the Dosage, Side Effects and Professional Information pages of this IV drug.
 * Same tools as Admin → Medication Guide has for pills; these ones only ever touch this IV drug.
 */
export default function LabelTools({ drugId, splSetId, canEdit }: { drugId: string; splSetId: string; canEdit: boolean }) {
  const [status, setStatus] = useState<LabelStatus | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const run = useCallback(async (name: string, action: () => Promise<unknown>) => {
    setBusy(name)
    setError('')
    try {
      setStatus((await action()) as LabelStatus)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setBusy('')
    }
  }, [])

  useEffect(() => {
    void run('load', () => adminApi.getIvLabel(drugId))
  }, [drugId, splSetId, run])

  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Label text saved for the site</h3>
      {status && (
        <div className="flex flex-wrap gap-2">
          <Part label="Professional label" chars={status.professional_chars} />
          <Part label="Dosage" chars={status.dosage_chars} />
          <Part label="Side effects" chars={status.side_effects_chars} />
          <Part label="Medication guide" chars={status.medguide_chars} />
        </div>
      )}
      {status && (
        <p className="mt-2 text-xs text-slate-500">
          {status.cached
            ? `Fetched from DailyMed${status.fetched_at ? ` on ${new Date(status.fetched_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}` : ''}.`
            : 'Not fetched yet: the label pages of this drug are empty until it is.'}
          {status.has_boxed_warning ? ' This label has a boxed warning.' : ''}
        </p>
      )}
      {status && status.pills_using_this_label > 0 && (
        <p className="mt-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          {status.pills_using_this_label} pill{status.pills_using_this_label === 1 ? '' : 's'} on the site use this same FDA label (it covers the oral form and the
          injection). Fetching it again updates their label pages too; clearing it is done from Admin → Medication Guide.
        </p>
      )}
      {error && <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
      {canEdit && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            disabled={Boolean(busy)}
            onClick={() => void run('refetch', () => adminApi.refetchIvLabel(drugId))}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy === 'refetch' ? 'animate-spin' : ''}`} /> {busy === 'refetch' ? 'Fetching…' : 'Fetch label again'}
          </button>
          <button
            disabled={Boolean(busy) || !status?.cached || (status?.pills_using_this_label ?? 0) > 0}
            onClick={() => {
              if (window.confirm('Forget the saved label text? The pages fetch it again when next opened.')) {
                void run('clear', () => adminApi.clearIvLabelCache(drugId))
              }
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear saved label
          </button>
        </div>
      )}
    </div>
  )
}
