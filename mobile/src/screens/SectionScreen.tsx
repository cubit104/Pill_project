import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import Card, { SectionLabel } from '../components/Card'
import Chip, { ChipRow } from '../components/Chip'
import Disclaimer from '../components/Disclaimer'
import EmptyState from '../components/EmptyState'
import ErrorCard from '../components/ErrorCard'
import { AlertIcon, ChevronRightIcon, ExternalIcon } from '../components/Icons'
import { TextBadge } from '../components/PillRow'
import PriceSparkline from '../components/PriceSparkline'
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
import { cleanLabelHtml, splitLabelSections } from '../lib/labelHtml'
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

/** Sanitised label HTML inside a card. */
function LabelHtml({ html, warning = false, dropLeadingHeading = false }: { html: string | null; warning?: boolean; dropLeadingHeading?: boolean }) {
  const clean = useMemo(() => cleanLabelHtml(html, { dropLeadingHeading }), [html, dropLeadingHeading])
  if (!clean) return null
  return <div className={`label-html ${warning ? 'label-html--warning' : ''}`} dangerouslySetInnerHTML={{ __html: clean }} />
}

/** Tap-to-expand card row (prescribing information sections, highlights). */
function Collapsible({ title, hint, defaultOpen = false, children }: { title: string; hint?: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          void hapticTick()
          setOpen((v) => !v)
        }}
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

function BoxedWarning({ html }: { html: string | null }) {
  if (!html) return null
  return (
    <Card tone="danger" padded={false} className="overflow-hidden">
      <Collapsible
        title="Boxed warning"
        hint="The FDA's most serious warning · tap to read"
        defaultOpen={false}
      >
        <LabelHtml html={html} warning />
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
  return (
    <Card padded={false}>
      <EmptyState
        art="pill"
        title={`No ${label.toLowerCase()} available`}
        body="The FDA label linked to this pill doesn't include this section yet."
        action={
          <button type="button" onClick={onOpenSite} className="pressable inline-flex min-h-[44px] items-center gap-1 text-[15px] font-semibold text-brand">
            Check on pillseek.com <ExternalIcon size={16} />
          </button>
        }
      />
    </Card>
  )
}

function DosageBody({ data }: { data: DosageContent }) {
  return (
    <>
      <BoxedWarning html={data.boxed_warning_html} />
      {data.dosage_forms_and_strengths && (
        <section>
          <SectionLabel>Forms &amp; strengths</SectionLabel>
          <Card>
            <LabelHtml html={data.dosage_forms_and_strengths} />
          </Card>
        </section>
      )}
      {data.dosage_administration && (
        <section>
          <SectionLabel>Dosage &amp; administration</SectionLabel>
          <Card>
            <LabelHtml html={data.dosage_administration} dropLeadingHeading />
          </Card>
        </section>
      )}
    </>
  )
}

function SideEffectsBody({ data }: { data: AdverseReactionsContent }) {
  return (
    <>
      <BoxedWarning html={data.boxed_warning_html} />
      <section>
        <SectionLabel>From the FDA label</SectionLabel>
        <Card>
          <LabelHtml html={data.adverse_reactions} dropLeadingHeading />
        </Card>
      </section>
      <Card tone="warn" className="flex items-start gap-3">
        <AlertIcon size={20} className="mt-0.5 flex-none text-[var(--warn)]" />
        <p className="text-[14px] leading-relaxed text-body">
          Call your doctor for medical advice about side effects. In the US you can report side effects to the FDA at 1-800-FDA-1088.
        </p>
      </Card>
    </>
  )
}

function MedGuideBody({ data }: { data: GuideContent }) {
  if (data.medguide_html) {
    return (
      <>
        <BoxedWarning html={data.boxed_warning_html} />
        <section>
          <SectionLabel>Medication guide</SectionLabel>
          <Card>
            <LabelHtml html={data.medguide_html} dropLeadingHeading />
          </Card>
        </section>
      </>
    )
  }
  if (data.summary.length > 0) {
    return (
      <>
        <BoxedWarning html={data.boxed_warning_html} />
        {data.summary_notice && (
          <Card tone="tint" className="text-[14px] leading-relaxed text-body">
            {data.summary_notice}
          </Card>
        )}
        <section className="space-y-3">
          <SectionLabel>Plain-language summary</SectionLabel>
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

function ProfessionalBody({ data }: { data: GuideContent }) {
  const sections = useMemo(
    () => splitLabelSections(data.professional_html, data.professional_sections).filter((s) => s.id !== 'boxed-warning'),
    [data.professional_html, data.professional_sections],
  )
  if (!data.professional_html && !data.professional_highlights_html) return null
  return (
    <>
      <BoxedWarning html={data.boxed_warning_html} />
      {data.professional_highlights_html && (
        <Card padded={false} className="overflow-hidden">
          <Collapsible title="Highlights" hint="Key points from the prescribing information" defaultOpen>
            <LabelHtml html={data.professional_highlights_html} dropLeadingHeading />
          </Collapsible>
        </Card>
      )}
      {sections.length > 0 ? (
        <section>
          <SectionLabel>Full prescribing information</SectionLabel>
          <Card padded={false} className="divide-y divide-line overflow-hidden">
            {sections.map((s) => (
              <Collapsible key={s.id} title={s.title}>
                <LabelHtml html={s.html} />
              </Collapsible>
            ))}
          </Card>
        </section>
      ) : (
        data.professional_html && (
          <Card>
            <LabelHtml html={data.professional_html} />
          </Card>
        )
      )}
    </>
  )
}

function PriceBody({ data, pill }: { data: PriceSnapshot; pill: PillDetail }) {
  const unit = (data.unit ?? 'unit').toLowerCase()
  const first = data.history[0]
  const last = data.history[data.history.length - 1]
  const change = first && last && first.price_per_unit > 0 ? ((last.price_per_unit - first.price_per_unit) / first.price_per_unit) * 100 : null
  return (
    <>
      <Card tone="tint">
        <p className="text-[13px] text-muted">Fair retail, 30-day supply</p>
        <p className="tabular mt-0.5 text-[30px] font-bold tracking-tight text-ink">
          {data.fair_retail_low !== null && data.fair_retail_high !== null
            ? `${money(data.fair_retail_low, { compact: true })} – ${money(data.fair_retail_high, { compact: true })}`
            : money(data.total_acquisition_cost, { compact: true })}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <p className="text-[13px] text-muted">Pharmacy cost</p>
            <p className="tabular text-[17px] font-semibold text-ink">
              {money(data.price_per_unit)}
              <span className="text-[13px] font-normal text-muted">/{unit}</span>
            </p>
          </div>
          <div>
            <p className="text-[13px] text-muted">30 days at cost</p>
            <p className="tabular text-[17px] font-semibold text-ink">{money(data.total_acquisition_cost, { compact: true })}</p>
          </div>
        </div>
        <p className="mt-3 text-[12px] leading-snug text-muted">
          {data.is_estimate ? 'Estimate. ' : ''}
          {data.display_disclaimer ?? 'NADAC pharmacy acquisition cost (CMS). Your price depends on pharmacy and insurance.'}
          {data.effective_date && ` Data from ${shortDate(data.effective_date)}.`}
        </p>
      </Card>

      {first && last && data.history.length >= 2 && (
        <section>
          <SectionLabel>Pharmacy cost over time</SectionLabel>
          <Card>
            <div className="flex items-baseline justify-between gap-3">
              <p className="tabular text-[17px] font-semibold text-ink">
                {money(last.price_per_unit)}
                <span className="text-[13px] font-normal text-muted">/{unit}</span>
              </p>
              {change !== null && (
                <TextBadge tone={change > 2 ? 'amber' : 'brand'}>
                  {change > 0 ? '+' : ''}
                  {change.toFixed(0)}% vs {shortDate(first.effective_date)}
                </TextBadge>
              )}
            </div>
            <PriceSparkline points={data.history} className="mt-3" />
          </Card>
        </section>
      )}

      {data.alternatives.length > 0 && (
        <section>
          <SectionLabel>Alternatives</SectionLabel>
          <Card padded={false} className="divide-y divide-line overflow-hidden">
            {data.alternatives.map((alt) => (
              <div key={`${alt.ndc ?? alt.name}`} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-ink">{alt.name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
                    {alt.kind && <TextBadge tone="neutral">{alt.kind}</TextBadge>}
                    {alt.is_cheapest && <TextBadge tone="brand">Lowest cost</TextBadge>}
                  </p>
                </div>
                <p className="tabular flex-none text-right text-[16px] font-semibold text-ink">
                  {money(alt.price_per_unit)}
                  <span className="block text-[12px] font-normal text-muted">/{(alt.unit ?? 'unit').toLowerCase()}</span>
                </p>
              </div>
            ))}
          </Card>
          <p className="mt-2 px-1 text-[12px] text-muted">Same active ingredient as {pill.generic_name ?? pill.drug_name}. Ask your pharmacist before switching.</p>
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
  const scrollRef = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<PillDetail | null>(null)
  const [pillError, setPillError] = useState<ApiError | null>(null)
  const [content, setContent] = useState<Content | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

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
        setPillError(err instanceof ApiError ? err : new ApiError('unknown', 'Could not load this pill.'))
        setLoading(false)
      })
    return () => ctrl.abort()
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
        setError(err instanceof ApiError ? err : new ApiError('unknown', 'Could not load this section.'))
        setLoading(false)
      })
    return () => ctrl.abort()
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
            aria-label="Back"
            className="pressable flex h-11 min-w-[44px] items-center gap-0.5 rounded-full px-2 text-[17px] font-medium text-brand"
          >
            <ChevronRightIcon size={22} className="rotate-180" />
            Back
          </button>
          <p className="min-w-0 flex-1 truncate text-center text-[17px] font-semibold text-ink">{pill?.drug_name ?? 'Pill'}</p>
          <button
            type="button"
            onClick={() => void openUrl(siteUrl)}
            aria-label="Open on pillseek.com"
            className="pressable flex h-11 w-11 items-center justify-center rounded-full text-brand"
          >
            <ExternalIcon size={20} />
          </button>
        </div>
        <div className="mx-auto max-w-lg px-2 pb-2">
          <ChipRow label="Section">
            {SECTION_KEYS.map((s) => (
              <Chip key={s} selected={s === section} onClick={() => switchTo(s)}>
                {SECTIONS[s].short}
              </Chip>
            ))}
            <Chip selected={false} onClick={() => void openUrl(pillSectionUrl(slug, 'interactions'))} label="Interactions (opens pillseek.com)">
              Interactions <ExternalIcon size={14} className="text-muted" />
            </Chip>
          </ChipRow>
        </div>
      </div>

      <main
        className="screen mx-auto max-w-lg space-y-4 px-4 pb-8 pt-2"
        style={{ paddingLeft: 'max(16px, var(--safe-left))', paddingRight: 'max(16px, var(--safe-right))' }}
      >
        <div className="px-1">
          <h1 className="text-[26px] font-bold leading-tight tracking-tight text-ink">{meta.label}</h1>
          {pill && <p className="mt-1 text-[15px] text-muted">{subtitle(pill)}</p>}
        </div>

        {loading && !pillError && <SectionSkeleton />}

        {pillError && (
          <ErrorCard error={pillError} onRetry={() => setReloadKey((k) => k + 1)} secondary={{ label: 'Open on pillseek.com', onClick: () => void openUrl(siteUrl) }} />
        )}

        {error && !loading && !notFound && (
          <ErrorCard error={error} onRetry={() => setReloadKey((k) => k + 1)} secondary={{ label: 'Open on pillseek.com', onClick: () => void openUrl(siteUrl) }} />
        )}

        {((error && notFound) || emptyContent) && !loading && <NothingHere label={meta.label} onOpenSite={() => void openUrl(siteUrl)} />}

        {content && !loading && !emptyContent && pill && (
          <>
            {content.kind === 'dosage' && <DosageBody data={content.data} />}
            {content.kind === 'adverse-reactions' && <SideEffectsBody data={content.data} />}
            {content.kind === 'medication-guide' && <MedGuideBody data={content.data} />}
            {content.kind === 'professional-information' && <ProfessionalBody data={content.data} />}
            {content.kind === 'price' && content.data && <PriceBody data={content.data} pill={pill} />}

            {labelMeta && (
              <button
                type="button"
                onClick={() => labelMeta.source_url && void openUrl(labelMeta.source_url)}
                disabled={!labelMeta.source_url}
                className="pressable flex w-full items-center justify-center gap-1.5 px-2 py-1 text-[13px] text-muted disabled:opacity-100"
              >
                Source: FDA label via DailyMed
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
