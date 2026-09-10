import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Button from '../components/Button'
import Card, { SectionLabel } from '../components/Card'
import Disclaimer from '../components/Disclaimer'
import EmptyState from '../components/EmptyState'
import ErrorCard from '../components/ErrorCard'
import { AlertIcon, ChevronRightIcon, CloseIcon, SearchIcon } from '../components/Icons'
import { TextBadge } from '../components/PillRow'
import { Skeleton } from '../components/Skeleton'
import TextField from '../components/TextField'
import {
  ApiError,
  checkInteractions,
  getInteractionSuggestions,
  type InteractionCheck,
  type InteractionPair,
} from '../lib/api'
import { useBackHandler } from '../lib/backstack'
import { useDebouncedValue } from '../lib/hooks'
import { useT } from '../lib/i18n'
import {
  MAX_DRUGS,
  SEVERITY_LABEL,
  SEVERITY_ORDER,
  drugsParam,
  normaliseDrugList,
  normaliseSeverity,
  parseDrugsParam,
  type Severity,
} from '../lib/interactions'
import { hapticTick, hideKeyboard } from '../lib/native'
import { loadInteractionDrugs, saveInteractionDrugs } from '../lib/storage'

const BADGE_TONE: Record<Severity, 'danger' | 'amber' | 'brand' | 'neutral'> = {
  major: 'danger',
  moderate: 'amber',
  minor: 'brand',
  unknown: 'neutral',
}

const CARD_TONE: Record<Severity, 'danger' | 'warn' | 'surface'> = {
  major: 'danger',
  moderate: 'warn',
  minor: 'surface',
  unknown: 'surface',
}

function SeverityBadge({ severity }: { severity: Severity }) {
  const t = useT()
  return <TextBadge tone={BADGE_TONE[severity]}>{t(SEVERITY_LABEL[severity])}</TextBadge>
}

function PairCard({ pair }: { pair: InteractionPair }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const severity = pair.found ? normaliseSeverity(pair.severity) : 'unknown'
  const detail = pair.management ?? pair.interaction_text
  return (
    <Card tone={CARD_TONE[severity]} padded={false} className="overflow-hidden">
      <button
        type="button"
        onClick={() => {
          void hapticTick()
          setOpen((v) => !v)
        }}
        aria-expanded={open}
        className="pressable flex w-full items-start gap-3 px-4 py-3.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[16px] font-semibold text-ink">
              {pair.drug1} <span className="font-normal text-muted">+</span> {pair.drug2}
            </span>
            {pair.found ? <SeverityBadge severity={severity} /> : <TextBadge tone="neutral">{t('No data')}</TextBadge>}
          </span>
          <span className="mt-1 block text-[14px] leading-relaxed text-body">
            {pair.found ? pair.description ?? t('An interaction is recorded for this pair.') : pair.message ?? t('No known interaction was found for this pair.')}
          </span>
        </span>
        {detail && <ChevronRightIcon size={20} className={`mt-1 flex-none text-muted transition-transform duration-fast ${open ? 'rotate-90' : ''}`} />}
      </button>
      {open && detail && (
        <div className="border-t border-line px-4 py-3">
          <p className="section-label mb-1">{t('What to do')}</p>
          <p className="selectable text-[14px] leading-relaxed text-body">{detail}</p>
          {pair.confidence && <p className="mt-2 text-[12px] text-muted">{t('Confidence: {value}', { value: pair.confidence })}</p>}
        </div>
      )}
    </Card>
  )
}

function ResultSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-16 w-full rounded-card" />
      <Skeleton className="h-24 w-full rounded-card" />
      <Skeleton className="h-24 w-full rounded-card" />
    </div>
  )
}

/**
 * Native interactions checker: build a list of medicines (with suggestions),
 * check every pair plus food and condition warnings. Pushed over the tabs at
 * /interactions; ?drugs=a,b preselects medicines (pill page, Home tile).
 */
export default function InteractionsScreen() {
  const navigate = useNavigate()
  const t = useT()
  const [params] = useSearchParams()
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const [drugs, setDrugs] = useState<string[]>(() => parseDrugsParam(params.get('drugs')))
  const [q, setQ] = useState('')
  const debouncedQ = useDebouncedValue(q, 200)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [result, setResult] = useState<InteractionCheck | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const checkedRef = useRef<string>('')
  const abortRef = useRef<AbortController | null>(null)

  const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate('/home', { replace: true }))
  useBackHandler(true, goBack)

  // Remembered list: merge the saved medicines under any preselected one.
  useEffect(() => {
    let cancelled = false
    void loadInteractionDrugs().then((saved) => {
      if (cancelled) return
      setDrugs((cur) => normaliseDrugList([...cur, ...saved]))
      setHydrated(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (hydrated) void saveInteractionDrugs(drugs)
  }, [drugs, hydrated])

  // Suggestions while typing.
  useEffect(() => {
    const term = debouncedQ.trim()
    if (term.length < 2) {
      setSuggestions([])
      return
    }
    const ctrl = new AbortController()
    getInteractionSuggestions(term, ctrl.signal)
      .then((s) => !ctrl.signal.aborted && setSuggestions(s.filter((n) => !drugs.some((d) => d.toLowerCase() === n.toLowerCase()))))
      .catch(() => {})
    return () => ctrl.abort()
  }, [debouncedQ, drugs])

  const addDrug = (name: string) => {
    const next = normaliseDrugList([...drugs, name])
    if (next.length === drugs.length) return
    void hapticTick()
    setDrugs(next)
    setQ('')
    setSuggestions([])
  }

  const removeDrug = (name: string) => {
    void hapticTick()
    setDrugs(drugs.filter((d) => d !== name))
  }

  const runCheck = useCallback(async () => {
    if (drugs.length < 2) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    inputRef.current?.blur()
    void hideKeyboard()
    setChecking(true)
    setError(null)
    try {
      const data = await checkInteractions(drugs, ctrl.signal)
      if (ctrl.signal.aborted) return
      setResult(data)
      checkedRef.current = drugsParam(drugs)
    } catch (err) {
      if (ctrl.signal.aborted) return
      setError(err instanceof ApiError ? err : new ApiError('unknown', t('Could not check interactions.')))
    } finally {
      if (!ctrl.signal.aborted) setChecking(false)
    }
  }, [drugs, t])

  // Preselected lists (from a pill page) with 2+ medicines check themselves.
  useEffect(() => {
    if (hydrated && drugs.length >= 2 && result === null && !checking && !error) void runCheck()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated])

  const stale = result !== null && checkedRef.current !== drugsParam(drugs)
  const sortedPairs = useMemo(
    () =>
      result
        ? [...result.pairs].sort((a, b) => {
            const sa = a.found ? SEVERITY_ORDER[normaliseSeverity(a.severity)] : 4
            const sb = b.found ? SEVERITY_ORDER[normaliseSeverity(b.severity)] : 4
            return sa - sb
          })
        : [],
    [result],
  )
  const counts = result?.summary.severity
  const canCheck = drugs.length >= 2 && !checking

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
        <p className="min-w-0 flex-1 truncate text-center text-[17px] font-semibold text-ink">{t('Interactions')}</p>
        <span className="w-11" aria-hidden />
      </div>

      <main className="screen mx-auto max-w-lg space-y-4 px-4 pb-8 pt-2" style={{ paddingLeft: 'max(16px, var(--safe-left))', paddingRight: 'max(16px, var(--safe-right))' }}>
        <div className="px-1">
          <h1 className="text-[26px] font-bold leading-tight tracking-tight text-ink">{t('Interaction checker')}</h1>
          <p className="mt-1 text-[15px] text-muted">{t('Add two or more medicines to see how they affect each other.')}</p>
        </div>

        <section>
          <SectionLabel>{t('Your medicines')}</SectionLabel>
          <Card className="space-y-3">
            {drugs.length > 0 && (
              <ul className="flex flex-wrap gap-2" aria-label={t('Selected medicines')}>
                {drugs.map((d) => (
                  <li key={d}>
                    <span className="inline-flex h-10 items-center gap-1 rounded-full bg-brand-tint pl-3.5 pr-1 text-[15px] font-medium text-brand">
                      {d}
                      <button type="button" onClick={() => removeDrug(d)} aria-label={t('Remove {name}', { name: d })} className="pressable flex h-8 w-8 items-center justify-center rounded-full">
                        <CloseIcon size={14} strokeWidth={2.6} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {drugs.length < MAX_DRUGS ? (
              <div className="relative">
                <TextField
                  ref={inputRef}
                  label={t('Add a medicine')}
                  value={q}
                  onChange={setQ}
                  placeholder={drugs.length === 0 ? t('Add a medicine, e.g. Warfarin') : t('Add another medicine')}
                  leading={<SearchIcon size={20} />}
                  type="search"
                  inputMode="search"
                  autoCapitalize="words"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="done"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && q.trim()) addDrug(suggestions[0] ?? q)
                  }}
                />
                {suggestions.length > 0 && (
                  <ul className="card absolute inset-x-0 top-full z-10 mt-1 max-h-64 overflow-y-auto py-1" role="listbox" aria-label={t('Suggestions')}>
                    {suggestions.map((s) => (
                      <li key={s}>
                        <button type="button" role="option" aria-selected={false} onClick={() => addDrug(s)} className="pressable flex min-h-[44px] w-full items-center px-4 text-left text-[16px] text-ink active:bg-brand-tint">
                          {s}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="text-[13px] text-muted">{t('Up to {n} medicines per check.', { n: MAX_DRUGS })}</p>
            )}
            <Button full onClick={() => void runCheck()} disabled={!canCheck} loading={checking}>
              {drugs.length < 2 ? t('Add at least 2 medicines') : stale ? t('Check again') : t('Check {n} medicines', { n: drugs.length })}
            </Button>
          </Card>
        </section>

        {checking && !result && <ResultSkeleton />}
        {error && <ErrorCard error={error} onRetry={() => void runCheck()} />}

        {result && !error && (
          <>
            {counts && (
              <Card className={stale ? 'opacity-60' : ''}>
                <div className="grid grid-cols-4 divide-x divide-line text-center">
                  {(['major', 'moderate', 'minor', 'unknown'] as Severity[]).map((s) => (
                    <div key={s} className="px-1">
                      <p className="tabular text-[22px] font-bold text-ink">{counts[s]}</p>
                      <p className="text-[12px] text-muted">{t(SEVERITY_LABEL[s])}</p>
                    </div>
                  ))}
                </div>
                {stale && <p className="mt-2 text-center text-[12px] text-muted">{t('List changed. Tap Check again to refresh.')}</p>}
              </Card>
            )}

            <section className={`space-y-3 ${stale ? 'opacity-60' : ''}`}>
              <SectionLabel>{t('Drug to drug')}</SectionLabel>
              {sortedPairs.length === 0 ? (
                <Card padded={false}>
                  <EmptyState art="pill" title={t('No interactions found')} body={t('Nothing recorded between these medicines. Still check with your pharmacist.')} />
                </Card>
              ) : (
                sortedPairs.map((p) => <PairCard key={`${p.drug1}|${p.drug2}`} pair={p} />)
              )}
            </section>

            {result.food_interactions.length > 0 && (
              <section className={`space-y-3 ${stale ? 'opacity-60' : ''}`}>
                <SectionLabel>{t('Food & drink')}</SectionLabel>
                <Card padded={false} className="divide-y divide-line overflow-hidden">
                  {result.food_interactions.map((f, i) => (
                    <div key={`${f.selected_drug}-${f.food_name}-${i}`} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[15px] font-semibold text-ink">
                          {f.selected_drug} <span className="font-normal text-muted">+</span> {f.food_name}
                        </p>
                        <SeverityBadge severity={normaliseSeverity(f.level)} />
                      </div>
                      {(f.interaction || f.management) && <p className="mt-1 text-[14px] leading-relaxed text-body">{f.management ?? f.interaction}</p>}
                    </div>
                  ))}
                </Card>
              </section>
            )}

            {result.disease_interactions.length > 0 && (
              <section className={`space-y-3 ${stale ? 'opacity-60' : ''}`}>
                <SectionLabel>{t('Conditions to watch')}</SectionLabel>
                <Card padded={false} className="divide-y divide-line overflow-hidden">
                  {result.disease_interactions.map((d, i) => (
                    <div key={`${d.selected_drug}-${d.disease_name}-${i}`} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[15px] font-semibold text-ink">
                          {d.selected_drug} <span className="font-normal text-muted">·</span> {d.disease_name}
                        </p>
                        <SeverityBadge severity={normaliseSeverity(d.level)} />
                      </div>
                      {d.text && <p className="mt-1 text-[14px] leading-relaxed text-body">{d.text}</p>}
                    </div>
                  ))}
                </Card>
              </section>
            )}

            <Card tone="warn" className="flex items-start gap-3">
              <AlertIcon size={20} className="mt-0.5 flex-none text-[var(--warn)]" />
              <p className="text-[14px] leading-relaxed text-body">
                {t('Not every interaction is listed, and some listed ones may not apply to you. Never stop or change a medicine without talking to your doctor or pharmacist.')}
              </p>
            </Card>
          </>
        )}

        {!result && !checking && !error && drugs.length < 2 && (
          <Card padded={false}>
            <EmptyState art="search" title={t('Check your medicines together')} body={t('Type a brand or generic name and pick it from the list. Add everything you take, including over-the-counter medicines.')} />
          </Card>
        )}

        <Disclaimer compact />
      </main>
    </div>
  )
}
