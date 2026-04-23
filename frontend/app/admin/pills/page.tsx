'use client'

export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '../lib/supabase'
import { Search, Plus, Trash2, RotateCcw, Download } from 'lucide-react'

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
  completeness_score?: number
  completeness_color?: 'red' | 'yellow' | 'green'
}

function highlightMatch(text: string | null, query: string): React.ReactNode {
  if (!text) return null
  if (!query) return text
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 text-yellow-900 rounded px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  )
}

function CompletenessBadge({ score, color }: { score?: number; color?: string }) {
  if (score == null) return null
  const emoji = color === 'green' ? '\uD83D\uDFE2' : color === 'yellow' ? '\uD83D\uDFE1' : '\uD83D\uDD34'
  return (
    <span className="text-xs font-medium" title={`Completeness: ${score}%`}>
      {emoji} {score}%
    </span>
  )
}

interface PillsResponse {
  pills: Pill[]
  total: number
  page: number
  per_page: number
  pages: number
}

interface PillStats {
  total: number
  no_image: number
  no_name: number
  no_imprint: number
  no_ndc: number
}

function PillsListInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [pills, setPills] = useState<Pill[]>([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [stats, setStats] = useState<PillStats | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkLoading, setBulkLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const page = Number(searchParams.get('page') || '1')
  const q = searchParams.get('q') || ''
  const deleted = searchParams.get('deleted') === 'true'
  const noImage = searchParams.get('no_image') === 'true'
  const noName = searchParams.get('no_name') === 'true'
  const noImprint = searchParams.get('no_imprint') === 'true'
  const noNdc = searchParams.get('no_ndc') === 'true'
  const sort = searchParams.get('sort') || ''
  const [searchInput, setSearchInput] = useState(q)

  const getSession = useCallback(async () => {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    return session
  }, [])

  const fetchStats = useCallback(async () => {
    const session = await getSession()
    if (!session) return
    try {
      const res = await fetch('/api/admin/pills/stats', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (res.ok) setStats(await res.json())
    } catch { /* silently fail */ }
  }, [getSession])

  const fetchPills = useCallback(async () => {
    const session = await getSession()
    if (!session) {
      router.push('/admin/login')
      return
    }

    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (deleted) params.set('deleted', 'true')
    if (noImage) params.set('has_image', 'false')
    if (noName) params.set('no_name', 'true')
    if (noImprint) params.set('no_imprint', 'true')
    if (noNdc) params.set('no_ndc', 'true')
    if (sort) params.set('sort', sort)
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
      setSelectedIds(new Set())
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [q, deleted, noImage, noName, noImprint, noNdc, sort, page, router, getSession])

  useEffect(() => {
    fetchPills()
  }, [fetchPills])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const params = new URLSearchParams(searchParams.toString())
    if (searchInput) params.set('q', searchInput)
    else params.delete('q')
    params.set('page', '1')
    router.push(`/admin/pills?${params.toString()}`)
  }

  const handleSearchInput = (val: string) => {
    setSearchInput(val)
    setSearching(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString())
      if (val) params.set('q', val)
      else params.delete('q')
      params.set('page', '1')
      router.push(`/admin/pills?${params.toString()}`)
      setSearching(false)
    }, 250)
  }

  const setChip = (chipParams: Record<string, string>) => {
    // Start from current search params to preserve q, deleted, etc.
    const params = new URLSearchParams(searchParams.toString())
    // Clear all chip-specific filter keys before applying new chip
    params.delete('no_image')
    params.delete('no_name')
    params.delete('no_imprint')
    params.delete('no_ndc')
    Object.entries(chipParams).forEach(([k, v]) => params.set(k, v))
    params.set('page', '1')
    router.push(`/admin/pills?${params.toString()}`)
  }

  const activeChip = noImage ? 'no_image' : noName ? 'no_name' : noImprint ? 'no_imprint' : noNdc ? 'no_ndc' : 'all'

  const chips: { key: string; label: string; count: number | undefined; params: Record<string, string> }[] = [
    { key: 'all', label: 'All', count: stats?.total, params: {} },
    { key: 'no_image', label: 'No image', count: stats?.no_image, params: { no_image: 'true' } },
    { key: 'no_name', label: 'No name', count: stats?.no_name, params: { no_name: 'true' } },
    { key: 'no_imprint', label: 'No imprint', count: stats?.no_imprint, params: { no_imprint: 'true' } },
    { key: 'no_ndc', label: 'No NDC', count: stats?.no_ndc, params: { no_ndc: 'true' } },
  ]

  const handleDelete = async (id: string) => {
    if (!confirm('Soft-delete this pill? It can be restored from Trash.')) return
    const session = await getSession()
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
    const session = await getSession()
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

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === pills.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(pills.map(p => p.id)))
    }
  }

  const handleBulkTag = async () => {
    const tag = prompt('Enter tag to add to selected pills:')
    if (!tag?.trim()) return
    const session = await getSession()
    if (!session) return
    setBulkLoading(true)
    try {
      const res = await fetch('/api/admin/pills/bulk/tag', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids: Array.from(selectedIds), tag: tag.trim(), mode: 'add' }),
      })
      if (res.ok) {
        fetchPills()
        fetchStats()
      } else {
        setError('Bulk tag failed')
      }
    } finally {
      setBulkLoading(false)
    }
  }

  const handleBulkDelete = async () => {
    if (!confirm(`Move ${selectedIds.size} pill(s) to trash? This can be undone from Trash.`)) return
    const session = await getSession()
    if (!session) return
    setBulkLoading(true)
    try {
      const res = await fetch('/api/admin/pills/bulk/delete', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      })
      if (res.ok) {
        fetchPills()
        fetchStats()
      } else {
        setError('Bulk delete failed')
      }
    } finally {
      setBulkLoading(false)
    }
  }

  const handleExportCsv = async () => {
    const session = await getSession()
    if (!session) return
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (deleted) params.set('deleted', 'true')
    if (noImage) params.set('has_image', 'false')
    if (noName) params.set('no_name', 'true')
    if (noImprint) params.set('no_imprint', 'true')
    if (noNdc) params.set('no_ndc', 'true')

    try {
      const res = await fetch(`/api/admin/pills/export.csv?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) { setError('Export failed'); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const dateStr = new Date().toISOString().slice(0, 10)
      a.download = `pills-export-${dateStr}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pills</h1>
          <Link href="/admin/pills?sort=recent" className="text-xs text-indigo-500 hover:underline">
            Recently edited →
          </Link>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExportCsv}
            className="flex items-center gap-2 bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700 text-sm font-medium transition-colors"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
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

      {/* Filter chips */}
      <div className="flex gap-2 flex-wrap">
        {chips.map(chip => (
          <button
            key={chip.key}
            onClick={() => setChip(chip.params)}
            className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
              activeChip === chip.key
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400'
            }`}
          >
            {chip.label}
            {chip.count !== undefined && (
              <span className="ml-1 opacity-80">({chip.count.toLocaleString()})</span>
            )}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <form onSubmit={handleSearch} className="flex gap-2 flex-wrap items-center">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => handleSearchInput(e.target.value)}
              placeholder="Search by drug name, imprint, or NDC\u2026"
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {searching && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-indigo-500 animate-pulse">Searching\u2026</span>
            )}
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
        <p className="mt-1 text-xs text-gray-400">Searches: drug name, imprint, NDC</p>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-2 rounded-md text-sm">{error}</div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="sticky top-0 z-10 px-4 py-2 bg-indigo-50 border-b border-indigo-200 flex items-center gap-3 flex-wrap shadow-sm">
            <span className="text-sm font-medium text-indigo-800">{selectedIds.size} selected</span>
            <button
              onClick={handleBulkTag}
              disabled={bulkLoading}
              className="px-3 py-1 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700 disabled:opacity-50"
            >
              Add tag to selected
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={bulkLoading}
              className="px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700 disabled:opacity-50"
            >
              Move to trash
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="px-3 py-1 bg-white text-gray-600 text-xs rounded border border-gray-300 hover:bg-gray-50"
            >
              Clear selection
            </button>
          </div>
        )}

        {/* Row count */}
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
                <th className="px-3 py-3 text-left w-10">
                  <input
                    type="checkbox"
                    checked={pills.length > 0 && selectedIds.size === pills.length}
                    onChange={toggleSelectAll}
                    className="rounded"
                  />
                </th>
                <th className="px-4 py-3 text-left">Image</th>
                <th className="px-4 py-3 text-left">Drug Name</th>
                <th className="px-4 py-3 text-left">Imprint</th>
                <th className="px-4 py-3 text-left">Color</th>
                <th className="px-4 py-3 text-left">Shape</th>
                <th className="px-4 py-3 text-left">Complete</th>
                <th className="px-4 py-3 text-left">Updated</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && pills.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                    No pills found
                  </td>
                </tr>
              )}
              {pills.map((pill) => (
                <tr
                  key={pill.id}
                  className={`hover:bg-gray-50 ${pill.deleted_at ? 'opacity-50' : ''} ${selectedIds.has(pill.id) ? 'bg-indigo-50' : ''}`}
                >
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(pill.id)}
                      onChange={() => toggleSelect(pill.id)}
                      className="rounded"
                    />
                  </td>
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
                      {highlightMatch(pill.medicine_name, q) ?? '(no name)'}
                    </Link>
                    {pill.spl_strength && (
                      <div className="text-xs text-gray-400">{pill.spl_strength}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{highlightMatch(pill.splimprint, q) ?? '\u2014'}</td>
                  <td className="px-4 py-3 text-gray-600">{pill.splcolor_text || '\u2014'}</td>
                  <td className="px-4 py-3 text-gray-600">{pill.splshape_text || '\u2014'}</td>
                  <td className="px-4 py-3">
                    <CompletenessBadge score={pill.completeness_score} color={pill.completeness_color} />
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {pill.updated_at ? new Date(pill.updated_at).toLocaleDateString() : '\u2014'}
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
