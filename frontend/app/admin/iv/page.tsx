'use client'

export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, RefreshCw, Search, Sparkles } from 'lucide-react'
import { createClient } from '../lib/supabase'
import { adminApi } from '../lib/api'
import { useUserRole } from '../lib/useUserRole'
import { STATUS_LABEL, STATUS_STYLE, type CardStatus } from './status'

interface IvDrugRow {
  id: string
  slug: string
  generic_name: string
  brand_names: string[]
  label_type: string | null
  label_brand: string | null
  label_maker: string | null
  label_presentation: string | null
  maker_count: number
  published: boolean
  card_status: CardStatus
  card_reviewed_by: string | null
  card_reviewed_at: string | null
  label_updated_since: boolean
}

interface ListResponse {
  drugs: IvDrugRow[]
  total: number
  page: number
  per_page: number
  counts: Partial<Record<CardStatus, number>>
  published: number
  ai_available: boolean
}

/** Progress of the background job that drafts cards for drugs without one (routes/admin/iv_bulk.py). */
interface DraftStatus {
  running: boolean
  missing: number
  max_per_run: number
  ai_available: boolean
  status?: 'running' | 'finished'
  total?: number
  done?: number
  failed?: number
  skipped?: number
  last?: string
  last_error?: string
}

const PAGE_SIZE = 50
const POLL_MS = 15000
const FILTERS: Array<{ id: CardStatus | 'all'; label: string }> = [
  { id: 'draft', label: 'To review' },
  { id: 'none', label: 'No card yet' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'all', label: 'All' },
]

export default function AdminIvDrugsPage() {
  const router = useRouter()
  const { role } = useUserRole()
  const [data, setData] = useState<ListResponse | null>(null)
  const [filter, setFilter] = useState<CardStatus | 'all'>('draft')
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<DraftStatus | null>(null)
  const wasRunning = useRef(false)
  const canEdit = role === 'superuser' || role === 'editor'

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data: { session } } = await createClient().auth.getSession()
    if (!session) {
      router.push('/admin/login')
      return
    }
    try {
      const params: Record<string, string | number> = { page, per_page: PAGE_SIZE }
      if (filter !== 'all') params.status = filter
      if (search) params.q = search
      setData((await adminApi.getIvDrugs(params)) as ListResponse)
      setSelected(new Set()) // ticks belong to the rows on screen
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load IV drugs')
    } finally {
      setLoading(false)
    }
  }, [filter, page, router, search])

  useEffect(() => {
    void load()
  }, [load])

  const loadDraftStatus = useCallback(async () => {
    try {
      const status = (await adminApi.getIvDraftStatus()) as DraftStatus
      setDraft(status)
      // the job just ended: show the new drafts in the list
      if (wasRunning.current && !status.running) void load()
      wasRunning.current = status.running
    } catch {
      // the list still works without it
    }
  }, [load])

  useEffect(() => {
    void loadDraftStatus()
  }, [loadDraftStatus])

  useEffect(() => {
    if (!draft?.running) return
    const timer = window.setInterval(() => void loadDraftStatus(), POLL_MS)
    return () => window.clearInterval(timer)
  }, [draft?.running, loadDraftStatus])

  const startDrafting = async () => {
    if (!draft) return
    const batch = Math.min(draft.missing, draft.max_per_run)
    if (!window.confirm(`Draft cards with AI for the next ${batch} drugs that have none? It runs in the background (about a minute per drug) and every card stays a draft until it is approved.`)) return
    setBusy(true); setError(''); setMessage('')
    try {
      const status = (await adminApi.draftMissingIvCards(batch)) as DraftStatus
      setDraft(status)
      wasRunning.current = status.running
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start drafting')
    } finally {
      setBusy(false)
    }
  }

  const publishSelected = async (published: boolean) => {
    const picked = (data?.drugs ?? []).filter((d) => selected.has(d.id))
    if (picked.length === 0) return
    const noCard = picked.filter((d) => d.card_status !== 'approved').length
    const warning = published && noCard > 0 ? ` ${noCard} of them have no approved card: their pages will show the label and strengths only.` : ''
    if (!window.confirm(`${published ? 'Publish' : 'Hide'} ${picked.length} drug${picked.length === 1 ? '' : 's'}?${warning}`)) return
    setBusy(true); setError(''); setMessage('')
    try {
      const result = (await adminApi.bulkPublishIv(picked.map((d) => d.id), published)) as { changed: number; unchanged: number; indexnow_queued: boolean }
      setMessage(
        `${result.changed} drug${result.changed === 1 ? '' : 's'} ${published ? 'published' : 'hidden'}` +
          (result.unchanged ? `, ${result.unchanged} already were` : '') +
          (published ? '. The site shows them within about 5 minutes.' : '.') +
          (result.indexnow_queued ? ' IndexNow: pages queued for Bing & Yandex.' : ''),
      )
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const allOnPage = Boolean(data?.drugs.length) && (data?.drugs ?? []).every((d) => selected.has(d.id))

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1
  const count = (id: CardStatus | 'all') =>
    id === 'all' ? Object.values(data?.counts ?? {}).reduce((sum, n) => sum + (n ?? 0), 0) : data?.counts[id] ?? 0

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">IV drugs and administration cards</h1>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Each card is drafted by AI from the drug&apos;s FDA label, and every quote is machine-checked against that label. Nothing is shown on
            the site until a reviewer approves it here.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && draft?.ai_available && draft.missing > 0 && (
            <button
              disabled={busy || draft.running}
              onClick={() => void startDrafting()}
              title="Same AI draft and quote check as the single button, in the background. Nothing goes public: every card waits for approval."
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <Sparkles className="h-4 w-4" />
              {draft.running ? 'Drafting…' : `Draft next ${Math.min(draft.missing, draft.max_per_run)} cards`}
            </button>
          )}
          {canEdit && (
            <Link href="/admin/iv/new" className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
              <Plus className="h-4 w-4" /> Add IV drug
            </Link>
          )}
          <button onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {data && (
        <p className="mb-4 text-sm text-slate-600">
          {data.published} of {count('all')} drugs are published on the site.{' '}
          {!data.ai_available && (
            <span className="text-amber-700">AI drafting is off on this server (no GEMINI_API_KEY), so new cards cannot be drafted here.</span>
          )}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => { setFilter(f.id); setPage(1) }}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${filter === f.id ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
          >
            {f.label} <span className={filter === f.id ? 'text-emerald-100' : 'text-slate-400'}>{count(f.id)}</span>
          </button>
        ))}
        <form
          className="ml-auto flex items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); setSearch(query.trim()); setPage(1) }}
        >
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Drug or brand name"
              className="rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm w-56"
            />
          </div>
        </form>
      </div>

      {draft && (draft.running || draft.status === 'finished') && (draft.total ?? 0) > 0 && (
        <p className={`mb-4 rounded-lg border px-3 py-2 text-sm ${draft.running ? 'border-sky-200 bg-sky-50 text-sky-800' : 'border-slate-200 bg-white text-slate-700'}`}>
          {draft.running ? 'Drafting cards in the background: ' : 'Last bulk draft: '}
          <b>{draft.done ?? 0} of {draft.total}</b> drafted
          {draft.failed ? `, ${draft.failed} failed` : ''}
          {draft.skipped ? `, ${draft.skipped} skipped` : ''}
          {draft.running && draft.last ? `. Now: ${draft.last}` : ''}. {draft.missing} drugs still have no card.
          {draft.failed && draft.last_error ? <span className="block text-xs text-slate-500">Last error: {draft.last_error}</span> : null}
          {draft.running && <span className="block text-xs text-sky-700">You can leave this page. New drafts appear under &quot;To review&quot;.</span>}
        </p>
      )}

      {error && <p className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {message && <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>}

      {canEdit && selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
          <span className="font-medium text-emerald-900">{selected.size} selected</span>
          <button disabled={busy} onClick={() => void publishSelected(true)} className="rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">
            Publish selected
          </button>
          <button disabled={busy} onClick={() => void publishSelected(false)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">
            Hide selected
          </button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-slate-600 hover:underline">Clear</button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              {canEdit && (
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label="Select every drug on this page"
                    checked={allOnPage}
                    onChange={() => setSelected(allOnPage ? new Set() : new Set((data?.drugs ?? []).map((d) => d.id)))}
                  />
                </th>
              )}
              <th className="px-4 py-3 font-semibold">Drug</th>
              <th className="px-4 py-3 font-semibold">Label used</th>
              <th className="px-4 py-3 font-semibold">Makers</th>
              <th className="px-4 py-3 font-semibold">Card</th>
              <th className="px-4 py-3 font-semibold">On site</th>
            </tr>
          </thead>
          <tbody>
            {data?.drugs.map((drug) => (
              <tr key={drug.id} className={`border-b border-slate-100 last:border-0 hover:bg-slate-50 ${selected.has(drug.id) ? 'bg-emerald-50/50' : ''}`}>
                {canEdit && (
                  <td className="px-4 py-3">
                    <input type="checkbox" aria-label={`Select ${drug.generic_name}`} checked={selected.has(drug.id)} onChange={() => toggle(drug.id)} />
                  </td>
                )}
                <td className="px-4 py-3">
                  <Link href={`/admin/iv/${drug.id}`} className="font-semibold text-sky-700 hover:underline">{drug.generic_name}</Link>
                  {drug.brand_names.length > 0 && <div className="text-xs text-slate-500">{drug.brand_names.slice(0, 3).join(', ')}</div>}
                </td>
                <td className="px-4 py-3 text-slate-700">
                  {drug.label_brand || '—'}
                  <div className="text-xs text-slate-500">
                    {[drug.label_maker, drug.label_type, drug.label_presentation].filter(Boolean).join(' · ')}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-700">{drug.maker_count}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[drug.card_status]}`}>
                    {STATUS_LABEL[drug.card_status]}
                  </span>
                  {drug.label_updated_since && <div className="mt-1 text-xs text-amber-700">FDA label updated since</div>}
                  {drug.card_reviewed_by && drug.card_status !== 'draft' && <div className="mt-1 text-xs text-slate-500">{drug.card_reviewed_by}</div>}
                </td>
                <td className="px-4 py-3">{drug.published ? <span className="text-emerald-700 font-medium">Published</span> : <span className="text-slate-400">Hidden</span>}</td>
              </tr>
            ))}
            {data && data.drugs.length === 0 && (
              <tr><td colSpan={canEdit ? 6 : 5} className="px-4 py-10 text-center text-slate-500">Nothing here.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 disabled:opacity-40">Previous</button>
          <span>Page {page} of {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  )
}
