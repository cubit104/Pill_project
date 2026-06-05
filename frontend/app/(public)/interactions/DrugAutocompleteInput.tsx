'use client'

import { useEffect, useRef, useState } from 'react'

type DrugAutocompleteInputProps = {
  value: string
  onChange: (value: string) => void
  onSelect: (value: string) => void
  placeholder?: string
  id?: string
  disabled?: boolean
  className?: string
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || ''
const SUGGESTIONS_LIMIT = 8
const DEBOUNCE_MS = 200
const BLUR_DELAY_MS = 150

function buildApiUrl(path: string): string {
  return API_BASE ? `${API_BASE}${path}` : path
}

export default function DrugAutocompleteInput({
  value,
  onChange,
  onSelect,
  placeholder = 'Enter a drug name...',
  id,
  disabled = false,
  className = '',
}: DrugAutocompleteInputProps) {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const trimmed = value.trim()
    if (trimmed.length < 2) {
      setSuggestions([])
      setOpen(false)
      return
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          buildApiUrl(`/api/interactions/suggestions?q=${encodeURIComponent(trimmed)}&limit=${SUGGESTIONS_LIMIT}`)
        )
        if (!res.ok) return
        const data = await res.json() as string[]
        setSuggestions(Array.isArray(data) ? data : [])
        setOpen(Array.isArray(data) && data.length > 0)
        setHighlighted(-1)
      } catch {
        // silently ignore
      }
    }, DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [value])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted((prev) => Math.min(prev + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted((prev) => Math.max(prev - 1, -1))
    } else if (e.key === 'Enter' && highlighted >= 0) {
      e.preventDefault()
      onSelect(suggestions[highlighted])
      setOpen(false)
      setSuggestions([])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const handleBlur = () => {
    setTimeout(() => {
      setOpen(false)
    }, BLUR_DELAY_MS)
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
      />
      {open && suggestions.length > 0 && (
        <ul
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-md"
          role="listbox"
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion}
              role="option"
              aria-selected={highlighted === index}
              onMouseDown={() => {
                onSelect(suggestion)
                setOpen(false)
                setSuggestions([])
              }}
              onMouseEnter={() => setHighlighted(index)}
              className={`cursor-pointer px-3 py-2 text-sm text-slate-800 ${
                highlighted === index ? 'bg-emerald-50 text-emerald-900' : 'hover:bg-slate-50'
              }`}
            >
              {suggestion}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
