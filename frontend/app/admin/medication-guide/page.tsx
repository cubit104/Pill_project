'use client'

export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { sanitizeRenderedHtml } from '../../(public)/pill/[slug]/medication-guide/sanitizeRenderedHtml'
import { createClient } from '../lib/supabase'
import RichTextEditor from './RichTextEditor'

type GuideSearchRow = {
  id: string
  medicine_name: string | null
  spl_strength: string | null
  rxcui: string | null
  ndc11: string | null
  spl_set_id: string | null
  slug: string | null
  has_professional: boolean
  has_medguide: boolean
  has_dosage: boolean
  has_side_effects: boolean
  guide_fetched_at: string | null
}

type GuideStatus = {
  pill_id: string
  medicine_name: string | null
  spl_set_id: string | null
  rxcui: string | null
  ndc: string | null
  brand_name: string | null
  generic_name: string | null
  source_url: string | null
  fetched_at: string | null
  professional_html: string | null
  medguide_html: string | null
  dosage_administration: string | null
  adverse_reactions: string | null
  side_effects: string | null
  has_professional: boolean
  has_medguide: boolean
  has_dosage: boolean
  has_side_effects: boolean
  professional_chars: number
  medguide_chars: number
  dosage_chars: number
  side_effects_chars: number
}

type TabKey = 'professional' | 'medguide' | 'dosage' | 'side_effects'
type ViewMode = 'edit' | 'preview'

type SuggestionItem = string | { label: string; kind?: string; generic?: string }

const TAB_LABELS: Record<TabKey, string> = {
  professional: 'Professional',
  medguide: 'MedGuide',
  dosage: 'Dosage',
  side_effects: 'Side Effects',
}

const STATUS_DOT = (ok: boolean) => (ok ? '✅' : '❌')

const SUGGESTION_DEBOUNCE_MS = 120
const SUGGESTION_CLOSE_DELAY_MS = 150

export default function MedicationGuideAdminPage() {
  const router = useRouter()

  const [searchTerm, setSearchTerm] = useState('')
  const [missingOnly, setMissingOnly] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [rows, setRows] = useState<GuideSearchRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const perPage = 20

  const [selectedPillId, setSelectedPillId] = useState<string | null>(null)
  const [status, setStatus] = useState<GuideStatus | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(false)

  const [splSetIdInput, setSplSetIdInput] = useState('')
  const [activeTab, setActiveTab] = useState<TabKey>('professional')
  const [viewMode, setViewMode] = useState<ViewMode>('edit')
  const [tabDrafts, setTabDrafts] = useState<Record<TabKey, string>>({
    professional: '',
    medguide: '',
    dosage: '',
    side_effects: '',
  })

  // Suggestion dropdown state
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const suggestDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const suggestionsRef = useRef<HTMLUListElement>(null)

  const getToken = useCallback(async () => {
    const supabase = createClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) {
      router.push('/admin/login')
      return null
    }
    return session.access_token
  }, [router])

  const runSearch = useCallback(async (targetPage = 1, term = '', missing = false) => {
    const token = await getToken()
    if (!token) return

    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({
        q: term,
        page: String(targetPage),
        per_page: String(perPage),
      })
      if (missing) params.set('missing_only', 'true')

      const res = await fetch(`/api/admin/guide/search?${params.toString()}`, {
        headers: { Authorization: 'Bearer ' + token },
      })
      if (!res.ok) throw new Error('Failed to search pills')
      const data = await res.json()
      setRows(Array.isArray(data.pills) ? data.pills : [])
      setTotal(Number(data.total || 0))
      setPage(Number(data.page || targetPage))
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [getToken])

  // Fetch suggestions from the same /suggestions API used on the homepage
  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.length < 2) { setSuggestions([]); return }
    try {
      const res = await fetch(`/suggestions?q=${encodeURIComponent(q)}&type=drug`)
      if (res.ok) {
        const data: SuggestionItem[] = await res.json()
        setSuggestions(data.slice(0, 8))
      }
    } catch { setSuggestions([]) }
  }, [])

  const loadStatus = useCallback(async (pillId: string) => {
    const token = await getToken()
    if (!token) return

    setLoadingStatus(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/guide/${pillId}/status`, {
        headers: { Authorization: 'Bearer ' + token },
      })
      if (!res.ok) throw new Error('Failed to load guide status')
      const data: GuideStatus = await res.json()
      setStatus(data)
      setSplSetIdInput(data.spl_set_id || '')
      setTabDrafts({
        professional: data.professional_html || '',
        medguide: data.medguide_html || '',
        dosage: data.dosage_administration || '',
        side_effects: data.adverse_reactions || data.side_effects || '',
      })
    } catch (e) {
      setError(String(e))
    } finally {
      setLoadingStatus(false)
    }
  }, [getToken])

  // Initial load
  useEffect(() => {
    runSearch(1, '', false)
  }, [runSearch])

  // Debounced suggestions — triggers 120ms after user stops typing
  useEffect(() => {
    if (suggestDebounceRef.current) clearTimeout(suggestDebounceRef.current)
    suggestDebounceRef.current = setTimeout(() => {
      fetchSuggestions(searchTerm)
    }, SUGGESTION_DEBOUNCE_MS)
    return () => {
      if (suggestDebounceRef.current) clearTimeout(suggestDebounceRef.current)
    }
  }, [searchTerm, fetchSuggestions])

  // Cleanup blur timeout
  useEffect(() => {
    return () => { if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current) }
  }, [])

  useEffect(() => {
    if (!selectedPillId) {
      setStatus(null)
      return
    }
    loadStatus(selectedPillId)
  }, [loadStatus, selectedPillId])

  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedPillId) || null,
    [rows, selectedPillId]
  )

  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const missingSetIdCount = rows.filter((row) => !(row.spl_set_id || '').trim()).length
  const missingProfessionalCount = rows.filter((row) => !row.has_professional).length

  const updateTabDraft = (tab: TabKey, value: string) => {
    setTabDrafts((prev) => ({ ...prev, [tab]: value }))
  }

  const getSuggestionLabel = (item: SuggestionItem): string => {
    return typeof item === 'string' ? item : item.label
  }

  const getSuggestionGeneric = (item: SuggestionItem): string | undefined => {
    return typeof item === 'string' ? undefined : item.generic
  }

  const handleSelectSuggestion = (label: string) => {
    setSearchTerm(label)
    setShowSuggestions(false)
    setSuggestions([])
    setHighlightedIndex(-1)
    runSearch(1, label, missingOnly)
  }

  const handleSearchSubmit = () => {
    setShowSuggestions(false)
    setSuggestions([])
    setHighlightedIndex(-1)
    runSearch(1, searchTerm, missingOnly)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (highlightedIndex >= 0 && suggestions[highlightedIndex]) {
        const picked = getSuggestionLabel(suggestions[highlightedIndex])
        handleSelectSuggestion(picked)
      } else {
        handleSearchSubmit()
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex((prev) => Math.min(prev + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex((prev) => Math.max(prev - 1, -1))
    } else if (e.key === 'Escape') {
      setShowSuggestions(false)
      setHighlightedIndex(-1)
    }
  }

  const saveSetId = async () => {
    if (!selectedPillId) return
    const token = await getToken()
    if (!token) return

    try {
      const res = await fetch(`/api/admin/guide/${selectedPillId}/set-setid`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ spl_set_id: splSetIdInput }),
      })
      if (!res.ok) throw new Error('Failed to save SPL Set ID')
      await Promise.all([loadStatus(selectedPillId), runSearch(page, searchTerm, missingOnly)])
    } catch (e) {
      setError(String(e))
    }
  }

  const lookupSetId = async () => {
    if (!selectedPillId) return
    const token = await getToken()
    if (!token) return

    try {
      const res = await fetch(`/api/admin/guide/${selectedPillId}/lookup-setid`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
      })
      if (!res.ok) throw new Error('Lookup failed')
      const data = await res.json()
      if (data?.spl_set_id) {
        setSplSetIdInput(data.spl_set_id)
      }
    } catch (e) {
      setError(String(e))
    }
  }

  const refetchTarget = async (target: 'all' | 'professional' | 'medguide' | 'dosage' | 'side_effects') => {
    if (!selectedPillId) return
    const token = await getToken()
    if (!token) return

    try {
      const res = await fetch(`/api/admin/guide/${selectedPillId}/refetch`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ target }),
      })
      if (!res.ok) throw new Error(`Re-fetch failed (${target})`)
      const data: GuideStatus = await res.json()
      setStatus(data)
      setTabDrafts({
        professional: data.professional_html || '',
        medguide: data.medguide_html || '',
        dosage: data.dosage_administration || '',
        side_effects: data.adverse_reactions || data.side_effects || '',
      })
      await runSearch(page, searchTerm, missingOnly)
    } catch (e) {
      setError(String(e))
    }
  }

  const saveTab = async (tab: TabKey) => {
    if (!selectedPillId) return
    const token = await getToken()
    if (!token) return

    const field = tab === 'professional'
      ? 'professional_html'
      : tab === 'medguide'
        ? 'medguide_html'
        : tab === 'dosage'
          ? 'dosage_administration'
          : 'adverse_reactions'

    try {
      const res = await fetch(`/api/admin/guide/${selectedPillId}/content`, {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ field, content: tabDrafts[tab] || '' }),
      })
      if (!res.ok) throw new Error(`Save failed (${TAB_LABELS[tab]})`)
      const data: GuideStatus = await res.json()
      setStatus(data)
      await runSearch(page, searchTerm, missingOnly)
    } catch (e) {
      setError(String(e))
    }
  }

  const clearCache = async () => {
    if (!selectedPillId) return
    if (!confirm('Delete this medication_guide cache row?')) return

    const token = await getToken()
    if (!token) return

    try {
      const res = await fetch(`/api/admin/guide/${selectedPillId}/clear-cache`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
      })
      if (!res.ok) throw new Error('Clear cache failed')
      await Promise.all([loadStatus(selectedPillId), runSearch(page, searchTerm, missingOnly)])
    } catch (e) {
      setError(String(e))
    }
  }

  const tabStatus = {
    professional: { ok: !!status?.has_professional, chars: status?.professional_chars || 0 },
    medguide: { ok: !!status?.has_medguide, chars: status?.medguide_chars || 0 },
    dosage: { ok: !!status?.has_dosage, chars: status?.dosage_chars || 0 },
    side_effects: { ok: !!status?.has_side_effects, chars: status?.side_effects_chars || 0 },
  }

  const activeTabContent = tabDrafts[activeTab] || ''
  const sanitizedPreviewHtml = useMemo(
    () => sanitizeRenderedHtml(activeTabContent),
    [activeTabContent]
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Medication Guide</h1>
        <p className="text-sm text-gray-500">Search and manage SPL Set IDs and tab content for medication guides.</p>
      </div>

      {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-2 rounded-md">{error}</div>}

      <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm space-y-3">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <label htmlFor="guide-search-input" className="sr-only">Drug name search</label>
            <input
              id="guide-search-input"
              ref={inputRef}
              type="text"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              placeholder="Search drug name…"
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setShowSuggestions(true); setHighlightedIndex(-1) }}
              onKeyDown={handleKeyDown}
              onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true) }}
              onBlur={() => {
                if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current)
                blurTimeoutRef.current = setTimeout(() => setShowSuggestions(false), SUGGESTION_CLOSE_DELAY_MS)
              }}
              aria-autocomplete="list"
              aria-controls="guide-suggestions-list"
              aria-expanded={showSuggestions && suggestions.length > 0}
            />
            {showSuggestions && suggestions.length > 0 && (
              <ul
                id="guide-suggestions-list"
                ref={suggestionsRef}
                role="listbox"
                className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto"
              >
                {suggestions.map((suggestion, index) => {
                  const label = getSuggestionLabel(suggestion)
                  const generic = getSuggestionGeneric(suggestion)
                  return (
                    <li
                      key={`${label}-${index}`}
                      role="option"
                      aria-selected={index === highlightedIndex}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        handleSelectSuggestion(label)
                      }}
                      className={`px-4 py-2.5 text-sm cursor-pointer transition-colors ${
                        index === highlightedIndex ? 'bg-indigo-50 text-indigo-700' : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <span className="font-medium">{label}</span>
                      {generic && generic !== label && (
                        <span className="ml-2 text-xs text-gray-400">({generic})</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <button
            type="button"
            className="bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-indigo-700"
            disabled={loading}
            onClick={handleSearchSubmit}
          >
            Search
          </button>
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={missingOnly}
            onChange={(e) => { setMissingOnly(e.target.checked); runSearch(1, searchTerm, !missingOnly) }}
          />
          Show only missing SPL Set ID
        </label>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        <div className="xl:col-span-2 bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 text-sm font-semibold text-gray-900">
            Results ({total.toLocaleString()})
          </div>
          <div className="max-h-[520px] overflow-y-auto divide-y divide-gray-100">
            {!rows.length && !loading && (
              <div className="p-4 text-sm text-gray-500">No pills found.</div>
            )}
            {loading && <div className="p-4 text-sm text-gray-500">Loading…</div>}
            {rows.map((row) => {
              const isSelected = row.id === selectedPillId
              return (
                <button
                  key={row.id}
                  className={`w-full text-left px-4 py-3 hover:bg-gray-50 ${isSelected ? 'bg-indigo-50' : ''}`}
                  onClick={() => setSelectedPillId(row.id)}
                >
                  <div className="font-medium text-gray-900 text-sm">{row.medicine_name || '(no name)'}</div>
                  <div className="text-xs text-gray-500 mt-1">{row.spl_strength || '—'}</div>
                  <div className="text-xs text-gray-500 mt-1">RxCUI: {row.rxcui || '—'} | NDC11: {row.ndc11 || '—'}</div>
                  <div className="text-xs text-gray-500 mt-1">SPL Set ID: {row.spl_set_id || '—'}</div>
                  <div className="text-xs mt-2 text-gray-700 flex flex-wrap gap-2">
                    <span>{STATUS_DOT(row.has_professional)} Professional</span>
                    <span>{STATUS_DOT(row.has_medguide)} MedGuide</span>
                    <span>{STATUS_DOT(row.has_dosage)} Dosage</span>
                    <span>{STATUS_DOT(row.has_side_effects)} Side Effects</span>
                  </div>
                </button>
              )
            })}
          </div>
          <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between text-xs text-gray-600">
            <span>Page {page} / {totalPages}</span>
            <div className="space-x-2">
              <button
                type="button"
                className="px-2 py-1 border rounded disabled:opacity-50"
                disabled={page <= 1 || loading}
                onClick={() => runSearch(page - 1, searchTerm, missingOnly)}
              >
                Prev
              </button>
              <button
                type="button"
                className="px-2 py-1 border rounded disabled:opacity-50"
                disabled={page >= totalPages || loading}
                onClick={() => runSearch(page + 1, searchTerm, missingOnly)}
              >
                Next
              </button>
            </div>
          </div>
        </div>

        <div className="xl:col-span-3 bg-white border border-gray-200 rounded-lg shadow-sm p-4 space-y-4">
          {!selectedRow && <div className="text-sm text-gray-500">Select a pill to manage medication guide content.</div>}

          {selectedRow && (
            <>
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-gray-900">{selectedRow.medicine_name || '(no name)'}</h2>
                <div className="text-xs text-gray-500">RxCUI: {selectedRow.rxcui || '—'} | NDC11: {selectedRow.ndc11 || '—'}</div>
              </div>

              <div className="border border-gray-200 rounded-md p-3 space-y-2">
                <label className="text-xs text-gray-600 font-medium">SPL Set ID</label>
                <div className="flex flex-col md:flex-row gap-2">
                  <input
                    className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm"
                    value={splSetIdInput}
                    onChange={(e) => setSplSetIdInput(e.target.value)}
                  />
                  <button type="button" className="px-3 py-2 rounded-md bg-amber-500 text-white text-sm" onClick={lookupSetId}>🔍 Lookup</button>
                  <button type="button" className="px-3 py-2 rounded-md bg-emerald-600 text-white text-sm" onClick={saveSetId}>💾 Save</button>
                </div>
              </div>

              <div className="border border-gray-200 rounded-md overflow-hidden">
                <div className="flex flex-wrap border-b border-gray-200 bg-gray-50">
                  {(Object.keys(TAB_LABELS) as TabKey[]).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActiveTab(tab)}
                      className={`px-4 py-2 text-sm border-r border-gray-200 ${activeTab === tab ? 'bg-white text-indigo-600 font-semibold' : 'text-gray-700'}`}
                    >
                      {TAB_LABELS[tab]} {STATUS_DOT(tabStatus[tab].ok)} ({tabStatus[tab].chars.toLocaleString()})
                    </button>
                  ))}
                </div>

                <div className="p-3 space-y-2">
                  <div className="flex gap-2 mb-2">
                    <button
                      type="button"
                      onClick={() => setViewMode('edit')}
                      className={`px-3 py-1 rounded-md text-sm border ${viewMode === 'edit' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300'}`}
                    >
                      ✏️ Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('preview')}
                      className={`px-3 py-1 rounded-md text-sm border ${viewMode === 'preview' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300'}`}
                    >
                      👁️ Preview
                    </button>
                  </div>
                  {viewMode === 'edit' ? (
                    <RichTextEditor
                      content={tabDrafts[activeTab]}
                      onChange={(html) => updateTabDraft(activeTab, html)}
                      placeholder={`Edit ${TAB_LABELS[activeTab]} HTML content...`}
                    />
                  ) : (
                    <div
                      className="prose prose-sm max-w-none p-4 border rounded bg-white min-h-[200px]"
                      dangerouslySetInnerHTML={{ __html: sanitizedPreviewHtml }}
                    />
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm"
                      onClick={() => refetchTarget(activeTab)}
                    >
                      🔄 Re-fetch
                    </button>
                    <button
                      type="button"
                      className="px-3 py-2 rounded-md bg-emerald-600 text-white text-sm"
                      onClick={() => saveTab(activeTab)}
                    >
                      💾 Save
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="px-3 py-2 rounded-md bg-indigo-600 text-white text-sm"
                  onClick={() => refetchTarget('all')}
                >
                  🔄 Re-fetch All
                </button>
                <button
                  type="button"
                  className="px-3 py-2 rounded-md bg-red-600 text-white text-sm"
                  onClick={clearCache}
                >
                  🗑️ Clear Cache
                </button>
                {loadingStatus && <span className="text-xs text-gray-500 self-center">Refreshing status…</span>}
              </div>

              {status?.source_url && (
                <a
                  href={status.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-indigo-600 hover:underline"
                >
                  Source: {status.source_url}
                </a>
              )}
            </>
          )}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900">Summary stats (current result set)</h3>
        <div className="mt-2 text-sm text-gray-700 flex flex-wrap gap-4">
          <span>Total pills: <strong>{total.toLocaleString()}</strong></span>
          <span>Missing SPL Set ID: <strong>{missingSetIdCount.toLocaleString()}</strong></span>
          <span>Missing professional: <strong>{missingProfessionalCount.toLocaleString()}</strong></span>
        </div>
      </div>
    </div>
  )
}
