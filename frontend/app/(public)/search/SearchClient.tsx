'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import SearchBar from '../../components/SearchBar'
import PillCard from '../../components/PillCard'
import type { PillResult, SearchResponse, FiltersResponse } from '../../types'

function SkeletonCard() {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 animate-pulse">
      <div className="w-20 h-20 bg-slate-200 rounded-lg mx-auto mb-4" />
      <div className="h-4 bg-slate-200 rounded mb-2" />
      <div className="h-3 bg-slate-100 rounded mb-3 w-2/3" />
      <div className="flex gap-2">
        <div className="h-5 bg-slate-100 rounded-full w-16" />
        <div className="h-5 bg-slate-100 rounded-full w-16" />
      </div>
    </div>
  )
}

function SearchPageInner() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const q = searchParams.get('q') || ''
  const type = searchParams.get('type') || 'imprint'
  const color = searchParams.get('color') || ''
  const shape = searchParams.get('shape') || ''
  const page = parseInt(searchParams.get('page') || '1', 10)

  const [results, setResults] = useState<PillResult[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState<FiltersResponse>({ colors: [], shapes: [] })

  // Fetch filters once
  useEffect(() => {
    const fetchFilters = async () => {
      try {
        const res = await fetch('/filters')
        if (res.ok) {
          const data: FiltersResponse = await res.json()
          setFilters(data)
        }
      } catch {
        // Filters are optional
      }
    }
    fetchFilters()
  }, [])

  // Fetch results when params change
  useEffect(() => {
    if (!q && !color && !shape) return

    const fetchResults = async () => {
      setLoading(true)
      setError('')
      try {
        const params = new URLSearchParams()
        if (q) params.set('q', q)
        params.set('type', type)
        if (color) params.set('color', color)
        if (shape) params.set('shape', shape)
        params.set('page', String(page))
        params.set('per_page', '25')

        const res = await fetch(`/api/search?${params.toString()}`)
        if (!res.ok) throw new Error(`Search failed: ${res.status}`)
        const data: SearchResponse = await res.json()
        setResults(data.results)
        setTotal(data.total)
        setTotalPages(data.total_pages)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Search failed. Please try again.')
        setResults([])
      } finally {
        setLoading(false)
      }
    }
    fetchResults()
  }, [q, type, color, shape, page])

  const handleSearch = (params: { q: string; type: string; color?: string; shape?: string }) => {
    const urlParams = new URLSearchParams()
    if (params.q) urlParams.set('q', params.q)
    urlParams.set('type', params.type)
    if (params.color) urlParams.set('color', params.color)
    if (params.shape) urlParams.set('shape', params.shape)
    urlParams.set('page', '1')
    router.push(`/search?${urlParams.toString()}`)
  }

  const goToPage = (newPage: number) => {
    const urlParams = new URLSearchParams()
    if (q) urlParams.set('q', q)
    urlParams.set('type', type)
    if (color) urlParams.set('color', color)
    if (shape) urlParams.set('shape', shape)
    urlParams.set('page', String(newPage))
    router.push(`/search?${urlParams.toString()}`)
  }

  const hasSearch = !!(q || color || shape)

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Search Bar */}
      <div className="mb-8">
        <SearchBar
          colors={filters.colors}
          shapes={filters.shapes}
          onSearch={handleSearch}
          initialValues={{ q, type, color, shape }}
        />
      </div>

      {/* Results Header */}
      {hasSearch && !loading && !error && (
        <div className="mb-6 flex items-center justify-between flex-wrap gap-2">
          <p className="text-slate-600 text-sm">
            {total > 0 ? (
              <>
                Showing <strong>{(page - 1) * 25 + 1}–{Math.min(page * 25, total)}</strong> of{' '}
                <strong>{total.toLocaleString()}</strong> results
                {q && <> for <em>&ldquo;{q}&rdquo;</em></>}
              </>
            ) : (
              <>No results found</>
            )}
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-center mb-6">
          <p className="text-red-700 font-medium">{error}</p>
          <p className="text-red-500 text-sm mt-1">Please try a different search term.</p>
        </div>
      )}

      {/* Loading Skeletons */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {/* No Results */}
      {!loading && hasSearch && !error && results.length === 0 && (
        <div className="text-center py-16">
          <div className="text-5xl mb-4" role="img" aria-label="Search">🔍</div>
          <h2 className="text-xl font-semibold text-slate-800 mb-2">No results found</h2>
          <p className="text-slate-600 text-sm max-w-md mx-auto mb-4">
            Try modifying your search: check the spelling, try a different search type,
            or remove color/shape filters.
          </p>
          <button
            onClick={() => router.push('/')}
            className="bg-sky-600 hover:bg-sky-700 text-white font-medium px-5 py-2 rounded-lg transition-colors text-sm"
          >
            Start New Search
          </button>
        </div>
      )}

      {/* Empty State (no search yet) */}
      {!loading && !hasSearch && !error && (
        <div className="text-center py-16">
          <div className="text-5xl mb-4" role="img" aria-label="Pill">💊</div>
          <h2 className="text-xl font-semibold text-slate-800 mb-2">
            Enter a search above to find pills
          </h2>
          <p className="text-slate-600 text-sm">
            Search by imprint code, drug name, or NDC number.
          </p>
        </div>
      )}

      {/* Results Grid */}
      {!loading && results.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {results.map((pill, idx) => (
              <PillCard key={pill.ndc || pill.imprint || idx} pill={pill} />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-8 flex items-center justify-center gap-3">
              <button
                onClick={() => goToPage(page - 1)}
                disabled={page <= 1}
                className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
                aria-label="Previous page"
              >
                ← Prev
              </button>
              <span className="text-sm text-slate-600">
                Page <strong>{page}</strong> of <strong>{totalPages}</strong>
              </span>
              <button
                onClick={() => goToPage(page + 1)}
                disabled={page >= totalPages}
                className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
                aria-label="Next page"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function SearchClient() {
  return (
    <Suspense fallback={
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    }>
      <SearchPageInner />
    </Suspense>
  )
}
