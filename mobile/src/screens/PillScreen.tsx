import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Card, { SectionLabel } from '../components/Card'
import Disclaimer from '../components/Disclaimer'
import ReviewedBy from '../components/ReviewedBy'
import ErrorCard from '../components/ErrorCard'
import { ChevronRightIcon, ExternalIcon, InfoIcon, PillIcon } from '../components/Icons'
import { PillThumb, TextBadge, titleCase } from '../components/PillRow'
import { Skeleton } from '../components/Skeleton'
import { useToast } from '../components/Toast'
import {
  ApiError,
  getPill,
  getPriceSnapshot,
  getSimilar,
  pillPageUrl,
  type PillDetail,
  type PriceSnapshot,
  type SimilarPill,
} from '../lib/api'
import { useBackHandler } from '../lib/backstack'
import { money } from '../lib/format'
import { sectionPath } from '../lib/goals'
import { interactionsPath } from '../lib/interactions'
import { hapticTick, openUrl } from '../lib/native'

/** DEA schedule → short badge text, or null when not controlled / unknown. */
function scheduleBadge(raw: string | null): string | null {
  if (!raw) return null
  const v = raw.trim().toLowerCase()
  const map: Record<string, string> = {
    ci: 'I', cii: 'II', ciii: 'III', civ: 'IV', cv: 'V',
    i: 'I', ii: 'II', iii: 'III', iv: 'IV', v: 'V',
    '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V',
    'schedule i': 'I', 'schedule ii': 'II', 'schedule iii': 'III', 'schedule iv': 'IV', 'schedule v': 'V',
  }
  return map[v] ? `Schedule ${map[v]}` : null
}

function Row({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  if (!value) return null
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <span className="flex-none text-[14px] text-muted">{label}</span>
      <span className={`selectable min-w-0 text-right text-[16px] font-medium text-ink ${mono ? 'tabular font-mono' : ''}`}>{value}</span>
    </div>
  )
}

function LinkRow({ label, hint, onClick, external }: { label: string; hint?: string; onClick: () => void; external?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pressable flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-brand-tint"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-medium text-ink">{label}</span>
        {hint && <span className="block text-[13px] text-muted">{hint}</span>}
      </span>
      {external ? <ExternalIcon size={18} className="flex-none text-muted" /> : <ChevronRightIcon size={20} className="flex-none text-muted" />}
    </button>
  )
}

/** Image carousel: swipe between catalog photos; dots underneath. */
function Gallery({ images, alt }: { images: string[]; alt: string }) {
  const [index, setIndex] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const onScroll = () => {
    const el = ref.current
    if (!el) return
    setIndex(Math.round(el.scrollLeft / el.clientWidth))
  }
  if (images.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center rounded-card bg-surface text-muted">
        <PillIcon size={48} />
      </div>
    )
  }
  return (
    <div>
      <div ref={ref} onScroll={onScroll} className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto rounded-card bg-white">
        {images.map((src, i) => (
          <div key={src} className="flex h-64 w-full flex-none snap-center items-center justify-center p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={i === 0 ? alt : `${alt}, photo ${i + 1}`} className="max-h-full max-w-full object-contain" loading={i === 0 ? 'eager' : 'lazy'} />
          </div>
        ))}
      </div>
      {images.length > 1 && (
        <div className="mt-2 flex justify-center gap-1.5" aria-hidden>
          {images.map((_, i) => (
            <span key={i} className={`h-1.5 rounded-full transition-all duration-fast ${i === index ? 'w-4 bg-brand' : 'w-1.5 bg-line'}`} />
          ))}
        </div>
      )}
    </div>
  )
}

function PillSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-64 w-full rounded-card" />
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-40 w-full rounded-card" />
      <Skeleton className="h-28 w-full rounded-card" />
    </div>
  )
}

/**
 * Native-feeling pill page, pushed over the tabs. Loads the pill record, then
 * (in parallel, best effort) the weekly price snapshot and similar pills.
 */
export default function PillScreen({ slug }: { slug: string }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [pill, setPill] = useState<PillDetail | null>(null)
  const [price, setPrice] = useState<PriceSnapshot | null>(null)
  const [similar, setSimilar] = useState<SimilarPill[]>([])
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(true)
  const [showInactive, setShowInactive] = useState(false)
  const [showAllIndication, setShowAllIndication] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate('/home', { replace: true }))
  useBackHandler(true, goBack)

  useEffect(() => {
    if (!slug) return
    const ctrl = new AbortController()
    setLoading(true)
    setError(null)
    setPill(null)
    setPrice(null)
    setSimilar([])
    setShowInactive(false)
    setShowAllIndication(false)
    scrollRef.current?.scrollTo({ top: 0 })
    getPill(slug, ctrl.signal)
      .then((p) => {
        if (ctrl.signal.aborted) return
        setPill(p)
        setLoading(false)
        void getPriceSnapshot(slug, ctrl.signal).then((s) => !ctrl.signal.aborted && setPrice(s)).catch(() => {})
        void getSimilar(slug, ctrl.signal).then((s) => !ctrl.signal.aborted && setSimilar(s)).catch(() => {})
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return
        setError(err instanceof ApiError ? err : new ApiError('unknown', 'Could not load this pill.'))
        setLoading(false)
      })
    return () => ctrl.abort()
  }, [slug, reloadKey])

  const playAudio = (url: string) => {
    void hapticTick()
    const a = new Audio(url)
    a.play().catch(() => toast.show("Couldn't play the pronunciation", 'error'))
  }

  const schedule = pill ? scheduleBadge(pill.dea_schedule) : null
  const brandLine = pill
    ? pill.brand_or_generic === 'brand' && pill.generic_name
      ? `Brand of ${pill.generic_name}`
      : pill.brand_or_generic === 'generic' && pill.brand_names_all.length
        ? `Generic for ${pill.brand_names_all.slice(0, 3).join(', ')}`
        : null
    : null
  const physical = pill ? [pill.color, pill.shape].filter(Boolean).map((s) => titleCase(String(s))).join(' · ') : ''

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-canvas animate-fade-up">
      {/* Compact header with back */}
      <div
        className="sticky top-0 z-20 flex items-center gap-2 bg-[color-mix(in_srgb,var(--canvas)_95%,transparent)] px-2 pb-2 backdrop-blur"
        style={{ paddingTop: 'calc(var(--safe-top) + 6px)', paddingLeft: 'max(8px, var(--safe-left))', paddingRight: 'max(8px, var(--safe-right))' }}
      >
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
        <span className="w-11" aria-hidden />
      </div>

      <main
        className="screen mx-auto max-w-lg space-y-4 px-4 pb-8 pt-2"
        style={{ paddingLeft: 'max(16px, var(--safe-left))', paddingRight: 'max(16px, var(--safe-right))' }}
      >
        {loading && <PillSkeleton />}
        {error && !loading && (
          <ErrorCard
            error={error}
            onRetry={() => setReloadKey((k) => k + 1)}
            secondary={{ label: 'Open on pillseek.com', onClick: () => void openUrl(pillPageUrl(slug)) }}
          />
        )}
        {pill && !loading && (
          <>
            <Gallery images={pill.images} alt={`${pill.drug_name} pill`} />

            {/* Title block */}
            <div className="px-1">
              <div className="flex flex-wrap items-center gap-2">
                {pill.status_rx_otc && <TextBadge tone={pill.status_rx_otc.toLowerCase().includes('otc') ? 'neutral' : 'brand'}>{pill.status_rx_otc}</TextBadge>}
                {schedule && <TextBadge tone="amber">{schedule}</TextBadge>}
                {pill.brand_or_generic && <TextBadge tone="neutral">{titleCase(pill.brand_or_generic)}</TextBadge>}
              </div>
              <h1 className="mt-2 text-[26px] font-bold leading-tight tracking-tight text-ink">
                {pill.drug_name}
                {pill.strength && <span className="font-medium text-muted"> {pill.strength}</span>}
              </h1>
              {brandLine && <p className="mt-1 text-[15px] text-body">{brandLine}</p>}
              {pill.pronunciation && (
                <button
                  type="button"
                  onClick={() => pill.audio_url && playAudio(pill.audio_url)}
                  disabled={!pill.audio_url}
                  className="pressable mt-1 inline-flex min-h-[36px] items-center gap-1.5 text-[14px] text-muted disabled:opacity-100"
                >
                  <span aria-hidden>🔊</span>
                  <span className="italic">{pill.pronunciation}</span>
                </button>
              )}
            </div>

            <ReviewedBy lastVerified={pill.updated_at} />

            {/* Identification */}
            <section>
              <SectionLabel>Identification</SectionLabel>
              <Card className="divide-y divide-line py-1">
                <Row label="Imprint" value={pill.imprint} mono />
                <Row label="Colour · shape" value={physical || null} />
                <Row label="Size" value={pill.size ? `${pill.size} mm` : null} />
                <Row label="Form" value={pill.dosage_form ? titleCase(pill.dosage_form) : null} />
                <Row label="Route" value={pill.route} />
                <Row label="Manufacturer" value={pill.manufacturer} />
                <Row label="NDC" value={pill.ndc} mono />
              </Card>
            </section>

            {/* Price */}
            {price && (
              <section>
                <SectionLabel>Price</SectionLabel>
                <Card tone="tint">
                  <div className="flex items-baseline justify-between gap-3">
                    <div>
                      <p className="text-[13px] text-muted">Fair retail, 30-day supply</p>
                      <p className="tabular mt-0.5 text-[24px] font-bold tracking-tight text-ink">
                        {price.fair_retail_low !== null && price.fair_retail_high !== null
                          ? `${money(price.fair_retail_low)} – ${money(price.fair_retail_high)}`
                          : money(price.total_acquisition_cost)}
                      </p>
                    </div>
                    {price.price_per_unit !== null && (
                      <div className="text-right">
                        <p className="text-[13px] text-muted">Pharmacy cost</p>
                        <p className="tabular text-[16px] font-semibold text-ink">
                          {money(price.price_per_unit)}
                          <span className="text-[13px] font-normal text-muted">/{(price.unit ?? 'unit').toLowerCase()}</span>
                        </p>
                      </div>
                    )}
                  </div>
                  <p className="mt-2 text-[12px] leading-snug text-muted">
                    {price.is_estimate ? 'Estimate. ' : ''}
                    {price.display_disclaimer ?? 'Based on NADAC pharmacy acquisition cost (CMS). Your price depends on pharmacy and insurance.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => navigate(sectionPath(slug, 'price'))}
                    className="pressable mt-2 inline-flex min-h-[40px] items-center gap-1 text-[14px] font-semibold text-brand"
                  >
                    Compare prices &amp; alternatives <ChevronRightIcon size={16} />
                  </button>
                </Card>
              </section>
            )}

            {/* What it's for */}
            {(pill.indication?.plain_text || pill.pharma_class) && (
              <section>
                <SectionLabel>What it&apos;s for</SectionLabel>
                <Card>
                  {pill.indication?.plain_text && (
                    <>
                      <p className={`text-[15px] leading-relaxed text-body ${showAllIndication ? '' : 'line-clamp-6'}`}>{pill.indication.plain_text}</p>
                      {pill.indication.plain_text.length > 320 && (
                        <button
                          type="button"
                          onClick={() => setShowAllIndication((v) => !v)}
                          aria-expanded={showAllIndication}
                          className="pressable mt-1 inline-flex min-h-[40px] items-center gap-1 text-[14px] font-semibold text-brand"
                        >
                          {showAllIndication ? 'Show less' : 'Read more'}
                          <ChevronRightIcon size={16} className={`transition-transform ${showAllIndication ? '-rotate-90' : 'rotate-90'}`} />
                        </button>
                      )}
                    </>
                  )}
                  {pill.pharma_class && (
                    <p className={`text-[13px] text-muted ${pill.indication?.plain_text ? 'mt-3' : ''}`}>
                      <span className="font-semibold text-body">Drug class:</span> {pill.pharma_class}
                    </p>
                  )}
                </Card>
              </section>
            )}

            {/* Ingredients */}
            {(pill.ingredients || pill.inactive_ingredients) && (
              <section>
                <SectionLabel>Ingredients</SectionLabel>
                <Card>
                  {pill.ingredients && (
                    <>
                      <p className="text-[13px] font-semibold text-body">Active</p>
                      <p className="mt-0.5 text-[15px] text-ink">{pill.ingredients}</p>
                    </>
                  )}
                  {pill.inactive_ingredients && (
                    <div className={pill.ingredients ? 'mt-3' : ''}>
                      <button
                        type="button"
                        onClick={() => setShowInactive((v) => !v)}
                        aria-expanded={showInactive}
                        className="pressable inline-flex min-h-[40px] items-center gap-1 text-[14px] font-semibold text-brand"
                      >
                        {showInactive ? 'Hide' : 'Show'} inactive ingredients
                        <ChevronRightIcon size={16} className={`transition-transform ${showInactive ? 'rotate-90' : ''}`} />
                      </button>
                      {showInactive && (
                        <p className="mt-1 whitespace-pre-line text-[14px] leading-relaxed text-body">{pill.inactive_ingredients}</p>
                      )}
                    </div>
                  )}
                </Card>
              </section>
            )}

            {/* Label sections, rendered natively by SectionScreen */}
            <section>
              <SectionLabel>Patient guide</SectionLabel>
              <Card padded={false} className="divide-y divide-line overflow-hidden">
                {pill.has_medguide && <LinkRow label="Medication guide" hint="What to know before and while taking it" onClick={() => navigate(sectionPath(slug, 'medication-guide'))} />}
                {pill.has_dosage && <LinkRow label="Dosage & administration" hint="How it's taken, forms and strengths" onClick={() => navigate(sectionPath(slug, 'dosage'))} />}
                {pill.has_adverse_reactions && <LinkRow label="Side effects" hint="Adverse reactions from the FDA label" onClick={() => navigate(sectionPath(slug, 'adverse-reactions'))} />}
                <LinkRow label="Prescribing information" hint="Full FDA label for professionals" onClick={() => navigate(sectionPath(slug, 'professional-information'))} />
                <LinkRow label="Drug interactions" hint="Check against other medicines" onClick={() => navigate(interactionsPath(pill.generic_name ?? pill.drug_name))} />
              </Card>
            </section>

            {/* Similar pills */}
            {similar.length > 0 && (
              <section>
                <SectionLabel>Similar-looking pills</SectionLabel>
                <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
                  {similar.map((s) => (
                    <button
                      key={s.slug}
                      type="button"
                      onClick={() => {
                        void hapticTick()
                        navigate(`/pill/${encodeURIComponent(s.slug)}`)
                      }}
                      className="pressable card w-40 flex-none p-3 text-left active:bg-brand-tint"
                    >
                      <PillThumb src={s.image_url} alt="" size={56} />
                      <p className="mt-2 truncate text-[15px] font-semibold text-ink">{s.drug_name}</p>
                      <p className="truncate text-[13px] text-muted">{[s.strength, s.imprint].filter(Boolean).join(' · ')}</p>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <Card tone="warn" className="flex items-start gap-3">
              <InfoIcon size={20} className="mt-0.5 flex-none text-[var(--warn)]" />
              <p className="text-[13px] leading-relaxed text-body">
                Pill images and details come from FDA labeling. Always confirm a pill with your pharmacist before taking it.
              </p>
            </Card>
            <Disclaimer compact />
          </>
        )}
      </main>
    </div>
  )
}
