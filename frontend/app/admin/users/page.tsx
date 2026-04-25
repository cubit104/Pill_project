'use client'

export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../lib/supabase'
import { UserPlus, UserX } from 'lucide-react'

interface AdminUser {
  id: string
  email: string
  role: string
  full_name: string | null
  is_active: boolean
  created_at: string
  last_login_at: string | null
}

const ROLES = ['superuser', 'editor', 'reviewer']

const ROLE_COLORS: Record<string, string> = {
  superuser: 'bg-red-100 text-red-700',
  superadmin: 'bg-red-100 text-red-700', // legacy alias, normalised to superuser by backend
  editor: 'bg-blue-100 text-blue-700',
  reviewer: 'bg-purple-100 text-purple-700',
}

export default function AdminUsersPage() {
  const router = useRouter()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [me, setMe] = useState<{ role: string } | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('editor')
  const [inviting, setInviting] = useState(false)
  const [success, setSuccess] = useState('')

  const fetchData = useCallback(async () => {
    const supabase = createClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) {
      router.push('/admin/login')
      return
    }

    setLoading(true)
    try {
      const [meRes, usersRes] = await Promise.all([
        fetch('/api/admin/me', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
        fetch('/api/admin/users', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
      ])
      if (meRes.ok) setMe(await meRes.json())
      if (usersRes.ok) setUsers(await usersRes.json())
      else if (usersRes.status === 403) setError('Requires superuser role')
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setInviting(true)
    setError('')
    setSuccess('')

    const supabase = createClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) return

    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Failed to invite user')
      }
      setSuccess(`Invited ${inviteEmail} as ${inviteRole}`)
      setInviteEmail('')
      fetchData()
    } catch (e) {
      setError(String(e))
    } finally {
      setInviting(false)
    }
  }

  const handleDeactivate = async (userId: string) => {
    if (!confirm('Deactivate this admin user?')) return
    const supabase = createClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) return

    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (res.ok) fetchData()
      else setError('Deactivation failed')
    } catch (e) {
      setError(String(e))
    }
  }

  const isSuperAdmin = me?.role === 'superuser' || me?.role === 'superadmin'

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Admin Users</h1>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-2 rounded-md text-sm">{error}</div>
      )}
      {success && (
        <div className="bg-green-50 text-green-700 px-4 py-2 rounded-md text-sm">{success}</div>
      )}

      {isSuperAdmin && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <UserPlus className="w-4 h-4" /> Invite Admin User
          </h2>
          <form onSubmit={handleInvite} className="flex gap-2 flex-wrap">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="email@example.com"
              required
              className="flex-1 min-w-48 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={inviting}
              className="bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {inviting ? 'Inviting…' : 'Invite'}
            </button>
          </form>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Email</th>
              <th className="px-4 py-3 text-left">Role</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Last Login</th>
              {isSuperAdmin && <th className="px-4 py-3 text-left">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            )}
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{user.email}</div>
                  {user.full_name && (
                    <div className="text-xs text-gray-400">{user.full_name}</div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[user.role] || 'bg-gray-100 text-gray-600'}`}
                  >
                    {user.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {user.is_active ? (
                    <span className="text-green-600 text-xs">Active</span>
                  ) : (
                    <span className="text-gray-400 text-xs">Inactive</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">
                  {user.last_login_at ? new Date(user.last_login_at).toLocaleDateString() : 'Never'}
                </td>
                {isSuperAdmin && (
                  <td className="px-4 py-3">
                    {user.is_active && (
                      <button
                        onClick={() => handleDeactivate(user.id)}
                        className="flex items-center gap-1 text-xs text-red-600 hover:text-red-800"
                      >
                        <UserX className="w-3 h-3" /> Deactivate
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
