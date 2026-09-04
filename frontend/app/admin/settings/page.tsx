'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Users, Shield, Camera } from 'lucide-react'
import { createClient } from '../lib/supabase'

export default function AdminSettingsPage() {
  const router = useRouter()
  const [photoId, setPhotoId] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [flagError, setFlagError] = useState<string | null>(null)

  const loadFlags = async () => {
    try {
      const res = await fetch('/api/features')
      if (res.ok) setPhotoId(Boolean((await res.json()).photo_id_enabled))
    } catch {
      setPhotoId(false)
    }
  }

  const togglePhotoId = async () => {
    if (photoId === null) return
    setSaving(true)
    setFlagError(null)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/admin/features', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ photo_id_enabled: !photoId }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.detail || `Failed (${res.status})`)
      }
      setPhotoId(Boolean((await res.json()).photo_id_enabled))
    } catch (e) {
      setFlagError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
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
