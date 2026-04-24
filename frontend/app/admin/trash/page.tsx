'use client'

export const dynamic = 'force-dynamic'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../lib/supabase'
import { RotateCcw, Trash2 } from 'lucide-react'

interface Pill {
  id: string
  medicine_name: string
  splimprint: string
  deleted_at: string
  spl_strength: string
}

export default function AdminTrashPage() {
  const router = useRouter()
  const [pills, setPills] = useState<Pill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [restoring, setRestoring] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [role, setRole] = useState<string | null>(null)

  const getToken = async () => {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? null
  }

  const fetchData = async () => {
    const token = await getToken()
    if (!token) { router.push('/admin/login'); return }

    setLoading(true)
    try {
      const [roleRes, pillsRes] = await Promise.all([
        fetch('/api/admin/me', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/admin/pills?deleted=true&per_page=100', { headers: { Authorization: `Bearer ${token}` } }),
      ])
      if (roleRes.ok) {
        const data = await roleRes.json()
        setRole(data.role)
      }
      if (!pillsRes.ok) throw new Error('Failed to fetch deleted pills')
      const data = await pillsRes.json()
      setPills(data.pills)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleRestore = async (id: string) => {
    const token = await getToken()
    if (!token) return
    setRestoring(id)
    try {
      const res = await fetch(`/api/admin/pills/${id}/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) fetchData()
      else setError('Restore failed')
    } catch (e) {
      setError(String(e))
    } finally {
      setRestoring(null)
    }
  }

  const handleHardDelete = async (id: string, name: string) => {
    if (!confirm(`Permanently delete "${name}"? This CANNOT be undone.`)) return
    const token = await getToken()
    if (!token) return
    setDeleting(id)
    try {
      const res = await fetch(`/api/admin/pills/${id}/hard`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) fetchData()
      else {
        const err = await res.json()
        setError(err.detail || 'Hard delete failed')
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setDeleting(null)
    }
  }

  const canRestore = role === 'superuser' || role === 'superadmin' || role === 'editor'
  const canHardDelete = role === 'superuser' || role === 'superadmin'

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Trash</h1>
      <p className="text-gray-500 text-sm">
        Soft-deleted pills. Restore them to make them visible again.
        {canHardDelete && ' Superusers can also permanently delete.'}
      </p>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-2 rounded-md text-sm">{error}</div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Drug Name</th>
              <th className="px-4 py-3 text-left">Imprint</th>
              <th className="px-4 py-3 text-left">Deleted At</th>
              <th className="px-4 py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && pills.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                  Trash is empty
                </td>
              </tr>
            )}
            {pills.map((pill) => (
              <tr key={pill.id} className="hover:bg-gray-50 opacity-75">
                <td className="px-4 py-3 text-gray-700">
                  {pill.medicine_name || '(no name)'}
                  {pill.spl_strength && (
                    <span className="text-xs text-gray-400 ml-1">{pill.spl_strength}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-500">{pill.splimprint || '—'}</td>
                <td className="px-4 py-3 text-gray-400 text-xs">
                  {pill.deleted_at ? new Date(pill.deleted_at).toLocaleString() : '—'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {canRestore && (
                      <button
                        onClick={() => handleRestore(pill.id)}
                        disabled={restoring === pill.id}
                        className="flex items-center gap-1 text-xs text-green-600 hover:text-green-800 disabled:opacity-50"
                      >
                        <RotateCcw className="w-3 h-3" /> Restore
                      </button>
                    )}
                    {canHardDelete && (
                      <button
                        onClick={() => handleHardDelete(pill.id, pill.medicine_name)}
                        disabled={deleting === pill.id}
                        className="flex items-center gap-1 text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
                      >
                        <Trash2 className="w-3 h-3" /> Delete forever
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
