import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Button from '../components/Button'
import Card from '../components/Card'
import Chip, { ChipRow, ColorDot } from '../components/Chip'
import Disclaimer from '../components/Disclaimer'
import EmptyState from '../components/EmptyState'
import ErrorCard from '../components/ErrorCard'
import { SearchIcon } from '../components/Icons'
import PillRow from '../components/PillRow'
import ScreenHeader from '../components/ScreenHeader'
import SegmentedControl from '../components/SegmentedControl'
import { ListSkeleton } from '../components/Skeleton'
import TextField from '../components/TextField'
import { ApiError, getFilters, search, type FiltersResponse, type SearchResult } from '../lib/api'
import { useDebouncedValue } from '../lib/hooks'
import { hideKeyboard } from '../lib/native'
import { addRecent, newId } from '../lib/storage'

type Mode = 'imprint' | 'drug' | 'ndc'

const MODES = [
  { value: 'imprint', label: 'Imprint' },
  { value: 'drug', label: 'Drug name' },
  { value: 'ndc', label: 'NDC' },
] as const

const PLACEHOLDER: Record<Mode, string> = {
  imprint: 'Imprint, e.g. S 10',
  drug: 'Drug name, e.g. Lisinopril',
  ndc: 'NDC, e.g. 0093-1174-01',
}

const PER_PAGE = 25

function isMode(v: string | null): v is Mode {
  return v === 'imprint' || v === 'drug' || v === 'ndc'
}

export default function SearchScreen({ active = true }: { active?: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()

  const [mode, setMode] = useState<Mode>(() => (isMode(params.get('type')) ? (params.get('type') as Mode) : 'imprint'))
  const [q, setQ] = useState(() => params.get('q') ?? '')
  const [color, setColor] = useState(() => params.get('color') ?? '')
  const [shape, setShape] = useState(() => params.get('shape') ?? '')
  const debouncedQ = useDebouncedValue(q, 300)

  const [filters, setFilters] = useState<FiltersResponse>({ colors: [], shapes: [] })
  const [results, setResults] = useState<SearchResult[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [fallbackTerm, setFallbackTerm] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const lastSavedRef = useRef<string>('')
  // The last query string this screen wrote to the URL; anything else in the
  // URL came from outside (deep link, Recent) and is adopted as new state.
  const writtenRef = useRef<string | null>(null)
  const justActivatedRef = useRef(false)

  useEffect(() => {
    const ctrl = new AbortController()
    getFilters(ctrl.signal)
      .then(setFilters)
      .catch(() => {})
    return () => ctrl.abort()
  }, [])

  const activeQuery = debouncedQ.trim()
  const hasFilters = mode === 'imprint' && Boolean(color || shape)
  const hasSearch = activeQuery.length > 0 || hasFilters

  // Keep the URL in sync so the tab is deep-link friendly (only while this tab is showing:
  // the screen stays mounted behind other tabs and must not touch their URLs).
  useEffect(() => {
    if (!active) return
    const next = new URLSearchParams()
    if (activeQuery) next.set('q', activeQuery)
    if (mode !== 'imprint') next.set('type', mode)
    if (mode === 'imprint' && color) next.set('color', color)
    if (mode === 'imprint' && shape) next.set('shape', shape)
    const str = next.toString()
    if (str !== params.toString()) {
      writtenRef.current = str
      setParams(next, { replace: true })
    }
  }, [active, activeQuery, mode, color, shape, params, setParams])

  // Becoming the active tab: the tab bar links to a bare /search, so re-apply our own state.
  useEffect(() => {
    if (active) justActivatedRef.current = true
  }, [active])

  // URL changed from outside (pillseek.com/search?q=… link, Recent → "Run search again"): adopt it.
  useEffect(() => {
    if (!active) return
    if (justActivatedRef.current) {
      justActivatedRef.current = false
      return
    }
    const str = params.toString()
    if (str === writtenRef.current) return
    if (!str) return // bare /search from the tab bar: keep what the user had
    const t = params.get('type')
    setMode(isMode(t) ? t : 'imprint')
    setQ(params.get('q') ?? '')
    setColor(params.get('color') ?? '')
    setShape(params.get('shape') ?? '')
    writtenRef.current = str
  }, [active, params])

  const runSearch = useCallback(
    async (targetPage: number, append: boolean) => {
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      if (append) setLoadingMore(true)
      else {
        setLoading(true)
        setError(null)
      }
      try {
        const data = await search(
          {
            q: activeQuery,
            type: mode,
            color: mode === 'imprint' ? color || undefined : undefined,
            shape: mode === 'imprint' ? shape || undefined : undefined,
            page: targetPage,
            perPage: PER_PAGE,
          },
          ctrl.signal,
        )
        if (ctrl.signal.aborted) return
        setResults((prev) => (append ? [...prev, ...data.results] : data.results))
        setTotal(data.total)
        setPage(data.page)
        setTotalPages(data.total_pages)
        setFallbackTerm(data.fallback_used ? data.fallback_term : null)
      } catch (err) {
        if (ctrl.signal.aborted) return
        const e = err instanceof ApiError ? err : new ApiError('unknown', 'Search failed. Please try again.')
        if (e.kind === 'cancelled') return
        setError(e)
        if (!append) setResults([])
      } finally {
        if (!ctrl.signal.aborted) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [activeQuery, mode, color, shape],
  )

  useEffect(() => {
    if (!hasSearch) {
      abortRef.current?.abort()
      setResults([])
      setTotal(0)
      setError(null)
      setLoading(false)
      return
    }
    void runSearch(1, false)
  }, [hasSearch, runSearch])

  const saveToRecent = useCallback(
    (top: SearchResult | null) => {
      if (!hasSearch) return
      const key = `${mode}|${activeQuery}|${color}|${shape}`
      if (lastSavedRef.current === key) return
      lastSavedRef.current = key
      void addRecent({
        id: newId(),
        kind: 'search',
        at: Date.now(),
        query: activeQuery,
        type: mode,
        color: mode === 'imprint' && color ? color : null,
        shape: mode === 'imprint' && shape ? shape : null,
        total,
        topName: top?.drug_name ?? null,
        topSlug: top?.slug ?? null,
        topImage: top?.image_url ?? null,
      })
    },
    [hasSearch, mode, activeQuery, color, shape, total],
  )

  const openResult = (r: SearchResult) => {
    saveToRecent(r)
    if (r.slug) navigate(`/pill/${encodeURIComponent(r.slug)}`)
  }

  const changeMode = (m: Mode) => {
    setMode(m)
    setResults([])
    setError(null)
  }

  let content: React.ReactNode
  if (loading) {
    content = <ListSkeleton rows={5} />
  } else if (error) {
    content = <ErrorCard error={error} onRetry={() => void runSearch(1, false)} />
  } else if (!hasSearch) {
    content = (
      <Card padded={false}>
        <EmptyState
          art="search"
          title="Find a pill"
          body={
            mode === 'imprint'
              ? 'Type the letters or numbers printed on the pill, and narrow it down by colour and shape.'
              : mode === 'drug'
                ? 'Search by brand or generic drug name.'
                : 'Enter the National Drug Code from the packaging.'
          }
        />
      </Card>
    )
  } else if (results.length === 0) {
    content = (
      <Card padded={false}>
        <EmptyState
          art="pill"
          title="No results"
          body="Check the spelling, try fewer characters, or remove the colour and shape filters."
          action={
            hasFilters ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setColor('')
                  setShape('')
                }}
              >
                Clear filters
              </Button>
            ) : undefined
          }
        />
      </Card>
    )
  } else {
    content = (
      <div className="space-y-3">
        <p className="tabular px-1 text-[14px] text-muted">
          {total.toLocaleString()} {total === 1 ? 'result' : 'results'}
          {activeQuery && (
            <>
              {' '}
              for <span className="font-semibold text-ink">“{activeQuery}”</span>
            </>
          )}
        </p>
        {fallbackTerm && (
          <Card tone="tint" className="text-[14px] text-body">
            No exact name match — showing results for <span className="font-semibold text-ink">{fallbackTerm}</span> (generic equivalent).
          </Card>
        )}
        <div className="card divide-y divide-line overflow-hidden">
          {results.map((r, i) => (
            <PillRow
              key={`${r.slug ?? r.ndc ?? i}-${i}`}
              image={r.image_url}
              name={r.drug_name}
              strength={r.strength}
              imprint={r.imprint}
              color={r.color}
              shape={r.shape}
              onPress={() => openResult(r)}
            />
          ))}
        </div>
        {page < totalPages && (
          <Button full variant="secondary" loading={loadingMore} onClick={() => void runSearch(page + 1, true)}>
            Load more ({(total - results.length).toLocaleString()} left)
          </Button>
        )}
        <Disclaimer compact />
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto">
      <ScreenHeader title="Search" scrollRef={scrollRef}>
        <div className="space-y-3">
          <SegmentedControl label="Search type" options={MODES} value={mode} onChange={changeMode} />
          <TextField
            label={PLACEHOLDER[mode]}
            value={q}
            onChange={setQ}
            placeholder={PLACEHOLDER[mode]}
            leading={<SearchIcon size={20} />}
            type="search"
            inputMode={mode === 'ndc' ? 'numeric' : 'search'}
            autoCapitalize={mode === 'imprint' ? 'characters' : 'words'}
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void hideKeyboard()
                saveToRecent(results[0] ?? null)
              }
            }}
          />
          {mode === 'imprint' && filters.colors.length > 0 && (
            <div className="space-y-1.5">
              <ChipRow label="Colour">
                <Chip selected={color === ''} onClick={() => setColor('')}>
                  Any colour
                </Chip>
                {filters.colors.map((c) => (
                  <Chip key={c.name} selected={color === c.name} onClick={() => setColor(c.name)} leading={<ColorDot hex={c.hex} />}>
                    {c.name}
                  </Chip>
                ))}
              </ChipRow>
              <ChipRow label="Shape">
                <Chip selected={shape === ''} onClick={() => setShape('')}>
                  Any shape
                </Chip>
                {filters.shapes.map((s) => (
                  <Chip key={s.name} selected={shape === s.name} onClick={() => setShape(s.name)} leading={<span aria-hidden>{s.icon}</span>}>
                    {s.name}
                  </Chip>
                ))}
              </ChipRow>
            </div>
          )}
        </div>
      </ScreenHeader>
      <main className="screen mx-auto max-w-lg px-4 pt-2" style={{ paddingLeft: 'max(16px, var(--safe-left))', paddingRight: 'max(16px, var(--safe-right))' }}>
        {content}
      </main>
    </div>
  )
}
