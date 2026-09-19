'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Users, Shield, Camera, Sparkles } from 'lucide-react'
import { createClient } from '../lib/supabase'

export default function AdminSettingsPage() {
  const router = useRouter()
  type ReaderMode = 'original' | 'fast' | 'accurate'
  type AiMode = 'off' | 'fallback' | 'always'
  type Flags = {
    photo_id_enabled?: unknown
    photo_id_reader_mode?: unknown
    reader_trust_base?: unknown
    ai_reader_mode?: unknown
    ai_reader_model?: unknown
    ai_reader_daily_cap?: unknown
    ai_reader_key_present?: unknown
    ai_reader_models?: unknown
  }
  const [photoId, setPhotoId] = useState<boolean | null>(null)
  const [readerMode, setReaderMode] = useState<ReaderMode | null>(null)
  const [trustBase, setTrustBase] = useState<boolean | null>(null)
  // Second reader (services/ai_reader.py): null until the admin flags have loaded.
  const [aiMode, setAiMode] = useState<AiMode | null>(null)
  const [aiModel, setAiModel] = useState('')
  const [aiModels, setAiModels] = useState<string[]>([])
  const [aiCap, setAiCap] = useState('')
  const [aiKeyPresent, setAiKeyPresent] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [flagError, setFlagError] = useState<string | null>(null)

  const applyFlags = (f: Flags) => {
    setPhotoId(Boolean(f.photo_id_enabled))
    setReaderMode(f.photo_id_reader_mode === 'fast' || f.photo_id_reader_mode === 'original' ? f.photo_id_reader_mode : 'accurate')
    if (typeof f.reader_trust_base === 'boolean') setTrustBase(f.reader_trust_base)
    if (typeof f.ai_reader_mode === 'string') {
      setAiMode(f.ai_reader_mode === 'fallback' || f.ai_reader_mode === 'always' ? f.ai_reader_mode : 'off')
      setAiModel(typeof f.ai_reader_model === 'string' ? f.ai_reader_model : '')
      setAiModels(Array.isArray(f.ai_reader_models) ? f.ai_reader_models.filter((m): m is string => typeof m === 'string') : [])
      setAiCap(typeof f.ai_reader_daily_cap === 'number' ? String(f.ai_reader_daily_cap) : '')
      setAiKeyPresent(Boolean(f.ai_reader_key_present))
    }
  }

  const loadFlags = async () => {
    try {
      // The admin view carries the second-reader settings; the public one is the fallback.
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const admin = await fetch('/api/admin/features', { headers: { Authorization: `Bearer ${session?.access_token ?? ''}` } })
      if (admin.ok) return applyFlags(await admin.json())
      const res = await fetch('/api/features')
      if (res.ok) applyFlags(await res.json())
    } catch {
      setPhotoId(false)
      setReaderMode('accurate')
    }
  }

  const saveFlags = async (patch: {
    photo_id_enabled?: boolean
    photo_id_reader_mode?: ReaderMode
    reader_trust_base?: boolean
    ai_reader_mode?: AiMode
    ai_reader_model?: string
    ai_reader_daily_cap?: number
  }) => {
    setSaving(true)
    setFlagError(null)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/admin/features', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.detail || `Failed (${res.status})`)
      }
      applyFlags(await res.json())
    } catch (e) {
      setFlagError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const togglePhotoId = () => {
    if (photoId !== null) void saveFlags({ photo_id_enabled: !photoId })
  }

  const saveAiCap = () => {
    const n = Number(aiCap)
    if (aiCap.trim() === '' || !Number.isInteger(n) || n < 0 || n > 100000) {
      setFlagError('Daily cap must be a whole number from 0 to 100000')
      return
    }
    void saveFlags({ ai_reader_daily_cap: n })
  }

  useEffect(() => {
    const check = async () => {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push('/admin/login')
        return
      }
      const res = await fetch('/api/admin/me', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) {
        router.push('/admin/login')
        return
      }
      const data = await res.json()
      if (data.role !== 'superuser' && data.role !== 'superadmin') {
        router.push('/admin')
      }
    }
    check()
    loadFlags()
  }, [router])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
      <p className="text-gray-500 text-sm">Manage your PillSeek admin configuration.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Link
          href="/admin/settings/users"
          className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow group"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="bg-indigo-100 p-2 rounded-lg group-hover:bg-indigo-200 transition-colors">
              <Users className="w-5 h-5 text-indigo-600" />
            </div>
            <h2 className="font-semibold text-gray-900">User Management</h2>
          </div>
          <p className="text-sm text-gray-500">
            Create, edit, and manage admin users. Assign roles and reset passwords.
          </p>
        </Link>

        <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="bg-emerald-100 p-2 rounded-lg">
              <Camera className="w-5 h-5 text-emerald-700" />
            </div>
            <h2 className="font-semibold text-gray-900">Photo ID (beta)</h2>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Camera pill identification. When off, the menu link is hidden and /identify shows &quot;coming soon&quot;.
          </p>
          <button
            onClick={togglePhotoId}
            disabled={saving || photoId === null}
            className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
              photoId ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-gray-500 hover:bg-gray-600'
            }`}
          >
            {photoId === null ? 'Loading…' : saving ? 'Saving…' : photoId ? 'ON — click to turn off' : 'OFF — click to turn on'}
          </button>

          <div className="mt-5 border-t border-gray-100 pt-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-1">Imprint reader</h3>
            <p className="text-xs text-gray-500 mb-3">
              Original: large model reads the full photo once per side, base only if large is silent (day-one behaviour).
              Fast: base with crops + voting (~1.5 s). Accurate: base crops + voting, large overrides when sure (~3 s).
            </p>
            <fieldset className="flex gap-6" disabled={saving || readerMode === null}>
              <legend className="sr-only">Imprint reader mode</legend>
              {(['original', 'fast', 'accurate'] as const).map((m) => (
                <label key={m} className="inline-flex items-center gap-2 text-sm text-gray-800 cursor-pointer disabled:opacity-50">
                  <input
                    type="radio"
                    name="reader-mode"
                    value={m}
                    checked={readerMode === m}
                    onChange={() => void saveFlags({ photo_id_reader_mode: m })}
                    className="h-4 w-4 text-emerald-600 focus:ring-emerald-500"
                  />
                  {m === 'original' ? 'Original' : m === 'fast' ? 'Fast' : 'Accurate'}
                </label>
              ))}
            </fieldset>

            {trustBase !== null && (
              <label className="mt-4 flex items-start gap-2 text-sm text-gray-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={trustBase}
                  disabled={saving}
                  onChange={() => void saveFlags({ reader_trust_base: !trustBase })}
                  className="mt-0.5 h-4 w-4 rounded text-emerald-600 focus:ring-emerald-500"
                />
                <span>
                  <span className="font-medium">Let the small model answer when the large one is silent</span>
                  <span className="block text-xs text-gray-500">
                    Off (recommended): the large model stays silent rather than guess, and the small one has been caught
                    inventing imprints it memorised in training, which can show a confident wrong pill. With this off,
                    those reads are still recorded but the second reader settles them.
                  </span>
                </span>
              </label>
            )}
          </div>
          {flagError && <p className="mt-2 text-sm text-red-600">{flagError}</p>}
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="bg-indigo-100 p-2 rounded-lg">
              <Sparkles className="w-5 h-5 text-indigo-700" />
            </div>
            <h2 className="font-semibold text-gray-900">Second reader (Google Gemini)</h2>
          </div>
          <p className="text-sm text-gray-500 mb-3">
            Our own reader always goes first. The second reader only reads the imprint text; its answer is shown
            only when that imprint exists in our database, and it can never name a pill. Results and cost:
            Photo Captures page.
          </p>
          {aiMode === null ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : (
            <>
              <p className={`text-xs mb-3 ${aiKeyPresent ? 'text-emerald-700' : 'text-amber-700'}`}>
                {aiKeyPresent
                  ? 'Key found on the server.'
                  : 'No GEMINI_API_KEY on the server (Render → Environment): stays off whatever is chosen here.'}
              </p>
              <fieldset className="space-y-2" disabled={saving}>
                <legend className="sr-only">Second reader mode</legend>
                {([
                  ['off', 'Off', 'Never called.'],
                  ['fallback', 'Fallback', 'Only when our reader finds no exact match. Normal setting.'],
                  ['always', 'Always', 'Every read, side by side with ours, to measure both. Costs the most; ours still wins when it is exact.'],
                ] as const).map(([value, label, hint]) => (
                  <label key={value} className="flex items-start gap-2 text-sm text-gray-800 cursor-pointer">
                    <input
                      type="radio"
                      name="ai-reader-mode"
                      value={value}
                      checked={aiMode === value}
                      onChange={() => void saveFlags({ ai_reader_mode: value })}
                      className="mt-0.5 h-4 w-4 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>
                      <span className="font-medium">{label}</span>
                      <span className="block text-xs text-gray-500">{hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <div className="mt-4 flex flex-wrap items-end gap-4">
                <label className="text-sm text-gray-700">
                  <span className="block text-xs font-medium text-gray-500 mb-1">Model</span>
                  <select
                    value={aiModel}
                    disabled={saving}
                    onChange={(e) => void saveFlags({ ai_reader_model: e.target.value })}
                    className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  >
                    {aiModels.map((m) => (
                      <option key={m} value={m}>
                        {m.includes('flash') ? `${m} (fast, cheapest: well under 1¢ a read)` : `${m} (slower, a few times the cost)`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-gray-700">
                  <span className="block text-xs font-medium text-gray-500 mb-1">Daily cap (calls per 24 h)</span>
                  <span className="flex gap-2">
                    <input
                      type="number"
                      min={0}
                      max={100000}
                      value={aiCap}
                      disabled={saving}
                      onChange={(e) => setAiCap(e.target.value)}
                      className="w-28 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    />
                    <button
                      type="button"
                      onClick={saveAiCap}
                      disabled={saving}
                      className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                    >
                      Save
                    </button>
                  </span>
                </label>
              </div>
              <p className="mt-2 text-xs text-gray-500">When the cap is reached the second reader stops until calls age out; our reader keeps working.</p>
            </>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm opacity-60 cursor-not-allowed">
          <div className="flex items-center gap-3 mb-3">
            <div className="bg-gray-100 p-2 rounded-lg">
              <Shield className="w-5 h-5 text-gray-400" />
            </div>
            <h2 className="font-semibold text-gray-500">Security</h2>
          </div>
          <p className="text-sm text-gray-400">Coming soon — 2FA and session management.</p>
        </div>
      </div>
    </div>
  )
}
