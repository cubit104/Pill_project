import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Card from '../components/Card'
import EmptyState from '../components/EmptyState'
import ErrorCard from '../components/ErrorCard'
import { ChevronRightIcon, PillIcon, SearchIcon } from '../components/Icons'
import { SyringeIcon } from '../components/IvIcons'
import { TextBadge } from '../components/PillRow'
import ScreenHeader from '../components/ScreenHeader'
import Sheet from '../components/Sheet'
import { ListSkeleton } from '../components/Skeleton'
import { ApiError, getDrugIndex, suggestDrugs, suggestIvDrugs, type DrugIndexEntry, type DrugRow, type IvSuggestion } from '../lib/api'
import { useBackHandler } from '../lib/backstack'
import { ivPath } from '../lib/goals'
import { useDebouncedValue } from '../lib/hooks'
import { useLocale, useT } from '../lib/i18n'
import { hapticTick, hideKeyboard } from '../lib/native'

const LETTERS = [...'abcdefghijklmnopqrstuvwxyz', '0-9']
const PAGE = 20

function pillSearchPath(name: string): string {
  return `/search?type=drug&q=${encodeURIComponent(name)}`
}

// Remembered across visits in this session: how far down each letter the reader was, so coming back from a drug
// lands where they left off.
const remembered = new Map<string, { shown: number; filter: string }>()

/** A search box that sends the words to the normal drug-name search (grid) or filters the letter (list). */
function SearchBox({ value, onChange, onSubmit, placeholder }: { value: string; onChange: (v: string) => void; onSubmit?: () => void; placeholder: string }) {
  return (
    <form
      className="relative block"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit?.()
      }}
    >
      <SearchIcon size={16} className="absolute left-3 top-3 text-muted" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        enterKeyHint="search"
        className="hairline w-full rounded-xl bg-surface py-2.5 pl-9 pr-3 text-[16px] text-ink"
      />
    </form>
  )
}

/** Six letters a row on the brand green, white letters, the same look as the website's tiles; the numbers tile takes two. */
function LetterGrid({ onPick }: { onPick: (letter: string) => void }) {
  const t = useT()
  return (
    <ul className="grid grid-cols-6 gap-2.5" aria-label={t('First letter')}>
      {LETTERS.map((letter) => (
        <li key={letter} className={letter === '0-9' ? 'col-span-2' : ''}>
          <button
            type="button"
            onClick={() => onPick(letter)}
            aria-label={letter === '0-9' ? t('Numbers') : letter.toUpperCase()}
            className={`pressable relative flex w-full items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-brand to-brand-pressed text-brand-fg shadow-[0_6px_16px_-6px_rgba(5,150,105,0.55)] active:from-brand-pressed active:to-brand-pressed ${letter === '0-9' ? 'aspect-[2/1]' : 'aspect-square'}`}
          >
            <span aria-hidden className="absolute inset-x-0 top-0 h-1/2 bg-white/10" />
            <span className={`relative font-extrabold uppercase leading-none tracking-tight ${letter === '0-9' ? 'text-[19px]' : 'text-[26px]'}`}>{letter}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** The grid's search box: pills and injections matching what is typed, as you type; Enter runs the full name search. */
function LiveSearch() {
  const navigate = useNavigate()
  const t = useT()
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const term = useDebouncedValue(query.trim(), 150)
  const [pills, setPills] = useState<DrugRow[]>([])
  const [injections, setInjections] = useState<IvSuggestion[]>([])
  const [answered, setAnswered] = useState('')

  useEffect(() => {
    if (term.length < 2) {
      setPills([])
      setInjections([])
      setAnswered('')
      return
    }
    const ctrl = new AbortController()
    void Promise.all([
      suggestDrugs(term, ctrl.signal).catch(() => [] as DrugRow[]),
      suggestIvDrugs(term, ctrl.signal).catch(() => [] as IvSuggestion[]),
    ]).then(([p, i]) => {
      if (ctrl.signal.aborted) return
      setPills(p)
      setInjections(i)
      setAnswered(term)
    })
    return () => ctrl.abort()
  }, [term])

  const go = (path: string) => {
    void hapticTick()
    hideKeyboard()
    navigate(path)
  }
  const open = focused && query.trim().length >= 2 && answered === query.trim()
  const rowClass = 'pressable flex min-h-[48px] w-full items-center gap-3 px-4 py-2 text-left active:bg-brand-tint'

  return (
    <form
      className="relative"
      onSubmit={(e) => {
        e.preventDefault()
        const q = query.trim()
        if (q) go(pillSearchPath(q))
      }}
    >
      <SearchIcon size={16} className="absolute left-3 top-3 text-muted" />
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder={t('Search all drugs')}
        enterKeyHint="search"
        autoComplete="off"
        className="hairline w-full rounded-xl bg-surface py-2.5 pl-9 pr-3 text-[16px] text-ink"
      />
      {open && (
        <ul className="card absolute inset-x-0 top-full z-30 mt-1 max-h-80 divide-y divide-line overflow-y-auto" role="listbox" aria-label={t('Suggestions')}>
          {injections.map((s) => (
            <li key={`iv:${s.slug}`} role="option" aria-selected={false}>
              <button type="button" onClick={() => go(ivPath(s.slug))} className={rowClass}>
                <span className="min-w-0 flex-1 truncate text-[16px] font-medium text-ink">{s.label}</span>
                <TextBadge tone="brand">{t('Injection')}</TextBadge>
                <ChevronRightIcon size={18} className="flex-none text-muted" />
              </button>
            </li>
          ))}
          {pills.map((d) => (
            <li key={d.key} role="option" aria-selected={false}>
              <button type="button" onClick={() => go(pillSearchPath(d.name))} className={rowClass}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] font-medium text-ink">{d.name}</span>
                  {d.brand_names && d.brand_names.toLowerCase() !== d.name.toLowerCase() && <span className="block truncate text-[13px] text-muted">{d.brand_names}</span>}
                </span>
                <TextBadge tone="neutral">{t('Pill')}</TextBadge>
                <ChevronRightIcon size={18} className="flex-none text-muted" />
              </button>
            </li>
          ))}
          {pills.length === 0 && injections.length === 0 && <li className="px-4 py-3 text-[14px] text-muted">{t('No matches')}</li>}
        </ul>
      )}
    </form>
  )
}

/**
 * Every drug on PillSeek, A to Z, pills and injections together (the website's /api/drug-index). The first page is a
 * grid of letters with their counts; a letter opens its list twenty names at a time. A name that exists as both a
 * pill and an injection opens a small choice; the others go straight to the pills or the injection screen.
 */
export default function DrugIndexScreen() {
  const navigate = useNavigate()
  const t = useT()
  const locale = useLocale()
  const [params, setParams] = useSearchParams()
  const scrollRef = useRef<HTMLDivElement>(null)
  const letterParam = (params.get('letter') ?? '').toLowerCase()
  const letter = LETTERS.includes(letterParam) ? letterParam : null
  const [entries, setEntries] = useState<DrugIndexEntry[] | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [filter, setFilter] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [reloadKey, setReloadKey] = useState(0)
  const [both, setBoth] = useState<DrugIndexEntry | null>(null)

  const goBack = () => {
    if (letter) {
      setParams({}, { replace: true })
      return
    }
    if (window.history.length > 1) navigate(-1)
    else navigate('/home', { replace: true })
  }
  useBackHandler(!both, goBack)

  useEffect(() => {
    if (!letter) return
    const ctrl = new AbortController()
    const memory = remembered.get(letter)
    setEntries(null)
    setError(null)
    setFilter(memory?.filter ?? '')
    setShown(memory?.shown ?? PAGE)
    scrollRef.current?.scrollTo({ top: 0 })
    getDrugIndex(letter, ctrl.signal)
      .then((index) => {
        if (ctrl.signal.aborted) return
        setEntries(index.entries)
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return
        setError(err instanceof ApiError ? err : new ApiError('unknown', t('Could not load the drug list.')))
      })
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [letter, reloadKey])

  useEffect(() => {
    if (letter) remembered.set(letter, { shown, filter })
  }, [letter, shown, filter])

  const pick = (l: string) => {
    void hapticTick()
    setParams({ letter: l }, { replace: false })
  }

  const open = (entry: DrugIndexEntry) => {
    void hapticTick()
    if (entry.iv_slug && entry.pill_count > 0) {
      setBoth(entry)
      return
    }
    if (entry.iv_slug) navigate(ivPath(entry.iv_slug))
    else navigate(pillSearchPath(entry.name))
  }

  const matching = useMemo(() => {
    const term = filter.trim().toLowerCase()
    return term ? (entries ?? []).filter((e) => e.name.toLowerCase().includes(term)) : (entries ?? [])
  }, [entries, filter])
  const visible = matching.slice(0, shown)

  const title = letter ? (letter === '0-9' ? t('Numbers') : letter.toUpperCase()) : t('Drugs A–Z')
  const subtitle = letter
    ? entries
      ? entries.length === 1
        ? t('1 drug')
        : t('{n} drugs', { n: entries.length.toLocaleString(locale) })
      : ' '
    : t('Pills and injections')

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-canvas animate-fade-up">
      <ScreenHeader title={title} subtitle={subtitle} scrollRef={scrollRef} onBack={goBack}>
        {letter ? (
          <SearchBox value={filter} onChange={(v) => { setFilter(v); setShown(PAGE) }} onSubmit={hideKeyboard} placeholder={t('Filter the {letter} list', { letter: title })} />
        ) : (
          <LiveSearch />
        )}
      </ScreenHeader>

      <main className="screen mx-auto max-w-lg space-y-3 px-4 pb-8 pt-2" style={{ paddingLeft: 'max(16px, var(--safe-left))', paddingRight: 'max(16px, var(--safe-right))' }}>
        {!letter && <LetterGrid onPick={pick} />}

        {letter && !entries && !error && <ListSkeleton rows={8} />}
        {letter && error && <ErrorCard error={error} onRetry={() => setReloadKey((k) => k + 1)} />}
        {letter && entries && matching.length === 0 && (
          <Card padded={false}>
            <EmptyState art="search" title={t('Nothing here')} body={filter ? t('No drug under {letter} matches that.', { letter: title }) : t('No drugs start with {letter} yet.', { letter: title })} />
          </Card>
        )}
        {letter && entries && visible.length > 0 && (
          <>
            <div className="card divide-y divide-line overflow-hidden">
              {visible.map((entry) => (
                <button
                  key={`${entry.name}|${entry.iv_slug ?? ''}`}
                  type="button"
                  onClick={() => open(entry)}
                  className="pressable flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left active:bg-brand-tint"
                >
                  <span className="min-w-0 flex-1 truncate text-[16px] font-medium text-ink">{entry.name}</span>
                  {entry.pill_count > 0 && <TextBadge tone="neutral">{t('Pill')}</TextBadge>}
                  {entry.iv_slug && <TextBadge tone="brand">{t('Injection')}</TextBadge>}
                  <ChevronRightIcon size={18} className="flex-none text-muted" />
                </button>
              ))}
            </div>
            <p className="tabular px-1 text-center text-[13px] text-muted">
              {t('Showing {shown} of {total}', { shown: visible.length.toLocaleString(locale), total: matching.length.toLocaleString(locale) })}
            </p>
            {matching.length > visible.length && (
              <button
                type="button"
                onClick={() => {
                  void hapticTick()
                  setShown((n) => n + PAGE)
                }}
                className="pressable card flex min-h-[48px] w-full items-center justify-center text-[15px] font-semibold text-brand active:bg-brand-tint"
              >
                {t('Load more')}
              </button>
            )}
          </>
        )}
      </main>

      <Sheet open={both !== null} onClose={() => setBoth(null)} title={both?.name ?? ''}>
        {both && (
          <div className="divide-y divide-line">
            <button
              type="button"
              onClick={() => {
                void hapticTick()
                setBoth(null)
                navigate(pillSearchPath(both.name))
              }}
              className="pressable flex min-h-[56px] w-full items-center gap-3 px-4 text-left active:bg-brand-tint"
            >
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-brand-tint text-brand">
                <PillIcon size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-semibold text-ink">{t('Pills')}</span>
                <span className="block text-[13px] text-muted">{t('{n} tablets and capsules', { n: both.pill_count })}</span>
              </span>
              <ChevronRightIcon size={18} className="flex-none text-muted" />
            </button>
            <button
              type="button"
              onClick={() => {
                void hapticTick()
                setBoth(null)
                if (both.iv_slug) navigate(ivPath(both.iv_slug))
              }}
              className="pressable flex min-h-[56px] w-full items-center gap-3 px-4 text-left active:bg-brand-tint"
            >
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-brand-tint text-brand">
                <SyringeIcon size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-semibold text-ink">{t('Injection')}</span>
                <span className="block text-[13px] text-muted">{t('How it is given, mixing, storage')}</span>
              </span>
              <ChevronRightIcon size={18} className="flex-none text-muted" />
            </button>
          </div>
        )}
      </Sheet>
    </div>
  )
}
