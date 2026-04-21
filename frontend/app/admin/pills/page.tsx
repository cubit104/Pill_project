'use client'

export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '../lib/supabase'
import { Search, Plus, Trash2, RotateCcw } from 'lucide-react'
import { Suspense } from 'react'

interface Pill {
  id: string
  medicine_name: string
  splimprint: string
  splcolor_text: string
  splshape_text: string
  image_filename: string
  has_image: string
  image_url: string | null
  slug: string
  updated_at: string
  deleted_at: string | null
  spl_strength: string
  status_rx_otc: string
}

interface PillsResponse {
  pills: Pill[]
  total: number
  page: number
  per_page: number
  pages: number
}

function PillsListInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [pills, setPills] = useState<Pill[]>([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)

  const page = Number(searchParams.get('page') || '1')
  const q = searchParams.get('q') || ''
  const deleted = searchParams.get('deleted') === 'true'
  const [searchInput, setSearchInput] = useState(q)

  const fetchPills = useCallback(async () => {
    const supabase = createClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) {
      router.push('/admin/login')
      return
    }

    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (deleted) params.set('deleted', 'true')
    params.set('page', String(page))
    params.set('per_page', '50')

    setLoading(true)
    try {
      const res = await fetch(`/api/admin/pills?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) throw new Error('Failed to fetch pills')
      const data: PillsResponse = await res.json()
      setPills(data.pills)
      setTotal(data.total)
      setPages(data.pages)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [q, deleted, page, router])

  useEffect(() => {
    fetchPills()
  }, [fetchPills])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const params = new URLSearchParams(searchParams.toString())
    if (searchInput) params.set('q', searchInput)
    else params.delete('q')
    params.set('page', '1')
    router.push(`/admin/pills?${params.toString()}`)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Soft-delete this pill? It can be restored from Trash.')) return
    const supabase = createClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) return
    setDeleting(id)
    try {
      const res = await fetch(`/api/admin/pills/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (res.ok) fetchPills()
      else setError('Delete failed')
    } finally {
      setDeleting(null)
    }
  }

  const handleRestore = async (id: string) => {
    const supabase = createClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) return
    try {
      const res = await fetch(`/api/admin/pills/${id}/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (res.ok) fetchPills()
      else setError('Restore failed')
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Pills</h1>
        <div className="flex gap-2">
          <Link
            href="/admin/pills/missing-images"
            className="flex items-center gap-2 bg-yellow-500 text-white px-4 py-2 rounded-md hover:bg-yellow-600 text-sm font-medium transition-colors"
          >
            Missing Images Queue
          </Link>
          <Link
            href="/admin/pills/new"
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> Add New Pill
          </Link>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <form onSubmit={handleSearch} className="flex gap-2 flex-wrap items-center">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search name, imprint, NDC…"
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button
            type="submit"
            className="bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            Search
          </button>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={deleted}
              onChange={(e) => {
                const params = new URLSearchParams(searchParams.toString())
                if (e.target.checked) params.set('deleted', 'true')
                else params.delete('deleted')
                params.set('page', '1')
                router.push(`/admin/pills?${params}`)
              }}
            />
            Show deleted
          </label>
        </form>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-2 rounded-md text-sm">{error}</div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        {/* Row count — always visible */}
        <div className="px-4 py-2 border-b border-gray-200 text-sm text-gray-600">
          {loading ? (
            <span>Loading…</span>
          ) : (
            <span>
              Showing {total === 0 ? 0 : (page - 1) * 50 + 1}–{Math.min(page * 50, total)} of{' '}
              {total.toLocaleString()} pills
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Image</th>
                <th className="px-4 py-3 text-left">Drug Name</th>
                <th className="px-4 py-3 text-left">Imprint</th>
                <th className="px-4 py-3 text-left">Color</th>
                <th className="px-4 py-3 text-left">Shape</th>
                <th className="px-4 py-3 text-left">Updated</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && pills.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    No pills found
                  </td>
                </tr>
              )}
              {pills.map((pill) => (
                <tr
                  key={pill.id}
                  className={`hover:bg-gray-50 ${pill.deleted_at ? 'opacity-50' : ''}`}
                >
                  <td className="px-4 py-3">
                    {pill.image_url ? (
                      <img
                        src={pill.image_url}
                        alt={pill.medicine_name || 'pill'}
                        className="w-10 h-10 object-contain rounded bg-gray-50"
                        width={40}
                        height={40}
                      />
                    ) : (
                      <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center text-gray-400 text-xs">
                        no image
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/pills/${pill.id}`}
                      className="font-medium text-indigo-600 hover:underline"
                    >
                      {pill.medicine_name || '(no name)'}
                    </Link>
                    {pill.spl_strength && (
                      <div className="text-xs text-gray-400">{pill.spl_strength}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{pill.splimprint || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{pill.splcolor_text || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{pill.splshape_text || '—'}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {pill.updated_at ? new Date(pill.updated_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-3">
                      {pill.deleted_at ? (
                        <button
                          onClick={() => handleRestore(pill.id)}
                          className="flex items-center gap-1 text-xs text-green-600 hover:text-green-800"
                        >
                          <RotateCcw className="w-3 h-3" /> Restore
                        </button>
                      ) : (
                        <>
                          <Link
                            href={`/admin/pills/${pill.id}`}
                            className="text-xs text-indigo-600 hover:text-indigo-800"
                          >
                            Edit
                          </Link>
                          <button
                            onClick={() => handleDelete(pill.id)}
                            disabled={deleting === pill.id}
                            className="flex items-center gap-1 text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
                          >
                            <Trash2 className="w-3 h-3" /> Delete
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between text-sm text-gray-600">
          <div>
            {total > 0 && (
              <span>
                Page {page} of {pages}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={`/admin/pills?${new URLSearchParams({ ...Object.fromEntries(searchParams), page: String(page - 1) })}`}
                className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50"
              >
                Previous
              </Link>
            )}
            {page < pages && (
              <Link
                href={`/admin/pills?${new URLSearchParams({ ...Object.fromEntries(searchParams), page: String(page + 1) })}`}
                className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AdminPillsPage() {
  return (
    <Suspense fallback={<div className="p-4 text-gray-500">Loading…</div>}>
      <PillsListInner />
    </Suspense>
  )
}
