'use client'

export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../lib/supabase'
import { adminApi } from '../lib/api'
import { Camera, Check, Download, RotateCcw, SkipForward, ThumbsDown, ThumbsUp, Trash2, XCircle } from 'lucide-react'

type Status = 'unreviewed' | 'reviewed' | 'unusable'

interface Candidate {
  slug: string
  medicine_name: string
  splimprint: string
  strength: string
  color: string
  shape: string
  image_url: string | null
  user_picked: boolean
}

interface Capture {
  capture_id: string
  created_at: string | null
  imprint_read: string | null
  tokens: string[]
  attrs_guess: { shape?: string; color?: string }
  top_slugs: string[]
  consent: boolean
  photo_paths: string[]
  photo_urls: string[]
  verdict: 'up' | 'down' | null
  chosen_slug: string | null
  corrected_imprint: string | null
  reviewed: boolean
  reviewed_label: string | null
  side_labels: string[] | null
  reviewed_at: string | null
  reviewed_by: string | null
}

interface CaptureDetail extends Capture {
  candidates: Candidate[]
  chosen: Candidate | null
}

interface SearchHit {
  slug: string
  name: string
  imprint: string
  strength: string
  image_url: string | null
}

const PER_PAGE = 50
const TABS: { key: Status; label: string; hint: string }[] = [
  { key: 'unreviewed', label: 'To review', hint: 'captures with photos nobody has checked yet' },
  { key: 'reviewed', label: 'Reviewed', hint: 'confirmed and labelled, ready for training' },
  { key: 'unusable', label: 'Unusable', hint: 'photos were deleted, only the record remains' },
]

function fmtDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : '—'
}

export default function AdminCapturesPage() {
  const router = useRouter()
  const [role, setRole] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('unreviewed')
  const [page, setPage] = useState(1)
  const [list, setList] = useState<Capture[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<CaptureDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Review form
  const [pillSlug, setPillSlug] = useState<string | null>(null)
  const [pillName, setPillName] = useState('')
  const [pillImprint, setPillImprint] = useState('')
  const [sideLabels, setSideLabels] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const searchSeq = useRef(0)

  const getToken = async () => {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? null
  }

  const loadList = useCallback(async (keepSelection = true) => {
    const token = await getToken()
    if (!token) { router.push('/admin/login'); return }
    setLoading(true)
    setError('')
    try {
      const data = await adminApi.getCaptures({ status, page, per_page: PER_PAGE })
      const captures: Capture[] = data.captures
      setList(captures)
      setTotal(data.total)
      setSelectedId((current) => {
        if (keepSelection && current && captures.some((c) => c.capture_id === current)) return current
        return captures[0]?.capture_id ?? null
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [status, page, router])

  useEffect(() => {
    const init = async () => {
      const token = await getToken()
      if (!token) { router.push('/admin/login'); return }
      const res = await fetch('/api/admin/me', { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) setRole((await res.json()).role)
    }
    init()
  }, [router])

  useEffect(() => {
    loadList(false)
  }, [loadList])

  // Detail + form reset whenever the selection changes.
  useEffect(() => {
    if (!selectedId) { setDetail(null); return }
    let cancelled = false
    setDetailLoading(true)
    adminApi.getCapture(selectedId)
      .then((d: CaptureDetail) => {
        if (cancelled) return
        setDetail(d)
        const picked = d.chosen ?? d.candidates.find((c) => c.user_picked) ?? null
        setPillSlug(picked?.slug ?? null)
        setPillName(picked?.medicine_name ?? '')
        setPillImprint(d.reviewed_label ?? picked?.splimprint ?? d.imprint_read ?? '')
        setSideLabels(
          d.side_labels && d.side_labels.length === d.photo_urls.length
            ? d.side_labels
            : d.photo_urls.map((_, i) => (i === 0 ? d.imprint_read ?? '' : '')),
        )
        setQuery('')
        setHits([])
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!cancelled) setDetailLoading(false) })
    return () => { cancelled = true }
  }, [selectedId])

  // Pill picker: name search and imprint search, merged.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setHits([]); return }
    const seq = ++searchSeq.current
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const fetchType = async (type: string) => {
          const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&type=${type}&per_page=8`)
          if (!res.ok) return []
          const data = await res.json()
          return (data.results ?? []) as Array<Record<string, unknown>>
        }
        const [byName, byImprint] = await Promise.all([fetchType('name'), fetchType('imprint')])
        if (seq !== searchSeq.current) return
        const seen = new Set<string>()
        const merged: SearchHit[] = []
        for (const r of [...byName, ...byImprint]) {
          const slug = typeof r.slug === 'string' ? r.slug : ''
          if (!slug || seen.has(slug)) continue
          seen.add(slug)
          merged.push({
            slug,
            name: String(r.drug_name ?? slug),
            imprint: String(r.imprint ?? ''),
            strength: String(r.strength ?? ''),
            image_url: typeof r.image_url === 'string' ? r.image_url : null,
          })
        }
        setHits(merged.slice(0, 10))
      } finally {
        if (seq === searchSeq.current) setSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  const pickPill = (slug: string, name: string, imprint: string) => {
    setPillSlug(slug)
    setPillName(name)
    setPillImprint(imprint)
    setQuery('')
    setHits([])
  }

  const selectedIndex = list.findIndex((c) => c.capture_id === selectedId)

  const advance = (removeCurrent: boolean) => {
    const remaining = removeCurrent ? list.filter((c) => c.capture_id !== selectedId) : list
    const nextIndex = removeCurrent ? selectedIndex : selectedIndex + 1
    const next = remaining[Math.min(nextIndex, remaining.length - 1)] ?? null
    if (removeCurrent) {
      setList(remaining)
      setTotal((t) => Math.max(0, t - 1))
      window.dispatchEvent(new Event('capture-count-changed'))
    }
    if (remaining.length === 0 && total > remaining.length) {
      loadList(false)
      return
    }
    setSelectedId(next?.capture_id ?? null)
  }

  const flash = (msg: string) => {
    setNotice(msg)
    setTimeout(() => setNotice(''), 2500)
  }

  const confirmPill = async () => {
    if (!detail || saving) return
    if (!pillSlug && !pillImprint.trim()) {
      setError('Pick the pill or type its imprint first.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await adminApi.reviewCapture(detail.capture_id, {
        chosen_slug: pillSlug,
        reviewed_label: pillImprint.trim() ? pillImprint.trim() : null,
        side_labels: sideLabels,
      })
      flash(`Saved: ${pillName || pillImprint.trim()}`)
      advance(status === 'unreviewed')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const markUnusable = async () => {
    if (!detail || saving) return
    if (!confirm('Delete these photos for good and mark the capture unusable?')) return
    setSaving(true)
    setError('')
    try {
      await adminApi.reviewCapture(detail.capture_id, { unusable: true })
      flash('Photos deleted')
      advance(status !== 'unusable')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const reopen = async () => {
    if (!detail || saving) return
    setSaving(true)
    try {
      await adminApi.reopenCapture(detail.capture_id)
      flash('Back in the queue')
      advance(status !== 'unreviewed')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const removeCapture = async () => {
    if (!detail || saving) return
    if (!confirm('Permanently delete this capture and its photos? This CANNOT be undone.')) return
    setSaving(true)
    try {
      await adminApi.deleteCapture(detail.capture_id)
      flash('Capture deleted')
      advance(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const exportManifest = async () => {
    const token = await getToken()
    if (!token) return
    setError('')
    try {
      const res = await fetch('/api/admin/captures/export', { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(err.detail || 'Export failed')
      }
      const rows = res.headers.get('X-Manifest-Rows') ?? '?'
      const captures = res.headers.get('X-Manifest-Captures') ?? '?'
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `captures_manifest_${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      flash(`Exported ${rows} photos from ${captures} captures`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const isSuperuser = role === 'superuser' || role === 'superadmin'
  const canExport = isSuperuser || role === 'editor'
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

  const onLabelKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      confirmPill()
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Camera className="w-6 h-6 text-emerald-600" /> Photo Captures
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Phone photos users agreed to share. Confirm the pill, write what is readable on each photo,
            or delete photos that are useless. Reviewed captures become training data for the reader and matcher.
          </p>
        </div>
        {canExport && (
          <button
            onClick={exportManifest}
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-md bg-gray-900 text-white hover:bg-gray-700"
            title="Download the training manifest (reviewed captures only)"
          >
            <Download className="w-4 h-4" /> Export for training
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => { setStatus(t.key); setPage(1) }}
            title={t.hint}
            className={`px-3 py-1.5 text-sm rounded-full border ${
              status === t.key ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            {t.label}{status === t.key && !loading ? ` · ${total}` : ''}
          </button>
        ))}
      </div>

      {error && <div className="bg-red-50 text-red-700 px-4 py-2 rounded-md text-sm">{error}</div>}
      {notice && <div className="bg-emerald-50 text-emerald-800 px-4 py-2 rounded-md text-sm">{notice}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
        {/* Queue */}
        <aside className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden flex flex-col max-h-[75vh]">
          <div className="overflow-y-auto divide-y divide-gray-100 flex-1">
            {loading && <div className="px-4 py-8 text-center text-gray-500 text-sm">Loading…</div>}
            {!loading && list.length === 0 && (
              <div className="px-4 py-8 text-center text-gray-500 text-sm">Nothing here</div>
            )}
            {list.map((c) => (
              <button
                key={c.capture_id}
                onClick={() => setSelectedId(c.capture_id)}
                className={`w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-gray-50 ${
                  c.capture_id === selectedId ? 'bg-indigo-50' : ''
                }`}
              >
                {c.photo_urls[0] ? (
                  <img src={c.photo_urls[0]} alt="" className="w-12 h-12 object-cover rounded-md bg-gray-100 shrink-0" />
                ) : (
                  <div className="w-12 h-12 rounded-md bg-gray-100 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900 truncate">
                    {c.reviewed_label ?? c.imprint_read ?? <span className="text-gray-400">nothing read</span>}
                  </div>
                  <div className="text-xs text-gray-500 truncate">
                    {fmtDate(c.created_at)} · {c.photo_paths.length} photo{c.photo_paths.length === 1 ? '' : 's'}
                  </div>
                </div>
                {c.verdict === 'up' && <ThumbsUp className="w-4 h-4 text-emerald-600 shrink-0" />}
                {c.verdict === 'down' && <ThumbsDown className="w-4 h-4 text-red-500 shrink-0" />}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 text-xs text-gray-500">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="disabled:opacity-40 hover:text-gray-900">← Prev</button>
            <span>Page {page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="disabled:opacity-40 hover:text-gray-900">Next →</button>
          </div>
        </aside>

        {/* Detail */}
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 space-y-4">
          {!selectedId && <div className="text-gray-500 text-sm">Select a capture on the left.</div>}
          {selectedId && detailLoading && !detail && <div className="text-gray-500 text-sm">Loading…</div>}
          {detail && (
            <>
              {detail.reviewed && (
                <div className="bg-blue-50 text-blue-800 px-3 py-2 rounded-md text-sm">
                  Reviewed by {detail.reviewed_by ?? 'unknown'} on {fmtDate(detail.reviewed_at)}
                  {detail.reviewed_label !== null && <> · pill imprint <strong>{detail.reviewed_label || '(none)'}</strong></>}
                  {detail.photo_paths.length === 0 && <> · photos deleted</>}
                </div>
              )}

              {/* Photos with per-photo labels */}
              {detail.photo_urls.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {detail.photo_urls.map((url, i) => (
                    <figure key={i} className="space-y-2">
                      <a href={url} target="_blank" rel="noreferrer" title="Open full size">
                        <img src={url} alt={`Side ${i + 1}`} className="w-full max-h-80 object-contain rounded-md bg-gray-100" />
                      </a>
                      <label className="block text-xs text-gray-600">
                        Readable on photo {i + 1} (leave blank if nothing)
                        <input
                          value={sideLabels[i] ?? ''}
                          onChange={(e) => setSideLabels((s) => s.map((v, j) => (j === i ? e.target.value : v)))}
                          onKeyDown={onLabelKeyDown}
                          disabled={detail.reviewed && detail.photo_paths.length === 0}
                          className="mt-1 w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm font-mono uppercase"
                          placeholder="e.g. BX 2"
                        />
                      </label>
                    </figure>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-gray-500">No photos stored for this capture.</div>
              )}

              {/* What the system and the user said */}
              <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-gray-500">Reader read</dt>
                  <dd className="font-mono">{detail.imprint_read || <span className="text-gray-400">nothing</span>}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">Shape / color guess</dt>
                  <dd>{[detail.attrs_guess?.shape, detail.attrs_guess?.color].filter(Boolean).join(' · ') || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">User verdict</dt>
                  <dd>
                    {detail.verdict === 'up' && <span className="text-emerald-700">👍 this is my pill</span>}
                    {detail.verdict === 'down' && <span className="text-red-600">👎 none of these</span>}
                    {!detail.verdict && '—'}
                    {detail.corrected_imprint && <span className="block text-xs text-gray-500">typed: {detail.corrected_imprint}</span>}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">Captured</dt>
                  <dd>{fmtDate(detail.created_at)}</dd>
                </div>
              </dl>

              {/* Candidates */}
              <div>
                <div className="text-xs text-gray-500 mb-2">Candidates shown to the user — click the right one</div>
                {detail.candidates.length === 0 && <div className="text-sm text-gray-400">No candidates were shown.</div>}
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
                  {detail.candidates.map((c) => (
                    <button
                      key={c.slug}
                      onClick={() => pickPill(c.slug, c.medicine_name, c.splimprint)}
                      className={`text-left border rounded-md p-2 flex gap-2 items-center hover:border-indigo-400 ${
                        pillSlug === c.slug ? 'border-indigo-600 ring-2 ring-indigo-200' : 'border-gray-200'
                      }`}
                    >
                      {c.image_url ? (
                        <img src={c.image_url} alt="" className="w-12 h-12 object-cover rounded bg-gray-100 shrink-0" />
                      ) : (
                        <div className="w-12 h-12 rounded bg-gray-100 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">{c.medicine_name}</div>
                        <div className="text-xs text-gray-500 truncate">{c.strength}</div>
                        <div className="text-xs font-mono text-gray-700 truncate">{c.splimprint || '(no imprint)'}</div>
                        {c.user_picked && <span className="text-[10px] text-emerald-700 font-semibold">USER PICKED</span>}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Another pill */}
              <div className="relative">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  placeholder="Not in the list? Search by name or imprint…"
                />
                {(hits.length > 0 || searching) && (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-72 overflow-y-auto">
                    {searching && hits.length === 0 && <div className="px-3 py-2 text-xs text-gray-500">Searching…</div>}
                    {hits.map((h) => (
                      <button
                        key={h.slug}
                        onClick={() => pickPill(h.slug, h.name, h.imprint)}
                        className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-gray-50"
                      >
                        {h.image_url ? (
                          <img src={h.image_url} alt="" className="w-8 h-8 object-cover rounded bg-gray-100" />
                        ) : (
                          <div className="w-8 h-8 rounded bg-gray-100" />
                        )}
                        <span className="text-sm text-gray-900">{h.name}</span>
                        <span className="text-xs text-gray-500">{h.strength}</span>
                        <span className="ml-auto text-xs font-mono text-gray-600">{h.imprint}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Decision */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
                <div className="text-sm">
                  <div className="text-xs text-gray-500">Pill</div>
                  {pillSlug ? (
                    <div className="font-medium text-gray-900">
                      {pillName} <span className="text-xs text-gray-400 font-normal">{pillSlug}</span>
                      <button onClick={() => { setPillSlug(null); setPillName('') }} className="ml-2 text-xs text-gray-500 hover:text-red-600">clear</button>
                    </div>
                  ) : (
                    <div className="text-gray-400">none picked (imprint-only label is fine)</div>
                  )}
                </div>
                <label className="block text-xs text-gray-600">
                  Pill imprint (whole pill, both sides)
                  <input
                    value={pillImprint}
                    onChange={(e) => setPillImprint(e.target.value)}
                    onKeyDown={onLabelKeyDown}
                    className="mt-1 w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm font-mono uppercase"
                    placeholder="e.g. BX 2"
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100">
                {detail.photo_paths.length > 0 && (
                  <button
                    onClick={confirmPill}
                    disabled={saving}
                    className="flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                    title="Enter"
                  >
                    <Check className="w-4 h-4" /> {detail.reviewed ? 'Save changes' : 'Confirm'}
                  </button>
                )}
                {detail.photo_paths.length > 0 && (
                  <button
                    onClick={markUnusable}
                    disabled={saving}
                    className="flex items-center gap-2 px-3 py-2 text-sm rounded-md border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    <XCircle className="w-4 h-4" /> Unusable · delete photos
                  </button>
                )}
                {status !== 'unreviewed' && detail.photo_paths.length > 0 && (
                  <button onClick={reopen} disabled={saving} className="flex items-center gap-2 px-3 py-2 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                    <RotateCcw className="w-4 h-4" /> Reopen
                  </button>
                )}
                <button
                  onClick={() => advance(false)}
                  disabled={selectedIndex < 0 || selectedIndex >= list.length - 1}
                  className="flex items-center gap-2 px-3 py-2 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                >
                  <SkipForward className="w-4 h-4" /> Skip
                </button>
                {isSuperuser && (
                  <button onClick={removeCapture} disabled={saving} className="ml-auto flex items-center gap-2 px-3 py-2 text-sm rounded-md text-red-600 hover:bg-red-50 disabled:opacity-50">
                    <Trash2 className="w-4 h-4" /> Delete capture
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
