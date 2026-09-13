import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Card, { SectionLabel } from '../components/Card'
import EmptyState from '../components/EmptyState'
import ErrorCard from '../components/ErrorCard'
import { AlertIcon, CheckIcon, ChevronRightIcon, SearchIcon } from '../components/Icons'
import RecallCard from '../components/RecallCard'
import { Skeleton } from '../components/Skeleton'
import TextField from '../components/TextField'
import { useAccount } from '../lib/account'
import { ApiError, suggestDrugs, type DrugRow } from '../lib/api'
import { useBackHandler } from '../lib/backstack'
import { useDebouncedValue } from '../lib/hooks'
import { useT } from '../lib/i18n'
import { hapticTick, hideKeyboard } from '../lib/native'
import { latestRecalls, recallsForDrug, useCabinetRecalls, type Recall } from '../lib/recalls'

/**
 * FDA alerts: type a drug (live suggestions, same as the search box), see its
 * recalls in the last 12 months. Below: your cabinet's status and the newest
 * recalls nationwide.
 */
export default function RecallsScreen() {
  const t = useT()
  const navigate = useNavigate()
  const account = useAccount()
  const cabinet = useCabinetRecalls()
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [q, setQ] = useState('')
  const debouncedQ = useDebouncedValue(q, 200)
  const [suggestions, setSuggestions] = useState<DrugRow[]>([])
  const [picked, setPicked] = useState<string | null>(null)
  const [results, setResults] = useState<Recall[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<ApiError | Error | null>(null)
  const [latest, setLatest] = useState<Recall[] | null>(null)
  const [latestError, setLatestError] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate('/home', { replace: true }))
  useBackHandler(true, goBack)

  // Live suggestions while typing, from the app's own drug index.
  useEffect(() => {
    const term = debouncedQ.trim()
    if (term.length < 2 || term === picked) {
      setSuggestions([])
      return
    }
    const ctrl = new AbortController()
    suggestDrugs(term, ctrl.signal)
      .then((rows) => !ctrl.signal.aborted && setSuggestions(rows))
      .catch(() => {})
    return () => ctrl.abort()
  }, [debouncedQ, picked])

  useEffect(() => {
    const ctrl = new AbortController()
    latestRecalls(20, ctrl.signal)
      .then((rows) => !ctrl.signal.aborted && setLatest(rows))
      .catch(() => !ctrl.signal.aborted && setLatestError(true))
    return () => {
      ctrl.abort()
      abortRef.current?.abort()
    }
  }, [])

  const search = async (name: string) => {
    const term = name.trim()
    if (!term) return
    void hapticTick()
    void hideKeyboard()
    inputRef.current?.blur()
    setPicked(term)
    setQ(term)
    setSuggestions([])
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setError(null)
    try {
      const rows = await recallsForDrug(term, null, ctrl.signal)
      if (ctrl.signal.aborted) return
      setResults(rows)
    } catch (err) {
      if (ctrl.signal.aborted) return
      setError(err instanceof Error ? err : new Error(String(err)))
      setResults(null)
    } finally {
      if (!ctrl.signal.aborted) setLoading(false)
    }
  }

  const clear = () => {
    setQ('')
    setPicked(null)
    setResults(null)
    setError(null)
    setSuggestions([])
  }

  const cabinetNames = cabinet.affected.map((slug) => account.pills[slug]?.drug_name ?? slug)

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-canvas animate-fade-up">
      <div
        className="sticky top-0 z-20 flex items-center gap-2 bg-[color-mix(in_srgb,var(--canvas)_95%,transparent)] px-2 pb-2 backdrop-blur"
        style={{ paddingTop: 'calc(var(--safe-top) + 6px)', paddingLeft: 'max(8px, var(--safe-left))', paddingRight: 'max(8px, var(--safe-right))' }}
      >
        <button type="button" onClick={goBack} aria-label={t('Back')} className="pressable flex h-11 min-w-[44px] items-center gap-0.5 rounded-full px-2 text-[17px] font-medium text-brand">
          <ChevronRightIcon size={22} className="rotate-180" />
          {t('Back')}
        </button>
        <p className="min-w-0 flex-1 truncate text-center text-[17px] font-semibold text-ink">{t('FDA alerts')}</p>
        <span className="w-11" aria-hidden />
      </div>

      <main className="screen mx-auto max-w-lg space-y-5 px-4 pb-8 pt-2" style={{ paddingLeft: 'max(16px, var(--safe-left))', paddingRight: 'max(16px, var(--safe-right))' }}>
        <div className="px-1">
          <h1 className="text-[26px] font-bold leading-tight tracking-tight text-ink">{t('FDA alerts')}</h1>
          <p className="mt-1 text-[15px] leading-relaxed text-muted">{t('Drug recalls from the FDA, last 12 months. Search any medicine or check your cabinet.')}</p>
        </div>

        <div className="relative">
          <TextField
            ref={inputRef}
            label={t('Medicine')}
            value={q}
            onChange={(v) => {
              setQ(v)
              if (picked && v !== picked) setPicked(null)
            }}
            onClear={clear}
            placeholder={t('Type a medicine, e.g. Metformin')}
            leading={<SearchIcon size={20} />}
            type="search"
            inputMode="search"
            autoCapitalize="words"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && q.trim()) void search(suggestions[0]?.name ?? q)
            }}
          />
          {suggestions.length > 0 && (
            <ul className="card absolute inset-x-0 top-full z-10 mt-1 max-h-64 overflow-y-auto py-1" role="listbox" aria-label={t('Suggestions')}>
              {suggestions.map((s) => (
                <li key={s.key}>
                  <button type="button" role="option" aria-selected={false} onClick={() => void search(s.name)} className="pressable flex min-h-[44px] w-full items-center justify-between gap-2 px-4 text-left text-[16px] text-ink active:bg-brand-tint">
                    <span className="truncate">{s.name}</span>
                    {s.ingredients && s.ingredients.toLowerCase() !== s.name.toLowerCase() && <span className="truncate text-[13px] text-muted">{s.ingredients}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {loading && (
          <div className="space-y-2">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}
        {error && <ErrorCard error={error} onRetry={() => void search(picked ?? q)} />}
        {results && !loading && (
          <section className="space-y-2">
            <SectionLabel>{results.length === 0 ? t('No recalls for {name}', { name: picked ?? q }) : t('{n} recalls for {name}', { n: results.length, name: picked ?? q })}</SectionLabel>
            {results.length === 0 ? (
              <EmptyState art="pill" title={t('No recalls in the last 12 months')} body={t('Nothing from the FDA for this medicine. Recalls are often for specific lots, so check again if you hear news.')} />
            ) : (
              results.map((r) => <RecallCard key={r.id} recall={r} />)
            )}
          </section>
        )}

        {/* Cabinet status */}
        {account.enabled && account.items.length > 0 && (
          <section>
            <SectionLabel>{t('Your cabinet')}</SectionLabel>
            {cabinet.checking && cabinet.checkedAt === null ? (
              <Skeleton className="h-14 w-full" />
            ) : cabinet.total === 0 ? (
              <Card tone="tint" className="flex items-center gap-3">
                <CheckIcon size={22} className="flex-none text-brand" />
                <span className="text-[15px] text-ink">{t('All clear: no recalls for your {n} medicines in the last 12 months.', { n: account.items.length })}</span>
              </Card>
            ) : (
              <Card tone="danger" className="space-y-3">
                <div className="flex items-start gap-3">
                  <AlertIcon size={22} className="mt-0.5 flex-none text-danger" />
                  <span className="text-[15px] font-semibold text-ink">{t('{n} recalls may affect: {names}', { n: cabinet.total, names: cabinetNames.join(', ') })}</span>
                </div>
                {cabinet.affected.map((slug) => (
                  <div key={slug} className="space-y-2">
                    <p className="text-[14px] font-semibold text-ink">{account.pills[slug]?.drug_name ?? slug}</p>
                    {(cabinet.bySlug[slug] ?? []).map((r) => (
                      <RecallCard key={r.id} recall={r} showMatch />
                    ))}
                  </div>
                ))}
                <p className="text-[13px] text-muted">{t('Compare the lot numbers with your bottle. If they match, call your pharmacy before taking more.')}</p>
              </Card>
            )}
          </section>
        )}

        {/* Latest nationwide */}
        <section className="space-y-2">
          <SectionLabel>{t('Latest recalls nationwide')}</SectionLabel>
          {latest === null && !latestError && <Skeleton className="h-24 w-full" />}
          {latestError && <p className="px-1 text-[14px] text-muted">{t('Could not load the latest recalls right now.')}</p>}
          {latest?.map((r) => <RecallCard key={r.id} recall={r} />)}
          <p className="px-1 pt-1 text-[12px] leading-relaxed text-muted">{t('Source: FDA enforcement reports (openFDA). Informational only; confirm with your pharmacist.')}</p>
        </section>
      </main>
    </div>
  )
}
