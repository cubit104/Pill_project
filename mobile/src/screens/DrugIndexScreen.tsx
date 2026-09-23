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
import { ApiError, getDrugIndex, type DrugIndexEntry } from '../lib/api'
import { useBackHandler } from '../lib/backstack'
import { ivPath } from '../lib/goals'
import { useT } from '../lib/i18n'
import { hapticTick } from '../lib/native'

const LETTERS = [...'abcdefghijklmnopqrstuvwxyz', '0-9']

function pillSearchPath(name: string): string {
  return `/search?type=drug&q=${encodeURIComponent(name)}`
}

/**
 * Every drug on PillSeek, A to Z, pills and injections in one list (the website's /api/drug-index). A name that
 * exists as both opens a small choice; the others go straight to the pills or the injection screen.
 */
export default function DrugIndexScreen() {
  const navigate = useNavigate()
  const t = useT()
  const [params, setParams] = useSearchParams()
  const scrollRef = useRef<HTMLDivElement>(null)
  const letterParam = (params.get('letter') ?? 'a').toLowerCase()
  const letter = LETTERS.includes(letterParam) ? letterParam : 'a'
  const [entries, setEntries] = useState<DrugIndexEntry[] | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [filter, setFilter] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [both, setBoth] = useState<DrugIndexEntry | null>(null)

  const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate('/home', { replace: true }))
  useBackHandler(!both, goBack)

  useEffect(() => {
    const ctrl = new AbortController()
    setEntries(null)
    setError(null)
    setFilter('')
    scrollRef.current?.scrollTo({ top: 0 })
    getDrugIndex(letter, ctrl.signal)
      .then((index) => !ctrl.signal.aborted && setEntries(index.entries))
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return
        setError(err instanceof ApiError ? err : new ApiError('unknown', t('Could not load the drug list.')))
      })
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [letter, reloadKey])

  const pick = (l: string) => {
    if (l === letter) return
    void hapticTick()
    setParams({ letter: l }, { replace: true })
  }

  const open = (entry: DrugIndexEntry) => {
    void hapticTick()
    const pills = entry.pill_count > 0
    if (entry.iv_slug && pills) {
      setBoth(entry)
      return
    }
    if (entry.iv_slug) navigate(ivPath(entry.iv_slug))
    else navigate(pillSearchPath(entry.name))
  }

  const shown = useMemo(() => {
    const term = filter.trim().toLowerCase()
    return term ? (entries ?? []).filter((e) => e.name.toLowerCase().includes(term)) : (entries ?? [])
  }, [entries, filter])

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-canvas animate-fade-up">
      <ScreenHeader title={t('Drugs A–Z')} subtitle={t('Pills and injections')} scrollRef={scrollRef} onBack={goBack}>
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" role="tablist" aria-label={t('First letter')}>
          {LETTERS.map((l) => (
            <button
              key={l}
              type="button"
              role="tab"
              aria-selected={l === letter}
              onClick={() => pick(l)}
              className={`pressable flex h-9 min-w-[36px] flex-none items-center justify-center rounded-full px-2 text-[14px] font-semibold uppercase ${l === letter ? 'bg-brand text-brand-fg' : 'hairline bg-surface text-body'}`}
            >
              {l}
            </button>
          ))}
        </div>
      </ScreenHeader>

      <main className="screen mx-auto max-w-lg space-y-3 px-4 pb-8 pt-2" style={{ paddingLeft: 'max(16px, var(--safe-left))', paddingRight: 'max(16px, var(--safe-right))' }}>
        {entries && entries.length > 12 && (
          <label className="relative block">
            <SearchIcon size={16} className="absolute left-3 top-3 text-muted" />
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('Filter the {letter} list', { letter: letter.toUpperCase() })}
              className="hairline w-full rounded-xl bg-surface py-2.5 pl-9 pr-3 text-[16px] text-ink"
            />
          </label>
        )}

        {!entries && !error && <ListSkeleton rows={8} />}
        {error && <ErrorCard error={error} onRetry={() => setReloadKey((k) => k + 1)} />}
        {entries && shown.length === 0 && (
          <Card padded={false}>
            <EmptyState art="search" title={t('Nothing here')} body={filter ? t('No drug under {letter} matches that.', { letter: letter.toUpperCase() }) : t('No drugs start with {letter} yet.', { letter: letter.toUpperCase() })} />
          </Card>
        )}
        {entries && shown.length > 0 && (
          <div className="card divide-y divide-line overflow-hidden">
            {shown.map((entry) => (
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
