'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import type { FiltersResponse } from '../types'

const SearchBar = dynamic(() => import('./SearchBar'), {
  ssr: false,
  loading: () => (
    <div
      className="bg-emerald-50 rounded-2xl shadow-xl p-6 text-left border border-emerald-200 min-h-[252px]"
      aria-hidden="true"
    >
      <div className="h-6 w-56 rounded bg-emerald-100 mb-4" />
      <div className="h-11 w-full rounded-lg bg-white border border-slate-200 mb-4" />
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="h-10 flex-1 rounded-lg bg-white border border-slate-200" />
        <div className="h-10 flex-1 rounded-lg bg-white border border-slate-200" />
        <div className="h-10 w-full sm:w-28 rounded-lg bg-emerald-700/20" />
      </div>
    </div>
  ),
})

export default function HomeSearch() {
  const router = useRouter()
  const [filters, setFilters] = useState<FiltersResponse>({ colors: [], shapes: [] })
  useEffect(() => {
    const fetchFilters = async () => {
      try {
        const res = await fetch('/filters')
        if (res.ok) {
          const data: FiltersResponse = await res.json()
          setFilters(data)
        }
      } catch {
        // Silently fail — search still works without filter options
      }
    }
    fetchFilters()
  }, [])

  const handleSearch = (params: {
    q: string
    type: string
    color?: string
    shape?: string
  }) => {
    const urlParams = new URLSearchParams()
    if (params.q) urlParams.set('q', params.q)
    urlParams.set('type', params.type)
    if (params.color) urlParams.set('color', params.color)
    if (params.shape) urlParams.set('shape', params.shape)
    urlParams.set('page', '1')
    router.push(`/search?${urlParams.toString()}`)
  }

  return (
    <SearchBar
      colors={filters.colors}
      shapes={filters.shapes}
      onSearch={handleSearch}
    />
  )
}
