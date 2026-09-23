import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Card, { SectionLabel } from '../components/Card'
import Chip, { ChipRow } from '../components/Chip'
import Disclaimer from '../components/Disclaimer'
import EmptyState from '../components/EmptyState'
import ErrorCard from '../components/ErrorCard'
import { ChevronRightIcon, ExternalIcon, PillIcon } from '../components/Icons'
import InfusionCalculator from '../components/InfusionCalculator'
import IvGlanceCard from '../components/IvGlanceCard'
import { TextBadge } from '../components/PillRow'
import ReviewedBy from '../components/ReviewedBy'
import ShortageCard from '../components/ShortageCard'
import { Skeleton } from '../components/Skeleton'
import { ApiError, getIvDrug, getIvLabelSections, isIntravenous, ivPageUrl, type AdverseReactionsContent, type DosageContent, type IvDrug } from '../lib/api'
import { useBackHandler } from '../lib/backstack'
import { shortDate } from '../lib/format'
import { IV_TABS, ivPath, type IvTab } from '../lib/goals'
import { useT } from '../lib/i18n'
import { hapticTick, openUrl } from '../lib/native'
import { shortageForDrug, type Shortage } from '../lib/shortages'
import { BoxedWarning, DosageBody, SideEffectsBody } from './SectionScreen'

type Sections = DosageContent & AdverseReactionsContent

const STRENGTHS_SHOWN = 8
// the FDA writes units in UCUM codes; "5000 units/mL" reads better on a phone than "5000 [USP'U]/mL"
const UNIT_CODES: Array<[RegExp, string]> = [
  [/\[USP'U\]/g, 'units'],
  [/\[iU\]/g, 'IU'],
  [/\[arb'U\]/g, 'arb. units'],
  [/\[hp_X\]/g, 'X'],
  [/\bug\b/g, 'mcg'],
]

export function prettyStrength(s: string): string {
  return UNIT_CODES.reduce((out, [re, word]) => out.replace(re, word), s).replace(/\/(\d*\.?\d+)mL/g, '/$1 mL').replace(/\/\.(\d)/g, '/0.$1')
}
// some injections are also labelled for a non-injection route (vancomycin vials can be given by mouth);
// on this screen that reads as a mistake, so the header lists injection routes only
const NON_INJECTION_ROUTES = /oral|topical|ophthalmic|rectal|nasal|irrigation|inhalation|dental/i

function ScreenSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-40 w-full rounded-card" />
      <Skeleton className="h-56 w-full rounded-card" />
    </div>
  )
}

function StrengthRows({ rows }: { rows: IvDrug['strengths'] }) {
  const t = useT()
  return (
    <ul className="divide-y divide-line">
      {rows.map((s) => (
        <li key={`${s.strength}|${s.form}`} className="flex items-baseline gap-3 px-4 py-2.5">
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-ink">{prettyStrength(s.strength)}</span>
            <span className="block text-[13px] text-muted">{s.form}</span>
          </span>
          <span className="flex-none text-[13px] text-muted">{s.makers === 1 ? t('1 maker') : t('{n} makers', { n: s.makers })}</span>
        </li>
      ))}
    </ul>
  )
}

function Strengths({ drug }: { drug: IvDrug }) {
  const t = useT()
  const [all, setAll] = useState(false)
  if (drug.strengths.length === 0) return null
  // the strengths most makers sell come first; the full list is one tap away
  const common = [...drug.strengths].sort((a, b) => b.makers - a.makers).slice(0, STRENGTHS_SHOWN)
  const shown = all ? drug.strengths : drug.strengths.filter((s) => common.includes(s))
  return (
    <section>
      <SectionLabel>{t('Strengths and forms')}</SectionLabel>
      <Card padded={false} className="overflow-hidden">
        <p className="px-4 pt-3 text-[13px] text-muted">
          {t('{products} products from {makers} manufacturers.', { products: drug.product_count, makers: drug.maker_count })}
        </p>
        <StrengthRows rows={shown} />
        {drug.strengths.length > shown.length && (
          <button
            type="button"
            onClick={() => {
              void hapticTick()
              setAll(true)
            }}
            className="pressable flex min-h-[44px] w-full items-center justify-center text-[14px] font-semibold text-brand"
          >
            {t('Show all {n} strengths', { n: drug.strengths.length })}
          </button>
        )}
      </Card>
    </section>
  )
}

/**
 * One injection drug, pushed over the tabs like the pill screen: the approved "at a glance" card, the FDA shortage
 * line, the infusion calculator (IV drugs only), strengths, then the label's Dosage and Side effects on their own
 * tabs, rendered by the same code as the pill label sections. Everything comes from the website's API; the
 * website itself is only offered when something fails to load.
 */
export default function IvDrugScreen({ slug, tab }: { slug: string; tab: IvTab }) {
  const navigate = useNavigate()
  const t = useT()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [drug, setDrug] = useState<IvDrug | null>(null)
  const [sections, setSections] = useState<Sections | null>(null)
  const [sectionsFailed, setSectionsFailed] = useState<ApiError | null>(null)
  const [shortage, setShortage] = useState<Shortage | null | undefined>(undefined)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate('/home', { replace: true }))
  useBackHandler(true, goBack)

  useEffect(() => {
    const ctrl = new AbortController()
    setLoading(true)
    setError(null)
    setDrug(null)
    setSections(null)
    setSectionsFailed(null)
    setShortage(undefined)
    scrollRef.current?.scrollTo({ top: 0 })
    getIvDrug(slug, ctrl.signal)
      .then((d) => {
        if (ctrl.signal.aborted) return
        setDrug(d)
        setLoading(false)
        // the label text and the shortage line load after the screen is up; neither failing hides the drug
        void getIvLabelSections(slug, ctrl.signal)
          .then((s) => !ctrl.signal.aborted && setSections(s))
          .catch((err: unknown) => !ctrl.signal.aborted && setSectionsFailed(err instanceof ApiError ? err : new ApiError('unknown', t('Could not load the label.'))))
        void shortageForDrug(d.name, ctrl.signal).then((s) => !ctrl.signal.aborted && setShortage(s))
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return
        setError(err instanceof ApiError ? err : new ApiError('unknown', t('Could not load this drug.')))
        setLoading(false)
      })
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, reloadKey])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [tab])

  const switchTo = (next: IvTab) => {
    if (next === tab) return
    void hapticTick()
    navigate(ivPath(slug, next), { replace: true })
  }

  /** A "[see …]" link inside label text: jump when the heading is on this screen, otherwise nothing to open here. */
  const handleRef = useCallback((id: string) => {
    const el = scrollRef.current?.querySelector(`#${CSS.escape(id)}`) as HTMLElement | null
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const intravenous = drug ? isIntravenous(drug.routes) : true
  const routes = drug ? drug.routes.filter((r) => !NON_INJECTION_ROUTES.test(r)) : []
  const tabs: IvTab[] = ['overview', ...(drug?.label_pages.has_dosage ? (['dosage'] as IvTab[]) : []), ...(drug?.label_pages.has_adverse_reactions ? (['side-effects'] as IvTab[]) : [])]
  const sourceUrl = sections?.source_url ?? drug?.label.source_url ?? null
  const labelEmpty =
    sections !== null &&
    ((tab === 'dosage' && !sections.dosage_administration && !sections.dosage_forms_and_strengths) || (tab === 'side-effects' && !sections.adverse_reactions))

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-canvas animate-fade-up">
      <div
        className="sticky top-0 z-20 bg-[color-mix(in_srgb,var(--canvas)_95%,transparent)] backdrop-blur"
        style={{ paddingTop: 'calc(var(--safe-top) + 6px)', paddingLeft: 'max(8px, var(--safe-left))', paddingRight: 'max(8px, var(--safe-right))' }}
      >
        <div className="flex items-center gap-2 px-0 pb-1">
          <button type="button" onClick={goBack} aria-label={t('Back')} className="pressable flex h-11 min-w-[44px] items-center gap-0.5 rounded-full px-2 text-[17px] font-medium text-brand">
            <ChevronRightIcon size={22} className="rotate-180" />
            {t('Back')}
          </button>
          <p className="min-w-0 flex-1 truncate text-center text-[17px] font-semibold text-ink">{drug?.name ?? t('Injection drug')}</p>
          <span className="w-11" aria-hidden />
        </div>
        {drug && tabs.length > 1 && (
          <div className="mx-auto max-w-lg px-2 pb-2">
            <ChipRow label={t('Section')}>
              {tabs.map((id) => (
                <Chip key={id} selected={id === tab} onClick={() => switchTo(id)}>
                  {id === 'overview' ? (intravenous ? t('IV administration') : t('Administration')) : t(IV_TABS[id])}
                </Chip>
              ))}
            </ChipRow>
          </div>
        )}
      </div>

      <main className="screen mx-auto max-w-lg space-y-4 px-4 pb-8 pt-2" style={{ paddingLeft: 'max(16px, var(--safe-left))', paddingRight: 'max(16px, var(--safe-right))' }}>
        {loading && <ScreenSkeleton />}
        {error && !loading && (
          <ErrorCard error={error} onRetry={() => setReloadKey((k) => k + 1)} secondary={{ label: t('Open on pillseek.com'), onClick: () => void openUrl(ivPageUrl(slug)) }} />
        )}

        {drug && !loading && (
          <>
            <div className="px-1">
              <div className="flex flex-wrap items-center gap-2">
                <TextBadge tone="brand">{intravenous ? t('IV') : t('Injection')}</TextBadge>
                {drug.dea_schedule && <TextBadge tone="amber">{t('Schedule {n}', { n: drug.dea_schedule.replace(/^C/i, '') })}</TextBadge>}
                {drug.label_pages.has_boxed_warning && <TextBadge tone="danger">{t('Boxed warning')}</TextBadge>}
              </div>
              <h1 className="mt-2 text-[26px] font-bold leading-tight tracking-tight text-ink">{drug.name}</h1>
              {drug.brand_names.length > 0 && <p className="mt-1 text-[15px] text-body">{t('Brands: {names}', { names: drug.brand_names.slice(0, 4).join(', ') })}</p>}
              <p className="mt-1 text-[14px] text-muted">
                {t('Injection ({routes})', { routes: routes.join(', ') || t('Intravenous') })}
                {drug.drug_class.length > 0 && ` · ${drug.drug_class.join('; ')}`}
              </p>
            </div>
            <ReviewedBy lastVerified={drug.card?.reviewed_at ?? drug.updated_at} />

            {tab === 'overview' && (
              <>
                {shortage && <ShortageCard shortage={shortage} />}
                {sections?.boxed_warning_html && <BoxedWarning html={sections.boxed_warning_html} onRef={handleRef} />}
                <IvGlanceCard drug={drug} />
                {!drug.card && (
                  <Card tone="tint" className="text-[14px] text-body">
                    {t('No reviewed "at a glance" card for this drug yet. The Dosage and Side effects tabs show the FDA label.')}
                  </Card>
                )}
                {intravenous && <InfusionCalculator />}
                <Strengths drug={drug} />
                {drug.pill_drugs.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      void hapticTick()
                      navigate(`/search?type=drug&q=${encodeURIComponent(drug.pill_drugs[0]?.name ?? drug.name)}`)
                    }}
                    className="pressable card flex min-h-[56px] w-full items-center gap-3 px-4 text-left active:bg-brand-tint"
                  >
                    <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-brand-tint text-brand">
                      <PillIcon size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold text-ink">{t('Also comes as a pill')}</span>
                      <span className="block text-[13px] text-muted">{t('See the tablets and capsules')}</span>
                    </span>
                    <ChevronRightIcon size={18} className="flex-none text-muted" />
                  </button>
                )}
              </>
            )}

            {tab !== 'overview' && (
              <>
                {!sections && !sectionsFailed && <ScreenSkeleton />}
                {sectionsFailed && <ErrorCard error={sectionsFailed} onRetry={() => setReloadKey((k) => k + 1)} secondary={{ label: t('Open on pillseek.com'), onClick: () => void openUrl(`${ivPageUrl(slug)}/${tab}`) }} />}
                {labelEmpty && (
                  <Card padded={false}>
                    <EmptyState art="pill" title={t('No {section} available', { section: t(IV_TABS[tab]).toLowerCase() })} body={t("The FDA label of this drug doesn't include this section yet.")} />
                  </Card>
                )}
                {sections && !labelEmpty && tab === 'dosage' && <DosageBody data={sections} onRef={handleRef} />}
                {sections && !labelEmpty && tab === 'side-effects' && <SideEffectsBody data={sections} onRef={handleRef} />}
              </>
            )}

            <button
              type="button"
              onClick={() => sourceUrl && void openUrl(sourceUrl)}
              disabled={!sourceUrl}
              className="pressable flex w-full items-center justify-center gap-1.5 px-2 py-1 text-[13px] text-muted disabled:opacity-100"
            >
              {t('Source: FDA label via DailyMed')}
              {sections?.fetched_at && ` · ${shortDate(sections.fetched_at)}`}
              {sourceUrl && <ExternalIcon size={13} />}
            </button>
            <Disclaimer compact />
          </>
        )}
      </main>
    </div>
  )
}
