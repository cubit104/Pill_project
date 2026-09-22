import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import MedguideToc from '../../../pill/[slug]/medication-guide/MedguideToc'
import { MIN_PROFESSIONAL_TOC_SECTIONS } from '../../../pill/[slug]/medication-guide/professionalTocConfig'
import { sanitizeRenderedHtml } from '../../../pill/[slug]/medication-guide/sanitizeRenderedHtml'
import {
  SHARED_CONTENT_ASIDE_CLASSES,
  SHARED_CONTENT_CARD_CLASSES,
  SHARED_CONTENT_GRID_CLASSES,
  SHARED_READING_PROSE_CLASSES,
} from '../../../pill/[slug]/medication-guide/layoutStyles'
import { fetchIvDrug, fetchIvGuide, isIntravenous } from '../../../../lib/iv'
import IvLabelPageShell from '../IvLabelPageShell'

type PageParams = Promise<{ slug: string }>

type ConsumerGuide = {
  has_medguide?: boolean
  medguide_html?: string | null
  source_url?: string | null
  fetched_at?: string | null
}

export async function generateMetadata({ params }: { params: PageParams }): Promise<Metadata> {
  const { slug } = await params
  const drug = await fetchIvDrug(slug)
  if (!drug) return { title: 'IV drug not found', robots: { index: false, follow: true } }
  const kind = isIntravenous(drug) ? 'IV' : 'Injection'
  return {
    title: `${drug.name} ${kind} Medication Guide`,
    description: `The FDA Medication Guide for ${drug.name} ${kind.toLowerCase()}: what it is for, what to tell your doctor, side effects and how to store it, in plain language.`,
    alternates: { canonical: `/iv/${drug.slug}/medication-guide` },
    // a reprint of the label, so it stays out of the index like the pill label pages; the drug's own page is indexed
    robots: { index: false, follow: true },
  }
}

/**
 * The patient Medication Guide of an IV or injection drug, from the same label cache the pill page reads.
 * Few injection labels carry one; the tab appears only when this drug's label does, and the page is not
 * found otherwise.
 */
export default async function IvMedicationGuidePage({ params }: { params: PageParams }) {
  const { slug } = await params
  const drug = await fetchIvDrug(slug)
  if (!drug || !drug.label_pages.has_medguide) notFound()

  const guide = await fetchIvGuide<ConsumerGuide>(drug.spl_set_id, { medguide: true })
  const medguideHtml = guide?.medguide_html?.trim() ? sanitizeRenderedHtml(guide.medguide_html) : null
  if (!medguideHtml) notFound()
  const hasToc = (medguideHtml.match(/<h[23]\b[^>]*id=/gi)?.length ?? 0) >= MIN_PROFESSIONAL_TOC_SECTIONS

  return (
    <IvLabelPageShell drug={drug} page="medication-guide" guide={guide}>
      {hasToc && (
        <details className="no-print lg:hidden bg-white border border-slate-200 rounded-xl shadow-sm p-4 [&[open]>summary]:mb-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-800 list-none [&::-webkit-details-marker]:hidden">
            On this page
          </summary>
          <MedguideToc html={medguideHtml} drugName={drug.name} />
        </details>
      )}

      <div className={hasToc ? SHARED_CONTENT_GRID_CLASSES : 'space-y-6'}>
        {hasToc && (
          <aside className={SHARED_CONTENT_ASIDE_CLASSES}>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <MedguideToc html={medguideHtml} drugName={drug.name} />
            </div>
          </aside>
        )}
        <div className={`${SHARED_CONTENT_CARD_CLASSES} ${hasToc ? '' : 'lg:max-w-[60rem] lg:mx-auto'}`}>
          <article id="medguide-content" className={SHARED_READING_PROSE_CLASSES} dangerouslySetInnerHTML={{ __html: medguideHtml }} />
        </div>
      </div>
    </IvLabelPageShell>
  )
}
