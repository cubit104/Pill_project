import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Card, { SectionLabel } from '../components/Card'
import Chip, { ChipRow } from '../components/Chip'
import Disclaimer from '../components/Disclaimer'
import ReviewedBy from '../components/ReviewedBy'
import EmptyState from '../components/EmptyState'
import ErrorCard from '../components/ErrorCard'
import { AlertIcon, ChevronRightIcon, ExternalIcon } from '../components/Icons'
import { TextBadge } from '../components/PillRow'
import PriceSparkline from '../components/PriceSparkline'
import Sheet from '../components/Sheet'
import { Skeleton } from '../components/Skeleton'
import {
  ApiError,
  getAdverseReactions,
  getDosage,
  getGuide,
  getPill,
  getPriceSnapshot,
  pillSectionUrl,
  type AdverseReactionsContent,
  type DosageContent,
  type GuideContent,
  type PillDetail,
  type PriceSnapshot,
} from '../lib/api'
import { useBackHandler } from '../lib/backstack'
import { money, shortDate } from '../lib/format'
import { SECTIONS, sectionPath, type Section } from '../lib/goals'
import { useT } from '../lib/i18n'
import { interactionsPath } from '../lib/interactions'
import { cleanLabelHtml, findSectionForRef, splitLabelSections, type LabelSection } from '../lib/labelHtml'
import { hapticTick, openUrl } from '../lib/native'

type Content =
  | { kind: 'dosage'; data: DosageContent }
  | { kind: 'adverse-reactions'; data: AdverseReactionsContent }
  | { kind: 'medication-guide'; data: GuideContent }
  | { kind: 'professional-information'; data: GuideContent }
  | { kind: 'price'; data: PriceSnapshot | null }

const SECTION_KEYS = Object.keys(SECTIONS) as Section[]

async function loadContent(section: Section, pill: PillDetail, signal: AbortSignal): Promise<Content> {
  switch (section) {
    case 'dosage':
      return { kind: section, data: await getDosage(pill.slug, signal) }
    case 'adverse-reactions':
      return { kind: section, data: await getAdverseReactions(pill.slug, signal) }
    case 'medication-guide':
      return { kind: section, data: await getGuide(pill, { medguide: true }, signal) }
    case 'professional-information':
      return { kind: section, data: await getGuide(pill, { professional: true }, signal) }
    case 'price':
      return { kind: section, data: await getPriceSnapshot(pill.slug, signal) }
  }
}

/** "Plavix 300 mg · clopidogrel" — strength cleaned of label punctuation, generic only when it adds something. */
function subtitle(pill: PillDetail): string {
  const strength = (pill.strength ?? '').replace(/[;,.\s]+$/, '').trim()
  const generic = (pill.generic_name ?? '').trim().toLowerCase()
  const head = pill.drug_name.toLowerCase()
  const parts = [strength && !strength.toLowerCase().startsWith(head) ? `${pill.drug_name} ${strength}` : strength || pill.drug_name]
  if (generic && generic !== head && !strength.toLowerCase().includes(generic)) parts.push(generic)
  return parts.join(' · ')
}

/** A cross-reference inside label text was tapped: id is the target heading id. */
type RefHandler = (id: string) => void

/** Sanitised label HTML inside a card; in-label links become jumps via `onRef`. */
function LabelHtml({ html, warning = false, dropLeadingHeading = false, onRef }: { html: string | null; warning?: boolean; dropLeadingHeading?: boolean; onRef?: RefHandler }) {
  const clean = useMemo(() => cleanLabelHtml(html, { dropLeadingHeading }), [html, dropLeadingHeading])
  if (!clean) return null
  return (
    <div
      className={`label-html ${warning ? 'label-html--warning' : ''}`}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a[href^="#"]')
        if (!a) return
        e.preventDefault()
        const id = decodeURIComponent((a.getAttribute('href') ?? '').slice(1))
        if (id && onRef) onRef(id)
      }}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  )
}

/** Tap-to-expand card row (prescribing information sections, highlights). Controlled when `open` is given. */
function Collapsible({
  title,
  hint,
  defaultOpen = false,
  open: openProp,
  onToggle,
  id,
  children,
}: {
  title: string
  hint?: string
  defaultOpen?: boolean
  open?: boolean
  onToggle?: () => void
  id?: string
  children: ReactNode
}) {
  const [openState, setOpenState] = useState(defaultOpen)
  const open = openProp ?? openState
  const toggle = () => {
    void hapticTick()
    if (onToggle) onToggle()
    else setOpenState((v) => !v)
  }
  return (
    <div id={id} className="scroll-mt-32">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="pressable flex min-h-[52px] w-full items-center gap-3 px-4 py-3 text-left active:bg-brand-tint"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-semibold text-ink">{title}</span>
          {hint && <span className="block text-[13px] text-muted">{hint}</span>}
        </span>
        <ChevronRightIcon size={20} className={`flex-none text-muted transition-transform duration-fast ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && <div className="px-4 pb-4 pt-1">{children}</div>}
    </div>
  )
}

function BoxedWarning({ html, onRef }: { html: string | null; onRef?: RefHandler }) {
  const t = useT()
  if (!html) return null
  return (
    <Card tone="danger" padded={false} className="overflow-hidden">
      <Collapsible
        title={t('Boxed warning')}
        hint={t("The FDA's most serious warning · tap to read")}
        defaultOpen={false}
      >
        <LabelHtml html={html} warning onRef={onRef} />
      </Collapsible>
    </Card>
  )
}

function SectionSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-7 w-1/2" />
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-40 w-full rounded-card" />
      <Skeleton className="h-56 w-full rounded-card" />
    </div>
  )
}

function NothingHere({ label, onOpenSite }: { label: string; onOpenSite: () => void }) {
  const t = useT()
  return (
    <Card padded={false}>
      <EmptyState
        art="pill"
        title={t('No {section} available', { section: t(label).toLowerCase() })}
        body={t("The FDA label linked to this pill doesn't include this section yet.")}
        action={
          <button type="button" onClick={onOpenSite} className="pressable inline-flex min-h-[44px] items-center gap-1 text-[15px] font-semibold text-brand">
            {t('Check on pillseek.com')} <ExternalIcon size={16} />
          </button>
        }
      />
    </Card>
  )
}

function DosageBody({ data, onRef }: { data: DosageContent; onRef: RefHandler }) {
  const t = useT()
  return (
    <>
      <BoxedWarning html={data.boxed_warning_html} onRef={onRef} />
      {data.dosage_forms_and_strengths && (
        <section>
          <SectionLabel>{t('Forms & strengths')}</SectionLabel>
          <Card>
            <LabelHtml html={data.dosage_forms_and_strengths} onRef={onRef} />
          </Card>
        </section>
      )}
      {data.dosage_administration && (
        <section>
          <SectionLabel>{t('Dosage & administration')}</SectionLabel>
          <Card>
            <LabelHtml html={data.dosage_administration} dropLeadingHeading onRef={onRef} />
          </Card>
        </section>
      )}
    </>
  )
}

function SideEffectsBody({ data, onRef }: { data: AdverseReactionsContent; onRef: RefHandler }) {
  const t = useT()
  return (
    <>
      <BoxedWarning html={data.boxed_warning_html} onRef={onRef} />
      <section>
        <SectionLabel>{t('From the FDA label')}</SectionLabel>
        <Card>
          <LabelHtml html={data.adverse_reactions} dropLeadingHeading onRef={onRef} />
        </Card>
      </section>
      <Card tone="warn" className="flex items-start gap-3">
        <AlertIcon size={20} className="mt-0.5 flex-none text-[var(--warn)]" />
        <p className="text-[14px] leading-relaxed text-body">
          {t('Call your doctor for medical advice about side effects. In the US you can report side effects to the FDA at 1-800-FDA-1088.')}
        </p>
      </Card>
    </>
  )
}

function MedGuideBody({ data, onRef }: { data: GuideContent; onRef: RefHandler }) {
  const t = useT()
  if (data.medguide_html) {
    return (
      <>
        <BoxedWarning html={data.boxed_warning_html} onRef={onRef} />
        <section>
          <SectionLabel>{t('Medication guide')}</SectionLabel>
          <Card>
            <LabelHtml html={data.medguide_html} dropLeadingHeading onRef={onRef} />
          </Card>
        </section>
      </>
    )
  }
  if (data.summary.length > 0) {
    return (
      <>
        <BoxedWarning html={data.boxed_warning_html} onRef={onRef} />
        {data.summary_notice && (
          <Card tone="tint" className="text-[14px] leading-relaxed text-body">
            {data.summary_notice}
          </Card>
        )}
        <section className="space-y-3">
          <SectionLabel>{t('Plain-language summary')}</SectionLabel>
          {data.summary.map((qa) => (
            <Card key={qa.question}>
              <p className="text-[16px] font-semibold text-ink">{qa.question}</p>
              <p className="selectable mt-1.5 text-[15px] leading-relaxed text-body">{qa.answer}</p>
            </Card>
          ))}
        </section>
      </>
    )
  }
  return null
}

interface ProfessionalProps {
  data: GuideContent
  /** Reference that could not be resolved inside this label (bubbles up to the screen). */
  onRef: RefHandler
  /** Heading id to open and scroll to (from a tapped cross-reference or ?ref=). */
  focusRef: string | null
  onFocusHandled: () => void
  contentsOpen: boolean
  onCloseContents: () => void
  scrollRoot: React.RefObject<HTMLDivElement | null>
}

function ProfessionalBody({ data, onRef, focusRef, onFocusHandled, contentsOpen, onCloseContents, scrollRoot }: ProfessionalProps) {
  const t = useT()
  const sections = useMemo<LabelSection[]>(
    () => splitLabelSections(data.professional_html, data.professional_sections).filter((s) => s.id !== 'boxed-warning'),
    [data.professional_html, data.professional_sections],
  )
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set())
  const [highlightsOpen, setHighlightsOpen] = useState(true)

  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  /** Open the section holding `ref` and scroll to the exact heading (or the section header). */
  const jumpTo = useCallback(
    (ref: string): boolean => {
      const target = findSectionForRef(sections, ref)
      if (!target) return false
      setOpenIds((prev) => (prev.has(target.id) ? prev : new Set(prev).add(target.id)))
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const root = scrollRoot.current
          const el = (root?.querySelector(`#${CSS.escape(ref)}`) ?? root?.querySelector(`#sec-${CSS.escape(target.id)}`)) as HTMLElement | null
          el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }),
      )
      return true
    },
    [sections, scrollRoot],
  )

  useEffect(() => {
    if (!focusRef) return
    if (!jumpTo(focusRef)) onRef(focusRef)
    onFocusHandled()
  }, [focusRef, jumpTo, onRef, onFocusHandled])

  const handleRef: RefHandler = (id) => {
    if (!jumpTo(id)) onRef(id)
  }

  if (!data.professional_html && !data.professional_highlights_html) return null
  return (
    <>
      <BoxedWarning html={data.boxed_warning_html} onRef={handleRef} />
      {data.professional_highlights_html && (
        <Card padded={false} className="overflow-hidden">
          <Collapsible title={t('Highlights')} hint={t('Key points from the prescribing information')} open={highlightsOpen} onToggle={() => setHighlightsOpen((v) => !v)}>
            <LabelHtml html={data.professional_highlights_html} dropLeadingHeading onRef={handleRef} />
          </Collapsible>
        </Card>
      )}
      {sections.length > 0 ? (
        <section>
          <SectionLabel>{t('Full prescribing information')}</SectionLabel>
          <Card padded={false} className="divide-y divide-line overflow-hidden">
            {sections.map((s, i) => (
              <Collapsible key={s.id} id={`sec-${s.id}`} title={`${i + 1}. ${s.title}`} open={openIds.has(s.id)} onToggle={() => toggle(s.id)}>
                <LabelHtml html={s.html} onRef={handleRef} />
              </Collapsible>
            ))}
          </Card>
        </section>
      ) : (
        data.professional_html && (
          <Card>
            <LabelHtml html={data.professional_html} onRef={handleRef} />
          </Card>
        )
      )}

      <Sheet open={contentsOpen} onClose={onCloseContents} title={t('Contents')}>
        <div className="mb-2 flex gap-2">
          <button
            type="button"
            onClick={() => {
              void hapticTick()
              setOpenIds(new Set(sections.map((s) => s.id)))
            }}
            className="pressable flex-1 rounded-full bg-brand-tint px-3 py-2 text-[14px] font-semibold text-brand"
          >
            {t('Expand all')}
          </button>
          <button
            type="button"
            onClick={() => {
              void hapticTick()
              setOpenIds(new Set())
            }}
            className="pressable flex-1 rounded-full bg-brand-tint px-3 py-2 text-[14px] font-semibold text-brand"
          >
            {t('Collapse all')}
          </button>
        </div>
        <ol className="-mx-2 max-h-[60vh] divide-y divide-line overflow-y-auto">
          {sections.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => {
                  void hapticTick()
                  onCloseContents()
                  jumpTo(s.id)
                }}
                className="pressable flex min-h-[48px] w-full items-center gap-3 rounded-xl px-2 text-left text-[16px] text-ink active:bg-brand-tint"
              >
                <span className="tabular w-6 flex-none text-right text-[14px] text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{s.title}</span>
                {openIds.has(s.id) && <span className="text-[12px] font-medium text-brand">{t('Open')}</span>}
              </button>
            </li>
          ))}
        </ol>
      </Sheet>
    </>
  )
}

function PriceBody({ data, pill }: { data: PriceSnapshot; pill: PillDetail }) {
  const t = useT()
  const unit = (data.unit ?? 'unit').toLowerCase()
  const first = data.history[0]
  const last = data.history[data.history.length - 1]
  const change = first && last && first.price_per_unit > 0 ? ((last.price_per_unit - first.price_per_unit) / first.price_per_unit) * 100 : null
  return (
    <>
      <Card tone="tint">
        <p className="text-[13px] text-muted">{t('Fair retail, 30-day supply')}</p>
        <p className="tabular mt-0.5 text-[30px] font-bold tracking-tight text-ink">
          {data.fair_retail_low !== null && data.fair_retail_high !== null
            ? `${money(data.fair_retail_low, { compact: true })} – ${money(data.fair_retail_high, { compact: true })}`
            : money(data.total_acquisition_cost, { compact: true })}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <p className="text-[13px] text-muted">{t('Pharmacy cost')}</p>
            <p className="tabular text-[17px] font-semibold text-ink">
              {money(data.price_per_unit)}
              <span className="text-[13px] font-normal text-muted">/{unit}</span>
            </p>
          </div>
          <div>
            <p className="text-[13px] text-muted">{t('30 days at cost')}</p>
            <p className="tabular text-[17px] font-semibold text-ink">{money(data.total_acquisition_cost, { compact: true })}</p>
          </div>
        </div>
        <p className="mt-3 text-[12px] leading-snug text-muted">
          {data.is_estimate ? `${t('Estimate.')} ` : ''}
          {data.display_disclaimer ?? t('NADAC pharmacy acquisition cost (CMS). Your price depends on pharmacy and insurance.')}
          {data.effective_date && ` ${t('Data from {date}.', { date: shortDate(data.effective_date) ?? '' })}`}
        </p>
      </Card>

      {first && last && data.history.length >= 2 && (
        <section>
          <SectionLabel>{t('Pharmacy cost over time')}</SectionLabel>
          <Card>
            <div className="flex items-baseline justify-between gap-3">
              <p className="tabular text-[17px] font-semibold text-ink">
                {money(last.price_per_unit)}
                <span className="text-[13px] font-normal text-muted">/{unit}</span>
              </p>
              {change !== null && (
                <TextBadge tone={change > 2 ? 'amber' : 'brand'}>
                  {t('{change}% vs {date}', { change: `${change > 0 ? '+' : ''}${change.toFixed(0)}`, date: shortDate(first.effective_date) ?? '' })}
                </TextBadge>
              )}
            </div>
            <PriceSparkline points={data.history} className="mt-3" />
          </Card>
        </section>
      )}

      {data.alternatives.length > 0 && (
        <section>
          <SectionLabel>{t('Alternatives')}</SectionLabel>
          <Card padded={false} className="divide-y divide-line overflow-hidden">
            {data.alternatives.map((alt) => (
              <div key={`${alt.ndc ?? alt.name}`} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-ink">{alt.name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
                    {alt.kind && <TextBadge tone="neutral">{alt.kind}</TextBadge>}
                    {alt.is_cheapest && <TextBadge tone="brand">{t('Lowest cost')}</TextBadge>}
                  </p>
                </div>
                <p className="tabular flex-none text-right text-[16px] font-semibold text-ink">
                  {money(alt.price_per_unit)}
                  <span className="block text-[12px] font-normal text-muted">/{(alt.unit ?? 'unit').toLowerCase()}</span>
                </p>
              </div>
            ))}
          </Card>
          <p className="mt-2 px-1 text-[12px] text-muted">{t('Same active ingredient as {name}. Ask your pharmacist before switching.', { name: pill.generic_name ?? pill.drug_name })}</p>
        </section>
      )}
    </>
  )
}

/**
 * Native section screen: one FDA label section (or the price guide) for a pill,
 * pushed over the tabs at /pill/:slug/:section. A chip row switches sections in
 * place; Back returns to wherever the user came from.
 */
export default function SectionScreen({ slug, section }: { slug: string; section: Section }) {
  const navigate = useNavigate()
  const t = useT()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<PillDetail | null>(null)
  const [pillError, setPillError] = useState<ApiError | null>(null)
  const [content, setContent] = useState<Content | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [params] = useSearchParams()
  const refParam = params.get('ref')
  // Cross-reference to open once the prescribing information has loaded.
  const [focusRef, setFocusRef] = useState<string | null>(refParam)
  useEffect(() => {
    if (refParam) setFocusRef(refParam)
  }, [refParam])
  const onFocusHandled = useCallback(() => setFocusRef(null), [])
  const [contentsOpen, setContentsOpen] = useState(false)

  /** A "[see …]" link: same screen if the heading is here, else open it in Prescribing information. */
  const handleRef = useCallback(
    (id: string) => {
      const el = scrollRef.current?.querySelector(`#${CSS.escape(id)}`) as HTMLElement | null
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
      if (section === 'professional-information') {
        setFocusRef(id)
        return
      }
      void hapticTick()
      navigate(`${sectionPath(slug, 'professional-information')}?ref=${encodeURIComponent(id)}`)
    },
    [section, slug, navigate],
  )

  const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate('/home', { replace: true }))
  useBackHandler(true, goBack)

  // The pill record (name + label identifiers) is loaded once per slug.
  useEffect(() => {
    const ctrl = new AbortController()
    setPill(null)
    setPillError(null)
    getPill(slug, ctrl.signal)
      .then((p) => !ctrl.signal.aborted && setPill(p))
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return
        setPillError(err instanceof ApiError ? err : new ApiError('unknown', t('Could not load this pill.')))
        setLoading(false)
      })
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, reloadKey])

  // Section content reloads whenever the chip row changes the section.
  useEffect(() => {
    if (!pill) return
    const ctrl = new AbortController()
    setLoading(true)
    setError(null)
    setContent(null)
    scrollRef.current?.scrollTo({ top: 0 })
    loadContent(section, pill, ctrl.signal)
      .then((c) => {
        if (ctrl.signal.aborted) return
        setContent(c)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return
        setError(err instanceof ApiError ? err : new ApiError('unknown', t('Could not load this section.')))
        setLoading(false)
      })
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pill, section, reloadKey])

  const switchTo = (s: Section) => {
    if (s === section) return
    void hapticTick()
    navigate(sectionPath(slug, s), { replace: true })
  }
  const siteUrl = pillSectionUrl(slug, section)
  const meta = SECTIONS[section]
  const labelMeta = content && content.kind !== 'price' ? content.data : null
  const notFound = error?.kind === 'not_found'
  const emptyContent =
    content !== null &&
    ((content.kind === 'price' && content.data === null) ||
      (content.kind === 'dosage' && !content.data.dosage_administration && !content.data.dosage_forms_and_strengths) ||
      (content.kind === 'adverse-reactions' && !content.data.adverse_reactions) ||
      (content.kind === 'medication-guide' && !content.data.medguide_html && content.data.summary.length === 0) ||
      (content.kind === 'professional-information' && !content.data.professional_html && !content.data.professional_highlights_html))

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-canvas animate-fade-up">
      <div
        className="sticky top-0 z-20 bg-[color-mix(in_srgb,var(--canvas)_95%,transparent)] backdrop-blur"
        style={{ paddingTop: 'calc(var(--safe-top) + 6px)', paddingLeft: 'max(8px, var(--safe-left))', paddingRight: 'max(8px, var(--safe-right))' }}
      >
        <div className="flex items-center gap-2 px-0 pb-1">
          <button
            type="button"
            onClick={goBack}
            aria-label={t('Back')}
            className="pressable flex h-11 min-w-[44px] items-center gap-0.5 rounded-full px-2 text-[17px] font-medium text-brand"
          >
            <ChevronRightIcon size={22} className="rotate-180" />
            {t('Back')}
          </button>
          <p className="min-w-0 flex-1 truncate text-center text-[17px] font-semibold text-ink">{pill?.drug_name ?? t('Pill')}</p>
          {section === 'professional-information' && content?.kind === 'professional-information' && (
            <button
              type="button"
              onClick={() => {
                void hapticTick()
                setContentsOpen(true)
              }}
              className="pressable flex h-11 items-center rounded-full px-3 text-[15px] font-semibold text-brand"
            >
              {t('Contents')}
            </button>
          )}
        <span className="w-11" aria-hidden />
        </div>
        <div className="mx-auto max-w-lg px-2 pb-2">
          <ChipRow label={t('Section')}>
            {SECTION_KEYS.map((s) => (
              <Chip key={s} selected={s === section} onClick={() => switchTo(s)}>
                {t(SECTIONS[s].short)}
              </Chip>
            ))}
            <Chip selected={false} onClick={() => navigate(interactionsPath(pill?.generic_name ?? pill?.drug_name ?? ''))}>
              {t('Interactions')}
            </Chip>
          </ChipRow>
        </div>
      </div>

      <main
        className="screen mx-auto max-w-lg space-y-4 px-4 pb-8 pt-2"
        style={{ paddingLeft: 'max(16px, var(--safe-left))', paddingRight: 'max(16px, var(--safe-right))' }}
      >
        <div className="px-1">
          <h1 className="text-[26px] font-bold leading-tight tracking-tight text-ink">{t(meta.label)}</h1>
          {pill && <p className="mt-1 text-[15px] text-muted">{subtitle(pill)}</p>}
          {labelMeta && !loading && <ReviewedBy lastVerified={labelMeta.fetched_at} className="-mx-1 mt-2" />}
        </div>

        {loading && !pillError && <SectionSkeleton />}

        {pillError && (
          <ErrorCard error={pillError} onRetry={() => setReloadKey((k) => k + 1)} secondary={{ label: t('Open on pillseek.com'), onClick: () => void openUrl(siteUrl) }} />
        )}

        {error && !loading && !notFound && (
          <ErrorCard error={error} onRetry={() => setReloadKey((k) => k + 1)} secondary={{ label: t('Open on pillseek.com'), onClick: () => void openUrl(siteUrl) }} />
        )}

        {((error && notFound) || emptyContent) && !loading && <NothingHere label={meta.label} onOpenSite={() => void openUrl(siteUrl)} />}

        {content && !loading && !emptyContent && pill && (
          <>
            {content.kind === 'dosage' && <DosageBody data={content.data} onRef={handleRef} />}
            {content.kind === 'adverse-reactions' && <SideEffectsBody data={content.data} onRef={handleRef} />}
            {content.kind === 'medication-guide' && <MedGuideBody data={content.data} onRef={handleRef} />}
            {content.kind === 'professional-information' && (
              <ProfessionalBody
                data={content.data}
                onRef={handleRef}
                focusRef={focusRef}
                onFocusHandled={onFocusHandled}
                contentsOpen={contentsOpen}
                onCloseContents={() => setContentsOpen(false)}
                scrollRoot={scrollRef}
              />
            )}
            {content.kind === 'price' && content.data && <PriceBody data={content.data} pill={pill} />}

            {labelMeta && (
              <button
                type="button"
                onClick={() => labelMeta.source_url && void openUrl(labelMeta.source_url)}
                disabled={!labelMeta.source_url}
                className="pressable flex w-full items-center justify-center gap-1.5 px-2 py-1 text-[13px] text-muted disabled:opacity-100"
              >
                {t('Source: FDA label via DailyMed')}
                {labelMeta.fetched_at && ` · ${shortDate(labelMeta.fetched_at)}`}
                {labelMeta.source_url && <ExternalIcon size={13} />}
              </button>
            )}
            <Disclaimer compact />
          </>
        )}
      </main>
    </div>
  )
}
