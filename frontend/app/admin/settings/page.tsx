'use client'

export const dynamic = 'force-dynamic'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Users, Shield } from 'lucide-react'
import { createClient } from '../lib/supabase'

export default function AdminSettingsPage() {
  const router = useRouter()

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
