'use client'

export const dynamic = 'force-dynamic'
import { Suspense, useEffect, useState, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '../../lib/supabase'
import { ArrowLeft } from 'lucide-react'
import { FIELD_SCHEMA_BY_KEY } from '../../lib/fieldSchema'

interface IncompletePill {
  id: string
  medicine_name: string | null
  splimprint: string | null
  completeness_score: number
  missing_required: string[]
  needs_na_confirmation: string[]
}

interface IncompletePillsResponse {
  pills: IncompletePill[]
  total: number
  page: number
  per_page: number
  pages: number
}

function IncompletePillsInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [pills, setPills] = useState<IncompletePill[]>([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const page = Number(searchParams.get('page') || '1')
  const tier = searchParams.get('tier') || ''

  const getSession = useCallback(async () => {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    return session
  }, [])

  const fetchPills = useCallback(async () => {
    const session = await getSession()
    if (!session) { router.push('/admin/login'); return }

    const params = new URLSearchParams()
    if (tier) params.set('tier', tier)
    params.set('page', String(page))
    params.set('per_page', '20')

    setLoading(true)
    try {
      const res = await fetch(`/api/admin/pills/incomplete?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) throw new Error('Failed to fetch incomplete pills')
      const data: IncompletePillsResponse = await res.json()
      setPills(data.pills)
      setTotal(data.total)
      setPages(data.pages)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [tier, page, router, getSession])

  useEffect(() => { fetchPills() }, [fetchPills])

  const setTierFilter = (t: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (t) params.set('tier', t)
    else params.delete('tier')
    params.set('page', '1')
    router.push(`/admin/pills/incomplete?${params.toString()}`)
  }

  const tabs = [
    { key: '', label: 'All incomplete' },
    { key: 'required', label: 'Missing required only' },
    { key: 'required_or_na', label: 'Missing Tier 2 only' },
  ]

  const fieldLabel = (key: string) => FIELD_SCHEMA_BY_KEY[key]?.label ?? key

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/admin" className="text-gray-500 hover:text-gray-700 flex items-center gap-1 text-sm">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Incomplete Pills</h1>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setTierFilter(tab.key)}
            className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
              tier === tab.key
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && <div className="bg-red-50 text-red-700 px-4 py-2 rounded-md text-sm">{error}</div>}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-200 text-sm text-gray-600">
          {loading ? <span>Loading&hellip;</span> : <span>{total.toLocaleString()} pills need attention</span>}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">ID</th>
                <th className="px-4 py-3 text-left">Drug Name</th>
                <th className="px-4 py-3 text-left">Imprint</th>
                <th className="px-4 py-3 text-left">Completeness</th>
                <th className="px-4 py-3 text-left">Missing Required</th>
                <th className="px-4 py-3 text-left">Needs N/A</th>
                <th className="px-4 py-3 text-left">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">Loading&hellip;</td></tr>
              )}
              {!loading && pills.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">{'\uD83C\uDF89'} No incomplete pills found!</td></tr>
              )}
              {pills.map((pill) => (
                <tr key={pill.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-400 text-xs font-mono">{pill.id.slice(0, 8)}&hellip;</td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/pills/${pill.id}`} className="font-medium text-indigo-600 hover:underline">
                      {pill.medicine_name || '(no name)'}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{pill.splimprint || '\u2014'}</td>
                  <td className="px-4 py-3">
                    <span className={`font-bold ${
                      pill.missing_required.length > 0 ? 'text-red-600' : 'text-yellow-600'
                    }`}>
                      {pill.missing_required.length > 0 ? '\uD83D\uDD34' : '\uD83D\uDFE1'} {pill.completeness_score}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-red-600">
                    {pill.missing_required.length > 0
                      ? pill.missing_required.map(k => fieldLabel(k)).join(', ')
                      : '\u2014'}
                  </td>
                  <td className="px-4 py-3 text-xs text-yellow-700">
                    {pill.needs_na_confirmation.length > 0
                      ? pill.needs_na_confirmation.map(k => fieldLabel(k)).join(', ')
                      : '\u2014'}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/pills/${pill.id}`} className="text-xs text-indigo-600 hover:underline">
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between text-sm text-gray-600">
          <div>{total > 0 && <span>Page {page} of {pages}</span>}</div>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={`/admin/pills/incomplete?${new URLSearchParams({ ...Object.fromEntries(searchParams), page: String(page - 1) })}`}
                className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50"
              >
                Previous
              </Link>
            )}
            {page < pages && (
              <Link
                href={`/admin/pills/incomplete?${new URLSearchParams({ ...Object.fromEntries(searchParams), page: String(page + 1) })}`}
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

export default function IncompletePillsPage() {
  return (
    <Suspense fallback={<div className="p-4 text-gray-500">Loading&hellip;</div>}>
      <IncompletePillsInner />
    </Suspense>
  )
}
