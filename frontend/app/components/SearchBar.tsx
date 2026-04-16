'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { FilterOption } from '../types'

interface SearchBarProps {
  colors: FilterOption[]
  shapes: FilterOption[]
  onSearch: (params: { q: string; type: string; color?: string; shape?: string }) => void
  initialValues?: {
    q?: string
    type?: string
    color?: string
    shape?: string
  }
}

type SearchType = 'imprint' | 'drug' | 'ndc'

const SUGGESTION_CLOSE_DELAY_MS = 150

const TABS: { id: SearchType; label: string; placeholder: string }[] = [
  { id: 'imprint', label: 'Imprint', placeholder: 'e.g. L484, M 366, Watson 540' },
  { id: 'drug', label: 'Drug Name', placeholder: 'e.g. Ibuprofen, Lisinopril' },
  { id: 'ndc', label: 'NDC', placeholder: 'e.g. 00093-0058' },
]

export default function SearchBar({ colors, shapes, onSearch, initialValues }: SearchBarProps) {
  const [activeTab, setActiveTab] = useState<SearchType>(
    (initialValues?.type as SearchType) || 'imprint'
  )
  const [query, setQuery] = useState(initialValues?.q || '')
  const [color, setColor] = useState(initialValues?.color || '')
  const [shape, setShape] = useState(initialValues?.shape || '')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const suggestionsRef = useRef<HTMLUListElement>(null)

  const fetchSuggestions = useCallback(
    async (q: string, type: SearchType) => {
      if (q.length < 2) {
        setSuggestions([])
        return
      }
      try {
        const res = await fetch(
          `/suggestions?q=${encodeURIComponent(q)}&type=${type}`
        )
        if (res.ok) {
          const data: string[] = await res.json()
          setSuggestions(data.slice(0, 8))
        }
      } catch {
        setSuggestions([])
      }
    },
    []
  )

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fetchSuggestions(query, activeTab)
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, activeTab, fetchSuggestions])

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current)
    }
  }, [])

  const handleSubmit = () => {
    setShowSuggestions(false)
    onSearch({ q: query, type: activeTab, color: color || undefined, shape: shape || undefined })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (highlightedIndex >= 0 && suggestions[highlightedIndex]) {
        setQuery(suggestions[highlightedIndex])
        setShowSuggestions(false)
        setHighlightedIndex(-1)
      } else {
        handleSubmit()
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex((prev) => Math.min(prev + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex((prev) => Math.max(prev - 1, -1))
    } else if (e.key === 'Escape') {
      setShowSuggestions(false)
    }
  }

  const handleTabChange = (tab: SearchType) => {
    setActiveTab(tab)
    setQuery('')
    setSuggestions([])
    setShowSuggestions(false)
    inputRef.current?.focus()
  }

  return (
    <div className="bg-white rounded-2xl shadow-xl p-6 text-left">
      {/* Tabs */}
      <div className="flex border-b border-slate-200 mb-4" role="tablist" aria-label="Search type">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-1 ${
              activeTab === tab.id
                ? 'border-sky-600 text-sky-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search Input */}
      <div className="relative mb-4">
        <label htmlFor="search-input" className="sr-only">
          {TABS.find((t) => t.id === activeTab)?.label} search
        </label>
        <input
          id="search-input"
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setShowSuggestions(true)
            setHighlightedIndex(-1)
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (suggestions.length > 0) setShowSuggestions(true)
          }}
          onBlur={() => {
            // Delay to allow click on suggestion; timeout is cleaned up on unmount
            if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current)
            blurTimeoutRef.current = setTimeout(() => setShowSuggestions(false), SUGGESTION_CLOSE_DELAY_MS)
          }}
          placeholder={TABS.find((t) => t.id === activeTab)?.placeholder}
          className="w-full border border-slate-300 rounded-lg px-4 py-3 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent text-base"
          aria-autocomplete="list"
          aria-controls="suggestions-list"
          aria-expanded={showSuggestions && suggestions.length > 0}
        />
        {showSuggestions && suggestions.length > 0 && (
          <ul
            id="suggestions-list"
            ref={suggestionsRef}
            role="listbox"
            className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto"
          >
            {suggestions.map((suggestion, index) => (
              <li
                key={suggestion}
                role="option"
                aria-selected={index === highlightedIndex}
                onMouseDown={() => {
                  setQuery(suggestion)
                  setShowSuggestions(false)
                  setHighlightedIndex(-1)
                }}
                className={`px-4 py-2.5 text-sm cursor-pointer transition-colors ${
                  index === highlightedIndex
                    ? 'bg-sky-50 text-sky-700'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                {suggestion}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Filters Row */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
        {/* Color Filter */}
        <div className="flex-1">
          <label htmlFor="color-filter" className="sr-only">Filter by color</label>
          <select
            id="color-filter"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
            aria-label="Filter by color"
          >
            <option value="">Any Color</option>
            {colors.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Shape Filter */}
        <div className="flex-1">
          <label htmlFor="shape-filter" className="sr-only">Filter by shape</label>
          <select
            id="shape-filter"
            value={shape}
            onChange={(e) => setShape(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
            aria-label="Filter by shape"
          >
            <option value="">Any Shape</option>
            {shapes.map((s) => (
              <option key={s.name} value={s.name}>
                {s.icon ? `${s.icon} ` : ''}{s.name}
              </option>
            ))}
          </select>
        </div>

        {/* Search Button */}
        <button
          onClick={handleSubmit}
          className="bg-sky-600 hover:bg-sky-700 text-white font-semibold px-6 py-2.5 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 whitespace-nowrap"
          aria-label="Search for pills"
        >
          🔍 Search
        </button>
      </div>
    </div>
  )
}
