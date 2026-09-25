'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { DrugIndex } from '../lib/iv'
import { indexEntryOptions, indexPrefix, matchOptions, type SearchOption } from '../lib/drug-search'

const CLOSE_DELAY_MS = 150
const DEBOUNCE_MS = 150

/**
 * Search box with a live dropdown for the A to Z pages. Given `options` (the IV list, already on the page) it
 * filters them as you type; without, it asks the drug index for the first letters typed, so a drug added
 * a minute ago is already there.
 */
export default function DrugNameSearch({ label, placeholder, options }: { label: string; placeholder: string; options?: SearchOption[] }) {
  const router = useRouter()
  const listId = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const [indexOptions, setIndexOptions] = useState<SearchOption[]>([])
  const [loading, setLoading] = useState(false)
  const byPrefix = useRef(new Map<string, SearchOption[]>())
  const latestPrefix = useRef<string | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // index mode: one request per first-letters, kept for the visit
  useEffect(() => {
    if (options) return
    const prefix = indexPrefix(query)
    latestPrefix.current = prefix
    const known = prefix ? byPrefix.current.get(prefix) : []
    if (known) {
      setIndexOptions(known)
      setLoading(false)
      return
    }
    setLoading(true) // "Searching…" rather than a flash of "no match" while the first letters are looked up
    const timer = setTimeout(async () => {
      if (!prefix) return
      try {
        // not from the browser's cache: the index says an hour, but a drug published a minute ago must show
        const res = await fetch(`/api/drug-index?prefix=${encodeURIComponent(prefix)}`, { cache: 'no-store' })
        const data: DrugIndex | null = res.ok ? await res.json() : null
        const found = indexEntryOptions(data?.entries ?? [])
        byPrefix.current.set(prefix, found)
        if (latestPrefix.current === prefix) setIndexOptions(found)
      } catch {
        if (latestPrefix.current === prefix) setIndexOptions([])
      } finally {
        if (latestPrefix.current === prefix) setLoading(false)
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, options])

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])

  const results = useMemo(() => matchOptions(options ?? indexOptions, query), [options, indexOptions, query])
  const typed = query.trim().length > 0
  const showList = open && typed

  const go = (option: SearchOption) => {
    setOpen(false)
    setHighlighted(-1)
    router.push(option.href)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setHighlighted((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted((i) => Math.max(i - 1, -1))
    } else if (e.key === 'Enter') {
      const pick = results[highlighted >= 0 ? highlighted : 0]
      if (pick) {
        e.preventDefault()
        go(pick)
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="no-print relative max-w-xl">
      <label htmlFor={`${listId}-input`} className="mb-1.5 block text-sm font-semibold text-slate-700">
        {label}
      </label>
      <div className="relative">
        <svg className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 103.5 10.5a7.5 7.5 0 0013.15 6.15z" />
        </svg>
        <input
          id={`${listId}-input`}
          type="search"
          role="combobox"
          autoComplete="off"
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            setHighlighted(-1)
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            if (closeTimer.current) clearTimeout(closeTimer.current)
            closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS)
          }}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={showList && results.length > 0}
          aria-activedescendant={showList && results[highlighted] ? `${listId}-option-${highlighted}` : undefined}
          className="w-full rounded-lg border border-slate-300 bg-white py-3 pl-10 pr-4 text-base text-slate-900 placeholder-slate-400 shadow-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      </div>
      {showList && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          {results.length > 0 ? (
            <ul id={listId} role="listbox" className="max-h-80 overflow-y-auto">
              {results.map((option, index) => (
                <li
                  key={`${option.href}-${index}`}
                  id={`${listId}-option-${index}`}
                  role="option"
                  aria-selected={index === highlighted}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    go(option)
                  }}
                  onMouseEnter={() => setHighlighted(index)}
                  className={`flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-sm ${index === highlighted ? 'bg-emerald-50 text-emerald-800' : 'text-slate-800'}`}
                >
                  <span className="min-w-0">
                    <span className="font-medium">{option.label}</span>
                    {option.note && <span className="text-slate-500"> · {option.note}</span>}
                  </span>
                  {option.badge && (
                    <span className="shrink-0 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">{option.badge}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-3 text-sm text-slate-600">
              {loading ? (
                'Searching…'
              ) : (
                <>
                  No drug matches that.{' '}
                  <Link href={`/search?q=${encodeURIComponent(query.trim())}&type=drug&page=1`} className="font-semibold text-emerald-700 hover:underline">
                    Search all pills for “{query.trim()}”
                  </Link>
                </>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
