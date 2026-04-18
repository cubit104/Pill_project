'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import SearchBar from './SearchBar'
import type { FiltersResponse } from '../types'

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
