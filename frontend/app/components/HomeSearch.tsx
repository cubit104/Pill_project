'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import SearchBar from './SearchBar'
import type { FiltersResponse } from '../types'

export default function HomeSearch() {
  const router = useRouter()
  const [filters, setFilters] = useState<FiltersResponse>({ colors: [], shapes: [] })
  const [filtersLoading, setFiltersLoading] = useState(true)

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
      } finally {
        setFiltersLoading(false)
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

  if (filtersLoading) {
    return (
      <div className="bg-white rounded-2xl shadow-xl p-6 animate-pulse">
        <div className="h-10 bg-slate-200 rounded-lg mb-4" />
        <div className="flex gap-3">
          <div className="h-10 bg-slate-200 rounded-lg flex-1" />
          <div className="h-10 bg-slate-200 rounded-lg flex-1" />
          <div className="h-10 bg-sky-200 rounded-lg w-24" />
        </div>
      </div>
    )
  }

  return (
    <SearchBar
      colors={filters.colors}
      shapes={filters.shapes}
      onSearch={handleSearch}
    />
  )
}
