'use client'

export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../lib/supabase'
import { RefreshCw, Search, UserX, UserCheck } from 'lucide-react'

interface Member {
  id: string
  email: string
  created_at: string | null
  last_sign_in_at: string | null
  disabled: boolean
  cabinet_count: number
  reminder_count: number
}

interface MembersResponse {
  summary: { total: number; active: number; new_7d: number; signed_in_30d: number; with_cabinet: number }
  page: number
  limit: number
  filtered: number
  members: Member[]
}

const PAGE_SIZE = 50

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function fmtAgo(iso: string | null): string {
  if (!iso) return 'Never'
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return '—'
  const days = Math.floor(ms / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days} days ago`
  return fmtDate(iso)
}

export default function AdminMembersPage() {
  const router = useRouter()
  const [data, setData] = useState<MembersResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Member | null>(null)

  const getToken = useCallback(async (): Promise<string | null> => {
    const { data: { session } } = await createClient().auth.getSession()
    return session?.access_token ?? null
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const token = await getToken()
    if (!token) {
      router.push('/admin/login')
      return
    }
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
      if (search) params.set('q', search)
      const res = await fetch(`/api/admin/members?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      if (res.status === 403) {
        setError('Only superusers can view members.')
        return
      }
      if (!res.ok) throw new Error(`Request failed (${res.status})`)
      setData((await res.json()) as MembersResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load members')
    } finally {
      setLoading(false)
    }
  }, [getToken, page, router, search])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = async (m: Member) => {
    setBusyId(m.id)
    setError('')
    try {
      const token = await getToken()
      const res = await fetch(`/api/admin/members/${m.id}/${m.disabled ? 'reactivate' : 'deactivate'}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail || `Request failed (${res.status})`)
      setData((d) => d && { ...d, members: d.members.map((x) => (x.id === m.id ? { ...x, disabled: !m.disabled } : x)) })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusyId(null)
      setConfirm(null)
    }
  }

  const summary = data?.summary
  const pages = data ? Math.max(1, Math.ceil(data.filtered / data.limit)) : 1

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Members</h1>
          <p className="text-sm text-gray-500">Public accounts from the app and website (medicine cabinet). What they saved stays private to them.</p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            ['Total', summary.total],
            ['Active', summary.active],
            ['New this week', summary.new_7d],
            ['Signed in (30d)', summary.signed_in_30d],
            ['Saved a pill', summary.with_cabinet],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs uppercase text-gray-500">{label}</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
            </div>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          setPage(1)
          setSearch(query.trim())
        }}
        className="flex max-w-md items-center gap-2"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by email"
            className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
        <button type="submit" className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700">Search</button>
      </form>

      {error && <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-600">
            <tr>
              <th className="px-4 py-3 text-left">Email</th>
              <th className="px-4 py-3 text-left">Joined</th>
              <th className="px-4 py-3 text-left">Last sign-in</th>
              <th className="px-4 py-3 text-right">Pills saved</th>
              <th className="px-4 py-3 text-right">Reminders</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && !data ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
            ) : !data || data.members.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">{search ? 'No members match that email.' : 'No members yet.'}</td></tr>
            ) : (
              data.members.map((m) => (
                <tr key={m.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{m.email}</td>
                  <td className="px-4 py-3 text-gray-600">{fmtDate(m.created_at)}</td>
                  <td className="px-4 py-3 text-gray-600">{fmtAgo(m.last_sign_in_at)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">{m.cabinet_count}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">{m.reminder_count}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${m.disabled ? 'bg-gray-100 text-gray-600' : 'bg-emerald-100 text-emerald-700'}`}>
                      {m.disabled ? 'Deactivated' : 'Active'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {m.disabled ? (
                      <button type="button" disabled={busyId === m.id} onClick={() => void toggle(m)} className="inline-flex items-center gap-1 text-emerald-700 hover:underline disabled:opacity-50">
                        <UserCheck className="h-4 w-4" /> Reactivate
                      </button>
                    ) : (
                      <button type="button" disabled={busyId === m.id} onClick={() => setConfirm(m)} className="inline-flex items-center gap-1 text-red-600 hover:underline disabled:opacity-50">
                        <UserX className="h-4 w-4" /> Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {data && pages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-sm text-gray-600">
            <span>Page {data.page} of {pages} · {data.filtered} members</span>
            <div className="flex gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border border-gray-300 px-3 py-1 disabled:opacity-40">Previous</button>
              <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded border border-gray-300 px-3 py-1 disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900">Deactivate {confirm.email}?</h2>
            <p className="mt-2 text-sm text-gray-600">They will not be able to sign in on the app or website. Their cabinet is kept, and you can reactivate them at any time.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirm(null)} className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
              <button type="button" disabled={busyId === confirm.id} onClick={() => void toggle(confirm)} className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                Deactivate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
