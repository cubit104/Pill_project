'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Users, Shield, Camera } from 'lucide-react'
import { createClient } from '../lib/supabase'

export default function AdminSettingsPage() {
  const router = useRouter()
  type ReaderMode = 'fast' | 'accurate'
  const [photoId, setPhotoId] = useState<boolean | null>(null)
  const [readerMode, setReaderMode] = useState<ReaderMode | null>(null)
  const [saving, setSaving] = useState(false)
  const [flagError, setFlagError] = useState<string | null>(null)

  const applyFlags = (f: { photo_id_enabled?: unknown; photo_id_reader_mode?: unknown }) => {
    setPhotoId(Boolean(f.photo_id_enabled))
    setReaderMode(f.photo_id_reader_mode === 'fast' ? 'fast' : 'accurate')
  }

  const loadFlags = async () => {
    try {
      const res = await fetch('/api/features')
      if (res.ok) applyFlags(await res.json())
    } catch {
      setPhotoId(false)
      setReaderMode('accurate')
    }
  }

  const saveFlags = async (patch: { photo_id_enabled?: boolean; photo_id_reader_mode?: ReaderMode }) => {
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
              Fast: base model only (~1.5 s). Accurate: adds the large model on the best crops (~3 s; reads faint imprints).
            </p>
            <div className="inline-flex rounded-md border border-gray-300 overflow-hidden" role="radiogroup" aria-label="Imprint reader mode">
              {(['fast', 'accurate'] as const).map((m) => (
                <button
                  key={m}
                  role="radio"
                  aria-checked={readerMode === m}
                  disabled={saving || readerMode === null}
                  onClick={() => readerMode !== m && void saveFlags({ photo_id_reader_mode: m })}
                  className={`px-4 py-1.5 text-sm font-medium disabled:opacity-50 ${
                    readerMode === m ? 'bg-emerald-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {m === 'fast' ? 'Fast' : 'Accurate'}
                </button>
              ))}
            </div>
          </div>
          {flagError && <p className="mt-2 text-sm text-red-600">{flagError}</p>}
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
