import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Button from '../components/Button'
import Card from '../components/Card'
import Chip, { ChipRow, ColorDot } from '../components/Chip'
import Disclaimer from '../components/Disclaimer'
import EmptyState from '../components/EmptyState'
import ErrorCard from '../components/ErrorCard'
import { ChevronRightIcon, CloseIcon, SearchIcon } from '../components/Icons'
import PillRow, { PillThumb, titleCase } from '../components/PillRow'
import ScreenHeader from '../components/ScreenHeader'
import SegmentedControl from '../components/SegmentedControl'
import Sheet from '../components/Sheet'
import { ListSkeleton } from '../components/Skeleton'
import TextField from '../components/TextField'
import { ApiError, getFilters, search, type FiltersResponse, type SearchResult } from '../lib/api'
import { groupByDrug, strengthLabel, type DrugGroup } from '../lib/drugGroups'
import { GOALS, goalPillPath, isGoal, type Goal } from '../lib/goals'
import { useDebouncedValue } from '../lib/hooks'
import { hapticTick, hideKeyboard } from '../lib/native'
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
  // Set by Home tiles ("Side effects", "Dosage"…): a result opens straight at that section.
  const [goal, setGoal] = useState<Goal | null>(() => (isGoal(params.get('goal')) ? (params.get('goal') as Goal) : null))
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
  const inputRef = useRef<HTMLInputElement>(null)
  // Drug with several strengths tapped in drug/NDC mode: pick one in a sheet.
  const [picker, setPicker] = useState<DrugGroup | null>(null)
  const lastSavedRef = useRef<string>('')
  // The last query string this screen wrote to the URL; anything else in the
  // URL came from outside (deep link, Recent) and is adopted as new state.
  const writtenRef = useRef<string | null>(null)

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

  // URL changed from outside (Home tile, pillseek.com/search?q=… link, Recent → "Run search
  // again"): adopt it *during render* so the sync effect below sees the new state and never
  // overwrites the incoming URL with stale state. A bare /search (tab bar) keeps what the user had.
  const incoming = params.toString()
  if (active && incoming && incoming !== writtenRef.current) {
    writtenRef.current = incoming
    const t = params.get('type')
    setMode(isMode(t) ? t : 'imprint')
    setQ(params.get('q') ?? '')
    setColor(params.get('color') ?? '')
    setShape(params.get('shape') ?? '')
    setGoal(isGoal(params.get('goal')) ? (params.get('goal') as Goal) : null)
  }

  // Keep the URL in sync so the tab is deep-link friendly (only while this tab is showing:
  // the screen stays mounted behind other tabs and must not touch their URLs).
  const debounceSettled = q.trim() === activeQuery
  useEffect(() => {
    if (!active || !debounceSettled) return
    const next = new URLSearchParams()
    if (activeQuery) next.set('q', activeQuery)
    if (mode !== 'imprint') next.set('type', mode)
    if (mode === 'imprint' && color) next.set('color', color)
    if (mode === 'imprint' && shape) next.set('shape', shape)
    if (goal) next.set('goal', goal)
    const str = next.toString()
    if (str !== params.toString()) {
      writtenRef.current = str
      setParams(next, { replace: true })
    }
  }, [active, debounceSettled, activeQuery, mode, color, shape, goal, params, setParams])

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

  // iOS keeps the keyboard up while the input has focus: blur first, then ask natively.
  const dismissKeyboard = () => {
    inputRef.current?.blur()
    void hideKeyboard()
  }

  const openResult = (r: SearchResult) => {
    dismissKeyboard()
    setPicker(null)
    saveToRecent(r)
    if (r.slug) navigate(goalPillPath(r.slug, goal))
    // The goal banner has done its job once a result is opened.
    if (goal) setGoal(null)
  }

  const openGroup = (g: DrugGroup) => {
    void hapticTick()
    const first = g.items[0]
    if (!first) return
    // One pill, or a per-drug section (same label for every strength): open straight away.
    if (g.items.length === 1 || goal) openResult(first)
    else {
      dismissKeyboard()
      setPicker(g)
    }
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
          {mode === 'imprint'
            ? results.map((r, i) => (
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
              ))
            : groupByDrug(results).map((g) => (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => openGroup(g)}
                  className="pressable flex min-h-[60px] w-full items-center gap-3 px-4 py-3 text-left active:bg-brand-tint"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[17px] font-semibold text-ink">{g.name}</span>
                    {g.generic && <span className="block truncate text-[14px] text-muted">{g.generic}</span>}
                    {g.strengths.length > 0 && (
                      <span className="mt-0.5 block truncate text-[14px] text-body">
                        {g.strengths.join(' · ')}
                        {g.items.length > 1 && <span className="text-muted"> · {g.items.length} pills</span>}
                      </span>
                    )}
                  </span>
                  <ChevronRightIcon size={20} className="flex-none text-muted" />
                </button>
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
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto"
      onTouchStart={(e) => {
        // Touching the results (not the sticky header) drops the keyboard.
        if (document.activeElement === inputRef.current && !(e.target as HTMLElement).closest('header')) dismissKeyboard()
      }}
    >
      <ScreenHeader title="Search" scrollRef={scrollRef}>
        <div className="space-y-3">
          <SegmentedControl label="Search type" options={MODES} value={mode} onChange={changeMode} />
          <TextField
            ref={inputRef}
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
                dismissKeyboard()
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
        {goal && (
          <Card tone="tint" className="mb-3 flex items-center gap-3 !py-2.5" role="status">
            <span className="min-w-0 flex-1 text-[14px] text-body">
              <span className="font-semibold text-ink">{GOALS[goal].label}:</span> {GOALS[goal].prompt}.
            </span>
            <button
              type="button"
              onClick={() => setGoal(null)}
              aria-label={`Stop looking for ${GOALS[goal].label.toLowerCase()}`}
              className="pressable -mr-1 flex h-9 w-9 flex-none items-center justify-center rounded-full text-muted"
            >
              <CloseIcon size={16} />
            </button>
          </Card>
        )}
        {content}
      </main>
      <Sheet open={picker !== null} onClose={() => setPicker(null)} title={picker?.name}>
        {picker && (
          <div className="-mx-2 divide-y divide-line">
            {picker.items.map((r, i) => (
              <button
                key={`${r.slug ?? r.ndc ?? i}-${i}`}
                type="button"
                onClick={() => openResult(r)}
                className="pressable flex min-h-[64px] w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left active:bg-brand-tint"
              >
                <PillThumb src={r.image_url} alt="" size={48} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[17px] font-semibold text-ink">{strengthLabel(r.strength) ?? r.drug_name}</span>
                  <span className="block truncate text-[14px] text-muted">
                    {[r.imprint ? `Imprint ${r.imprint}` : null, [r.color, r.shape].filter(Boolean).map((x) => titleCase(String(x))).join(' · ') || null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <ChevronRightIcon size={20} className="flex-none text-muted" />
              </button>
            ))}
          </div>
        )}
      </Sheet>
    </div>
  )
}
