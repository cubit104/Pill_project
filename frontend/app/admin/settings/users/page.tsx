'use client'

export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../lib/supabase'
import { UserPlus, Pencil, Trash2, KeyRound, X, RefreshCw } from 'lucide-react'

interface AdminUser {
  id: string
  email: string
  full_name: string | null
  role: string
  created_at: string | null
  last_sign_in_at: string | null
  disabled: boolean
  email_confirmed: boolean
}

const ROLES = ['superuser', 'editor', 'reviewer'] as const
type Role = (typeof ROLES)[number]

const ROLE_COLORS: Record<string, string> = {
  superuser: 'bg-red-100 text-red-700',
  editor: 'bg-blue-100 text-blue-700',
  reviewer: 'bg-purple-100 text-purple-700',
}

function generatePassword(length = 16): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*'
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export default function AdminSettingsUsersPage() {
  const router = useRouter()
  const [me, setMe] = useState<{ id: string; role: string } | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Add user modal
  const [showAdd, setShowAdd] = useState(false)
  const [addEmail, setAddEmail] = useState('')
  const [addPassword, setAddPassword] = useState('')
  const [addFullName, setAddFullName] = useState('')
  const [addRole, setAddRole] = useState<Role>('reviewer')
  const [adding, setAdding] = useState(false)

  // Edit modal
  const [editUser, setEditUser] = useState<AdminUser | null>(null)
  const [editRole, setEditRole] = useState<Role>('reviewer')
  const [editDisabled, setEditDisabled] = useState(false)
  const [saving, setSaving] = useState(false)

  const getToken = async (): Promise<string | null> => {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? null
  }

  const fetchData = useCallback(async () => {
    const token = await getToken()
    if (!token) { router.push('/admin/login'); return }

    setLoading(true)
    try {
      const [meRes, usersRes] = await Promise.all([
        fetch('/api/admin/me', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/admin/users', { headers: { Authorization: `Bearer ${token}` } }),
      ])

      if (!meRes.ok) { router.push('/admin/login'); return }
      const meData = await meRes.json()
      if (meData.role !== 'superuser' && meData.role !== 'superadmin') {
        router.push('/admin')
        return
      }
      setMe(meData)

      if (usersRes.status === 403) { setError('Access denied: superuser role required'); return }
      if (usersRes.ok) setUsers(await usersRes.json())
      else setError('Failed to load users')
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => { fetchData() }, [fetchData])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    setAdding(true)
    setError('')
    setSuccess('')
    const token = await getToken()
    if (!token) return
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: addEmail, password: addPassword, full_name: addFullName || null, role: addRole }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Failed to create user')
      }
      setSuccess(`Created ${addEmail} as ${addRole}`)
      setShowAdd(false)
      setAddEmail(''); setAddPassword(''); setAddFullName(''); setAddRole('reviewer')
      fetchData()
    } catch (e) {
      setError(String(e))
    } finally {
      setAdding(false)
    }
  }

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editUser) return
    setSaving(true)
    setError('')
    setSuccess('')
    const token = await getToken()
    if (!token) return
    try {
      const res = await fetch(`/api/admin/users/${editUser.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: editRole, disabled: editDisabled }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Failed to update user')
      }
      setSuccess(`Updated ${editUser.email}`)
      setEditUser(null)
      fetchData()
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleResetPassword = async (user: AdminUser) => {
    if (!confirm(`Send password reset email to ${user.email}?`)) return
    const token = await getToken()
    if (!token) return
    try {
      const res = await fetch(`/api/admin/users/${user.id}/reset-password`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Failed to send reset email')
      }
      setSuccess(`Password reset email sent to ${user.email}`)
    } catch (e) {
      setError(String(e))
    }
  }

  const handleDelete = async (user: AdminUser) => {
    if (!confirm(`Permanently delete ${user.email}? This cannot be undone.`)) return
    const token = await getToken()
    if (!token) return
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Failed to delete user')
      }
      setSuccess(`Deleted ${user.email}`)
      fetchData()
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
        <button
          onClick={() => { setShowAdd(true); setAddPassword(generatePassword()) }}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          <UserPlus className="w-4 h-4" /> Add User
        </button>
      </div>

      {error && <div className="bg-red-50 text-red-700 px-4 py-2 rounded-md text-sm">{error}</div>}
      {success && <div className="bg-green-50 text-green-700 px-4 py-2 rounded-md text-sm">{success}</div>}

      {/* Users table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Email / Name</th>
              <th className="px-4 py-3 text-left">Role</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Created</th>
              <th className="px-4 py-3 text-left">Last Sign-in</th>
              <th className="px-4 py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
            )}
            {!loading && users.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No users found</td></tr>
            )}
            {users.map((user) => {
              const isSelf = me?.id === user.id
              return (
                <tr key={user.id} className={`hover:bg-gray-50 ${user.disabled ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{user.email}</div>
                    {user.full_name && <div className="text-xs text-gray-400">{user.full_name}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[user.role] ?? 'bg-gray-100 text-gray-600'}`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {user.disabled
                      ? <span className="text-xs text-red-500">Disabled</span>
                      : user.email_confirmed
                        ? <span className="text-xs text-green-600">Active</span>
                        : <span className="text-xs text-yellow-600">Unconfirmed</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {user.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        title={isSelf ? 'Cannot edit yourself' : 'Edit'}
                        disabled={isSelf}
                        onClick={() => { setEditUser(user); setEditRole(user.role as Role); setEditDisabled(user.disabled) }}
                        className="text-gray-500 hover:text-indigo-600 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        title="Reset password"
                        onClick={() => handleResetPassword(user)}
                        className="text-gray-500 hover:text-yellow-600"
                      >
                        <KeyRound className="w-4 h-4" />
                      </button>
                      <button
                        title={isSelf ? 'Cannot delete yourself' : 'Delete'}
                        disabled={isSelf}
                        onClick={() => handleDelete(user)}
                        className="text-gray-500 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Add User Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Add User</h2>
              <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAdd} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                <input
                  type="email" required value={addEmail}
                  onChange={(e) => setAddEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
                <div className="flex gap-2">
                  <input
                    type="text" required value={addPassword}
                    onChange={(e) => setAddPassword(e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => setAddPassword(generatePassword())}
                    className="px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-600 hover:bg-gray-50"
                    title="Generate random password"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1">Copy this before submitting — it won&apos;t be shown again.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input
                  type="text" value={addFullName}
                  onChange={(e) => setAddFullName(e.target.value)}
                  placeholder="Optional"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role *</label>
                <select
                  value={addRole}
                  onChange={(e) => setAddRole(e.target.value as Role)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md">{error}</div>}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowAdd(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" disabled={adding}
                  className="flex-1 bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
                  {adding ? 'Creating…' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editUser && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Edit {editUser.email}</h2>
              <button onClick={() => setEditUser(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleEdit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as Role)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="disabled-toggle"
                  type="checkbox"
                  checked={editDisabled}
                  onChange={(e) => setEditDisabled(e.target.checked)}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <label htmlFor="disabled-toggle" className="text-sm text-gray-700">
                  Disable this account
                </label>
              </div>
              {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md">{error}</div>}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setEditUser(null)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" disabled={saving}
                  className="flex-1 bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
