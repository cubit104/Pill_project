'use client'

export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '../lib/supabase'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'

interface Pill {
  id: string
  medicine_name: string | null
  splimprint: string | null
  spl_strength: string | null
  splcolor_text: string | null
  splshape_text: string | null
  ndc11: string | null
  author: string | null
  has_image: string | null
  updated_at: string | null
  [key: string]: unknown
}

interface DupGroup {
  key: Record<string, string>
  count: number
  pills: Pill[]
}

interface DuplicatesResponse {
  total_groups: number
  groups: DupGroup[]
  page: number
  per_page: number
}

const DISPLAY_FIELDS: { key: string; label: string }[] = [
  { key: 'medicine_name', label: 'Drug Name' },
  { key: 'spl_strength', label: 'Strength' },
  { key: 'splimprint', label: 'Imprint' },
  { key: 'splcolor_text', label: 'Color' },
  { key: 'splshape_text', label: 'Shape' },
  { key: 'ndc11', label: 'NDC11' },
  { key: 'author', label: 'Author' },
  { key: 'has_image', label: 'Has Image' },
  { key: 'updated_at', label: 'Updated' },
]

function MergeModal({
  group,
  onClose,
  onMerged,
}: {
  group: DupGroup
  onClose: () => void
  onMerged: () => void
}) {
  const [keepIndex, setKeepIndex] = useState(0)
  const [merging, setMerging] = useState(false)
  const [error, setError] = useState('')

  const getSession = async () => {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    return session
  }

  const allFieldsEqual = (fieldKey: string) => {
    const vals = group.pills.map(p => String(p[fieldKey] ?? '').toLowerCase().trim())
    return vals.every(v => v === vals[0])
  }

  const handleMerge = async () => {
    setError('')
    const session = await getSession()
    if (!session) return
    const keepPill = group.pills[keepIndex]
    const discardIds = group.pills.filter((_, i) => i !== keepIndex).map(p => p.id)
    setMerging(true)
    try {
      const res = await fetch('/api/admin/duplicates/merge', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ keep_id: keepPill.id, discard_ids: discardIds }),
      })
      if (res.ok) {
        onMerged()
      } else {
        const data = await res.json()
        setError(data.detail || 'Merge failed')
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setMerging(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold">Review & Merge Duplicates</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-auto flex-1 p-4">
          {error && (
            <div className="bg-red-50 text-red-700 px-3 py-2 rounded text-sm mb-4">{error}</div>
          )}

          <p className="text-sm text-gray-600 mb-4">
            Select which pill to keep. Gap-fill fields (empty on kept, present on discarded) will be copied automatically. All other discarded pills will be soft-deleted.
          </p>

          {/* Keep radio buttons */}
          <div className="flex gap-3 mb-4 flex-wrap">
            {group.pills.map((pill, i) => (
              <label key={pill.id} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="keep"
                  checked={keepIndex === i}
                  onChange={() => setKeepIndex(i)}
                />
                <span className="text-sm font-medium">
                  Keep: {pill.medicine_name || '(no name)'} — {pill.id.slice(0, 8)}
                </span>
              </label>
            ))}
          </div>

          {/* Side-by-side field comparison */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 border">Field</th>
                  {group.pills.map((pill, i) => (
                    <th key={pill.id} className={`px-3 py-2 text-left text-xs font-medium border ${i === keepIndex ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500'}`}>
                      {i === keepIndex ? '★ KEEP' : 'DISCARD'} — {pill.id.slice(0, 8)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DISPLAY_FIELDS.map(({ key: fieldKey, label }) => {
                  const equal = allFieldsEqual(fieldKey)
                  const rowBg = equal ? 'bg-green-50' : 'bg-yellow-50'
                  return (
                    <tr key={fieldKey} className={rowBg}>
                      <td className="px-3 py-2 font-medium text-gray-600 border text-xs">{label}</td>
                      {group.pills.map((pill) => (
                        <td key={pill.id} className="px-3 py-2 border text-xs">
                          {fieldKey === 'updated_at' && pill.updated_at
                            ? new Date(pill.updated_at).toLocaleDateString()
                            : String(pill[fieldKey] ?? '—')}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="p-4 border-t flex items-center justify-between gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded text-sm text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleMerge}
            disabled={merging}
            className="px-4 py-2 bg-indigo-600 text-white rounded text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {merging ? 'Merging…' : 'Confirm Merge'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AdminDuplicatesPage() {
  const router = useRouter()
  const [groups, setGroups] = useState<DupGroup[]>([])
  const [totalGroups, setTotalGroups] = useState(0)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedGroup, setSelectedGroup] = useState<DupGroup | null>(null)

  const PER_PAGE = 20

  const getSession = useCallback(async () => {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    return session
  }, [])

  const fetchDuplicates = useCallback(async () => {
    const session = await getSession()
    if (!session) {
      router.push('/admin/login')
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/duplicates?page=${page}&per_page=${PER_PAGE}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) throw new Error('Failed to fetch duplicates')
      const data: DuplicatesResponse = await res.json()
      setGroups(data.groups)
      setTotalGroups(data.total_groups)
      setPages(Math.max(1, Math.ceil(data.total_groups / PER_PAGE)))
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [page, router, getSession])

  useEffect(() => {
    fetchDuplicates()
  }, [fetchDuplicates])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Duplicate Detector</h1>
          <p className="text-sm text-gray-500 mt-1">
            Pills sharing all 7 key fields (name, strength, imprint, color, shape, author, NDC).
          </p>
        </div>
        {totalGroups > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 text-center">
            <div className="text-2xl font-bold text-yellow-700">{totalGroups}</div>
            <div className="text-xs text-yellow-600">duplicate groups</div>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-2 rounded-md text-sm">{error}</div>
      )}

      {loading && (
        <div className="text-center py-12 text-gray-500">Loading duplicates…</div>
      )}

      {!loading && groups.length === 0 && (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <div className="text-4xl mb-3">✅</div>
          <h2 className="text-lg font-semibold text-gray-700">No duplicates found</h2>
          <p className="text-sm text-gray-500 mt-1">All pills have unique combinations of key fields.</p>
        </div>
      )}

      <div className="space-y-4">
        {groups.map((group, idx) => (
          <div key={idx} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
              <div className="text-sm font-medium text-gray-700">
                <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs font-bold mr-2">
                  {group.count} duplicates
                </span>
                {group.key.norm_name || '(no name)'} — {group.key.norm_strength || 'no strength'} — {group.key.norm_imprint || 'no imprint'}
              </div>
              <button
                onClick={() => setSelectedGroup(group)}
                className="px-3 py-1 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700"
              >
                Review & Merge
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="px-3 py-2 text-left">ID</th>
                    <th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-left">Imprint</th>
                    <th className="px-3 py-2 text-left">Strength</th>
                    <th className="px-3 py-2 text-left">NDC11</th>
                    <th className="px-3 py-2 text-left">Updated</th>
                    <th className="px-3 py-2 text-left">Edit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {group.pills.map((pill) => (
                    <tr key={pill.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono text-gray-400">{pill.id.slice(0, 8)}</td>
                      <td className="px-3 py-2">{pill.medicine_name || '—'}</td>
                      <td className="px-3 py-2">{pill.splimprint || '—'}</td>
                      <td className="px-3 py-2">{pill.spl_strength || '—'}</td>
                      <td className="px-3 py-2">{pill.ndc11 || '—'}</td>
                      <td className="px-3 py-2 text-gray-400">
                        {pill.updated_at ? new Date(pill.updated_at).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <Link href={`/admin/pills/${pill.id}`} className="text-indigo-600 hover:underline">
                          Edit
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 py-4">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="p-1 rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm text-gray-600">Page {page} of {pages}</span>
          <button
            onClick={() => setPage(p => Math.min(pages, p + 1))}
            disabled={page >= pages}
            className="p-1 rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {selectedGroup && (
        <MergeModal
          group={selectedGroup}
          onClose={() => setSelectedGroup(null)}
          onMerged={() => {
            setSelectedGroup(null)
            fetchDuplicates()
          }}
        />
      )}
    </div>
  )
}
