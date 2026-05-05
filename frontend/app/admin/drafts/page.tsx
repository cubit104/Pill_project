'use client'

export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '../lib/supabase'
import { Pencil } from 'lucide-react'

interface Draft {
  id: string
  pill_id: string | null
  status: string
  created_at: string | null
  updated_at: string | null
  review_notes: string | null
  medicine_name: string | null
  created_by: string | null
}

function DraftsListInner() {
  const router = useRouter()

  const [drafts, setDrafts] = useState<Draft[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pendingCount, setPendingCount] = useState<number | null>(null)

  const fetchDrafts = useCallback(async () => {
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
      const [draftsRes, countRes] = await Promise.all([
        fetch('/api/admin/drafts', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
        fetch('/api/admin/drafts/count', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
      ])
      if (!draftsRes.ok) throw new Error('Failed to fetch drafts')
      setDrafts(await draftsRes.json())
      if (countRes.ok) {
        const countData = await countRes.json()
        setPendingCount(countData.count ?? null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    fetchDrafts()
  }, [fetchDrafts])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Drafts</h1>
        {pendingCount != null && pendingCount > 0 && (
          <span className="bg-yellow-400 text-yellow-900 text-sm font-bold px-2 py-0.5 rounded-full">
            {pendingCount}
          </span>
        )}
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-2 rounded-md text-sm">{error}</div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">ID</th>
              <th className="px-4 py-3 text-left">Pill</th>
              <th className="px-4 py-3 text-left">Last Updated</th>
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
            {!loading && drafts.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                  No drafts found
                </td>
              </tr>
            )}
            {drafts.map((draft) => (
              <tr key={draft.id} className="hover:bg-gray-50 cursor-pointer">
                <td className="px-4 py-3 font-mono text-xs text-gray-600">
                  <Link href={`/admin/pills/${draft.id}`} className="hover:text-indigo-600 hover:underline">
                    #{draft.id.slice(0, 8)}
                  </Link>
                </td>
                <td className="px-4 py-3 text-gray-700">{draft.medicine_name || '(unnamed)'}</td>
                <td className="px-4 py-3 text-gray-400 text-xs">
                  {draft.updated_at ? new Date(draft.updated_at).toLocaleDateString() : '—'}
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/pills/${draft.id}`}
                    className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800"
                  >
                    <Pencil className="w-3 h-3" /> Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function AdminDraftsPage() {
  return (
    <Suspense fallback={<div className="p-4 text-gray-500">Loading…</div>}>
      <DraftsListInner />
    </Suspense>
  )
}
