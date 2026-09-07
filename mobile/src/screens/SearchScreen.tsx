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
import { ListSkeleton, Skeleton } from '../components/Skeleton'
import TextField from '../components/TextField'
import {
  ApiError,
  getDrugPills,
  getFilters,
  lookupDrugs,
  search,
  suggestDrugs,
  suggestImprints,
  suggestNdc,
  type DrugRow,
  type FiltersResponse,
  type NdcSuggestion,
  type SearchResult,
} from '../lib/api'
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

/** Bottom sheet state for the drug → strength → pill flow. */
type Picker =
  | { kind: 'strengths'; drug: DrugRow }
  | { kind: 'pills'; drug: DrugRow; strength: string | null; pills: SearchResult[]; loading: boolean; error: ApiError | null }

function DrugRowButton({ drug, onPress, compact = false }: { drug: DrugRow; onPress: () => void; compact?: boolean }) {
  const sub = [drug.brand_names && drug.brand_names.toLowerCase() !== drug.name.toLowerCase() ? drug.brand_names : null, drug.ingredients && drug.ingredients.toLowerCase() !== drug.name.toLowerCase() ? titleCase(drug.ingredients) : null]
    .filter(Boolean)
    .join(' · ')
  return (
    <button
      type="button"
      onClick={onPress}
      className={`pressable flex w-full items-center gap-3 px-4 text-left active:bg-brand-tint ${compact ? 'min-h-[48px] py-2' : 'min-h-[60px] py-3'}`}
    >
      {!compact && <PillThumb src={drug.image_url} alt="" size={48} />}
      <span className="min-w-0 flex-1">
        <span className={`block truncate font-semibold text-ink ${compact ? 'text-[16px]' : 'text-[17px]'}`}>{drug.name}</span>
        {!compact && sub && <span className="block truncate text-[14px] text-muted">{sub}</span>}
        {drug.strengths.length > 0 && (
          <span className={`block truncate text-body ${compact ? 'text-[13px]' : 'mt-0.5 text-[14px]'}`}>
            {drug.strengths.join(' · ')}
            {drug.pill_count > 1 && <span className="text-muted"> · {drug.pill_count} pills</span>}
          </span>
        )}
      </span>
      <ChevronRightIcon size={20} className="flex-none text-muted" />
    </button>
  )
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
  const suggestQ = useDebouncedValue(q, 150)

  const [filters, setFilters] = useState<FiltersResponse>({ colors: [], shapes: [] })
  const [results, setResults] = useState<SearchResult[]>([])
  const [drugs, setDrugs] = useState<DrugRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [fallbackTerm, setFallbackTerm] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)
  const [drugSuggestions, setDrugSuggestions] = useState<DrugRow[]>([])
  const [ndcSuggestions, setNdcSuggestions] = useState<NdcSuggestion[]>([])
  const [imprintSuggestions, setImprintSuggestions] = useState<string[]>([])
  const [picker, setPicker] = useState<Picker | null>(null)
  const pickerAbort = useRef<AbortController | null>(null)
  const lastSavedRef = useRef<string>('')
  // URL bookkeeping. `seenRef` is the last query string this screen accepted as its own
  // (adopted or written). When we write a new one, the router updates asynchronously:
  // `pendingRef` is what we asked for and `staleRef` the URL that was current at that
  // moment, which must be ignored until the pending one lands (or a clear would refill).
  const seenRef = useRef<string>(params.toString())
  const pendingRef = useRef<string | null>(null)
  const staleRef = useRef<string | null>(null)

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
  if (pendingRef.current !== null && incoming === pendingRef.current) {
    // Our own write has landed.
    pendingRef.current = null
    staleRef.current = null
    seenRef.current = incoming
  } else if (active && incoming !== seenRef.current && incoming !== staleRef.current) {
    seenRef.current = incoming
    if (incoming) {
      const t = params.get('type')
      setMode(isMode(t) ? t : 'imprint')
      setQ(params.get('q') ?? '')
      setColor(params.get('color') ?? '')
      setShape(params.get('shape') ?? '')
      setGoal(isGoal(params.get('goal')) ? (params.get('goal') as Goal) : null)
    }
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
      staleRef.current = params.toString()
      pendingRef.current = str
      setParams(next, { replace: true })
    }
  }, [active, debounceSettled, activeQuery, mode, color, shape, goal, params, setParams])

  // Live suggestions under the field (drug names, or NDC codes with names).
  useEffect(() => {
    const term = suggestQ.trim()
    if (term.length < 2) {
      setDrugSuggestions([])
      setNdcSuggestions([])
      setImprintSuggestions([])
      return
    }
    const ctrl = new AbortController()
    if (mode === 'imprint') {
      suggestImprints(term, ctrl.signal)
        .then((s) => !ctrl.signal.aborted && setImprintSuggestions(s.filter((x) => x.toUpperCase() !== term.toUpperCase())))
        .catch(() => {})
    } else if (mode === 'drug') {
      suggestDrugs(term, ctrl.signal)
        .then((s) => !ctrl.signal.aborted && setDrugSuggestions(s))
        .catch(() => {})
    } else {
      suggestNdc(term, ctrl.signal)
        .then((s) => !ctrl.signal.aborted && setNdcSuggestions(s))
        .catch(() => {})
    }
    return () => ctrl.abort()
  }, [mode, suggestQ])

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
        if (mode === 'drug') {
          const data = await lookupDrugs(activeQuery, targetPage, ctrl.signal)
          if (ctrl.signal.aborted) return
          setDrugs((prev) => (append ? [...prev, ...data.results] : data.results))
          setResults([])
          setTotal(data.total)
          setPage(data.page)
          setTotalPages(data.total_pages)
          setFallbackTerm(null)
        } else if (mode === 'ndc') {
          // An NDC is one package: list the codes that start with the typed digits.
          const codes = activeQuery.replace(/\D/g, '').length >= 3 ? await suggestNdc(activeQuery, ctrl.signal, 20) : []
          if (ctrl.signal.aborted) return
          setResults(
            codes.map((n) => ({
              drug_name: n.drug_name,
              imprint: n.imprint ?? '',
              color: null,
              shape: null,
              ndc: n.ndc,
              rxcui: null,
              slug: n.slug,
              strength: n.strength,
              image_url: n.image_url,
              images: n.image_url ? [n.image_url] : [],
              has_multiple_images: false,
            })),
          )
          setDrugs([])
          setTotal(codes.length)
          setPage(1)
          setTotalPages(1)
          setFallbackTerm(null)
        } else {
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
          setDrugs([])
          setTotal(data.total)
          setPage(data.page)
          setTotalPages(data.total_pages)
          setFallbackTerm(data.fallback_used ? data.fallback_term : null)
        }
      } catch (err) {
        if (ctrl.signal.aborted) return
        const e = err instanceof ApiError ? err : new ApiError('unknown', 'Search failed. Please try again.')
        if (e.kind === 'cancelled') return
        setError(e)
        if (!append) {
          setResults([])
          setDrugs([])
        }
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
      setDrugs([])
      setTotal(0)
      setError(null)
      setLoading(false)
      return
    }
    void runSearch(1, false)
  }, [hasSearch, runSearch])

  const saveToRecent = useCallback(
    (top: { drug_name: string; slug: string | null; image_url: string | null } | null) => {
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

  const openSlug = (slug: string | null, top: { drug_name: string; slug: string | null; image_url: string | null } | null) => {
    dismissKeyboard()
    setPicker(null)
    saveToRecent(top)
    if (slug) navigate(goalPillPath(slug, goal))
    // The goal banner has done its job once a result is opened.
    if (goal) setGoal(null)
  }

  const openResult = (r: SearchResult) => openSlug(r.slug, r)

  /** Load one drug's pills (optionally one strength); open directly when there is only one. */
  const loadPills = (drug: DrugRow, strength: string | null, openIfSingle: boolean) => {
    pickerAbort.current?.abort()
    const ctrl = new AbortController()
    pickerAbort.current = ctrl
    setPicker({ kind: 'pills', drug, strength, pills: [], loading: true, error: null })
    getDrugPills(drug.name, strength, ctrl.signal)
      .then(({ results: pills }) => {
        if (ctrl.signal.aborted) return
        const first = pills[0]
        if ((openIfSingle && pills.length === 1 && first) || (goal && first)) {
          openSlug(first.slug, { drug_name: drug.name, slug: first.slug, image_url: first.image_url ?? drug.image_url })
          return
        }
        setPicker({ kind: 'pills', drug, strength, pills, loading: false, error: null })
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return
        setPicker({ kind: 'pills', drug, strength, pills: [], loading: false, error: err instanceof ApiError ? err : new ApiError('unknown', 'Could not load pills.') })
      })
  }

  const openDrug = (drug: DrugRow) => {
    void hapticTick()
    dismissKeyboard()
    // Per-drug sections (dosage, side effects…) read the same label whatever the strength.
    if (goal || drug.strengths.length <= 1) {
      loadPills(drug, null, true)
      return
    }
    setPicker({ kind: 'strengths', drug })
  }

  const changeMode = (m: Mode) => {
    setMode(m)
    setResults([])
    setDrugs([])
    setError(null)
  }

  const showDrugSuggestions = mode === 'drug' && focused && q.trim().length >= 2 && drugSuggestions.length > 0
  const showNdcSuggestions = mode === 'ndc' && focused && q.replace(/\D/g, '').length >= 3 && ndcSuggestions.length > 0
  const showImprintSuggestions = mode === 'imprint' && focused && q.trim().length >= 2 && imprintSuggestions.length > 0

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
                ? 'Start typing a brand or generic name and pick it from the list.'
                : 'Type the National Drug Code from the packaging; matches appear as you type.'
          }
        />
      </Card>
    )
  } else if ((mode === 'drug' ? drugs : results).length === 0) {
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
    const shown = mode === 'drug' ? drugs.length : results.length
    content = (
      <div className="space-y-3">
        <p className="tabular px-1 text-[14px] text-muted">
          {total.toLocaleString()} {mode === 'drug' ? (total === 1 ? 'drug' : 'drugs') : total === 1 ? 'result' : 'results'}
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
          {mode === 'drug'
            ? drugs.map((d) => <DrugRowButton key={d.key} drug={d} onPress={() => openDrug(d)} />)
            : results.map((r, i) => (
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
            Load more ({(total - shown).toLocaleString()} left)
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
          <div className="relative">
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
              onFocus={() => setFocused(true)}
              onBlur={() => setTimeout(() => setFocused(false), 150)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  dismissKeyboard()
                  saveToRecent(mode === 'drug' ? (drugs[0] ? { drug_name: drugs[0].name, slug: drugs[0].slug, image_url: drugs[0].image_url } : null) : results[0] ?? null)
                }
              }}
            />
            {(showDrugSuggestions || showNdcSuggestions || showImprintSuggestions) && (
              <ul className="card absolute inset-x-0 top-full z-30 mt-1 max-h-72 divide-y divide-line overflow-y-auto" role="listbox" aria-label="Suggestions">
                {showImprintSuggestions &&
                  imprintSuggestions.map((imp) => (
                    <li key={imp} role="option" aria-selected={false}>
                      <button
                        type="button"
                        onClick={() => {
                          void hapticTick()
                          setQ(imp)
                          setImprintSuggestions([])
                          dismissKeyboard()
                        }}
                        className="pressable flex min-h-[44px] w-full items-center gap-3 px-4 text-left active:bg-brand-tint"
                      >
                        <SearchIcon size={16} className="flex-none text-muted" />
                        <span className="tabular font-mono text-[16px] font-semibold text-ink">{imp}</span>
                      </button>
                    </li>
                  ))}
                {showDrugSuggestions &&
                  drugSuggestions.map((d) => (
                    <li key={d.key} role="option" aria-selected={false}>
                      <DrugRowButton drug={d} compact onPress={() => openDrug(d)} />
                    </li>
                  ))}
                {showNdcSuggestions &&
                  ndcSuggestions.map((n) => (
                    <li key={n.ndc} role="option" aria-selected={false}>
                      <button
                        type="button"
                        onClick={() => {
                          void hapticTick()
                          openSlug(n.slug, { drug_name: n.drug_name, slug: n.slug, image_url: n.image_url })
                        }}
                        className="pressable flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left active:bg-brand-tint"
                      >
                        <PillThumb src={n.image_url} alt="" size={36} />
                        <span className="min-w-0 flex-1">
                          <span className="tabular block font-mono text-[15px] font-semibold text-ink">{n.ndc}</span>
                          <span className="block truncate text-[13px] text-muted">
                            {n.drug_name}
                            {n.strength ? ` · ${n.strength}` : ''}
                          </span>
                        </span>
                        <ChevronRightIcon size={18} className="flex-none text-muted" />
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </div>
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

      {/* Drug → strength → pill */}
      <Sheet
        open={picker !== null}
        onClose={() => {
          pickerAbort.current?.abort()
          setPicker(null)
        }}
        title={picker ? (picker.kind === 'pills' && picker.strength ? `${picker.drug.name} ${picker.strength}` : picker.drug.name) : undefined}
      >
        {picker?.kind === 'strengths' && (
          <div className="-mx-2">
            <p className="px-2 pb-2 text-[14px] text-muted">Choose a strength</p>
            <div className="max-h-[60vh] divide-y divide-line overflow-y-auto">
              {(picker.drug.strength_details.length > 0
                ? picker.drug.strength_details
                : picker.drug.strengths.map((label) => ({ label, pill_count: 0, image_url: null, slug: null }))
              ).map((d) => (
                <button
                  key={d.label}
                  type="button"
                  onClick={() => {
                    void hapticTick()
                    // Exactly one pill in this strength: open it without another list.
                    if (d.pill_count === 1 && d.slug) openSlug(d.slug, { drug_name: picker.drug.name, slug: d.slug, image_url: d.image_url ?? picker.drug.image_url })
                    else loadPills(picker.drug, d.label, true)
                  }}
                  className="pressable flex min-h-[60px] w-full items-center gap-3 rounded-xl px-2 py-2 text-left active:bg-brand-tint"
                >
                  <PillThumb src={d.image_url} alt="" size={48} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[17px] font-semibold text-ink">{d.label}</span>
                    {d.pill_count > 0 && <span className="block text-[13px] text-muted">{d.pill_count === 1 ? '1 pill' : `${d.pill_count} pills`}</span>}
                  </span>
                  <ChevronRightIcon size={20} className="flex-none text-muted" />
                </button>
              ))}
            </div>
          </div>
        )}
        {picker?.kind === 'pills' && (
          <div className="-mx-2 max-h-[65vh] overflow-y-auto">
            {picker.loading && (
              <div className="space-y-2 px-2 py-2">
                <Skeleton className="h-14 w-full rounded-xl" />
                <Skeleton className="h-14 w-full rounded-xl" />
              </div>
            )}
            {picker.error && (
              <div className="px-2">
                <ErrorCard error={picker.error} onRetry={() => loadPills(picker.drug, picker.strength, false)} />
              </div>
            )}
            {!picker.loading && !picker.error && (
              <>
                {picker.drug.strengths.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setPicker({ kind: 'strengths', drug: picker.drug })}
                    className="pressable mb-1 inline-flex min-h-[36px] items-center gap-1 px-2 text-[14px] font-semibold text-brand"
                  >
                    <ChevronRightIcon size={16} className="rotate-180" /> Other strengths
                  </button>
                )}
                {picker.pills.length === 0 && <p className="px-2 py-6 text-center text-[15px] text-muted">No pills listed for this strength.</p>}
                <div className="divide-y divide-line">
                  {picker.pills.map((r, i) => (
                    <button
                      key={`${r.slug ?? r.ndc ?? i}-${i}`}
                      type="button"
                      onClick={() => openResult(r)}
                      className="pressable flex min-h-[64px] w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left active:bg-brand-tint"
                    >
                      <PillThumb src={r.image_url} alt="" size={48} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[16px] font-semibold text-ink">{r.imprint ? `Imprint ${r.imprint}` : r.strength ?? r.drug_name}</span>
                        <span className="block truncate text-[13px] text-muted">
                          {[
                            !picker.strength && r.strength ? r.strength : null,
                            [r.color, r.shape].filter(Boolean).map((x) => titleCase(String(x))).join(' · ') || null,
                            r.manufacturer ?? null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                      <ChevronRightIcon size={20} className="flex-none text-muted" />
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </Sheet>
    </div>
  )
}
