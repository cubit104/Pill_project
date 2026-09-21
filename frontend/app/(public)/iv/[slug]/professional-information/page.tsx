import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import MobileTocBar from '../../../pill/[slug]/medication-guide/MobileTocBar'
import ProfessionalToc from '../../../pill/[slug]/medication-guide/ProfessionalToc'
import { MIN_PROFESSIONAL_TOC_SECTIONS } from '../../../pill/[slug]/medication-guide/professionalTocConfig'
import { sanitizeRenderedHtml } from '../../../pill/[slug]/medication-guide/sanitizeRenderedHtml'
import {
  PRO_BOXED_WARNING_PROSE_CLASSES,
  PRO_HIGHLIGHTS_CONTAINER_CLASSES,
  PRO_HIGHLIGHTS_PROSE_CLASSES,
  SHARED_CONTENT_ASIDE_CLASSES,
  SHARED_CONTENT_CARD_CLASSES,
  SHARED_CONTENT_GRID_CLASSES,
  SHARED_READING_PROSE_CLASSES,
} from '../../../pill/[slug]/medication-guide/layoutStyles'
import { fetchIvDrug, fetchIvGuide } from '../../../../lib/iv'
import IvLabelPageShell from '../IvLabelPageShell'

type PageParams = Promise<{ slug: string }>

type ProfessionalGuide = {
  professional_html?: string | null
  professional_highlights_html?: string | null
  professional_sections?: Array<[string, string]> | null
  source_url?: string | null
  fetched_at?: string | null
}

const PRO_PROSE_CLASSES = [SHARED_READING_PROSE_CLASSES, PRO_BOXED_WARNING_PROSE_CLASSES].join(' ')

export async function generateMetadata({ params }: { params: PageParams }): Promise<Metadata> {
  const { slug } = await params
  const drug = await fetchIvDrug(slug)
  if (!drug) return { title: 'IV drug not found', robots: { index: false, follow: true } }
  return {
    title: `${drug.name} Injection Professional Prescribing Information`,
    description: `FDA prescribing information for ${drug.name} injection: indications, dosage and administration, warnings, adverse reactions, pharmacology and how supplied.`,
    alternates: { canonical: `/iv/${drug.slug}/professional-information` },
    // a reprint of the label, so it stays out of the index like the pill label pages; the drug's own page is indexed
    robots: { index: false, follow: true },
  }
}

export default async function IvProfessionalInformationPage({ params }: { params: PageParams }) {
  const { slug } = await params
  const drug = await fetchIvDrug(slug)
  if (!drug) notFound()

  const guide = await fetchIvGuide<ProfessionalGuide>(drug.spl_set_id, { professional: true })
  const tocSections = (guide?.professional_sections ?? [])
    .map(([sectionSlug, label]) => ({ slug: sectionSlug, label }))
    .filter((section) => section.slug && section.label)
  const hasToc = tocSections.length >= MIN_PROFESSIONAL_TOC_SECTIONS
  const highlightsHtml = guide?.professional_highlights_html ? sanitizeRenderedHtml(guide.professional_highlights_html) : null
  const professionalHtml = guide?.professional_html ? sanitizeRenderedHtml(guide.professional_html) : null

  return (
    <IvLabelPageShell
      drug={drug}
      page="professional-information"
      guide={guide}
      beforeContent={
        hasToc && (
          <MobileTocBar sentinelId="pro-toc-sentinel">
            <ProfessionalToc sections={tocSections} layout="mobile-grid" />
          </MobileTocBar>
        )
      }
    >
      {/* Sentinel: when this scrolls out of view, the mobile sticky TOC bar appears */}
      <div id="pro-toc-sentinel" />

      <div className={hasToc ? SHARED_CONTENT_GRID_CLASSES : 'space-y-6'}>
        {hasToc && (
          <aside className={SHARED_CONTENT_ASIDE_CLASSES}>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <ProfessionalToc sections={tocSections} />
            </div>
          </aside>
        )}
        <div className={`${SHARED_CONTENT_CARD_CLASSES} ${hasToc ? '' : 'lg:max-w-[60rem] lg:mx-auto'}`}>
          {highlightsHtml && (
            <div className={`${PRO_HIGHLIGHTS_CONTAINER_CLASSES} mb-6`}>
              <div className={PRO_HIGHLIGHTS_PROSE_CLASSES} dangerouslySetInnerHTML={{ __html: highlightsHtml }} />
            </div>
          )}
          {professionalHtml ? (
            <article id="pro-content" className={PRO_PROSE_CLASSES} dangerouslySetInnerHTML={{ __html: professionalHtml }} />
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
              <p className="text-sm text-slate-800 mb-3">Full prescribing information is not available for this medication in our cache.</p>
              <a href={drug.label.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sky-700 font-semibold hover:text-sky-900">
                View on DailyMed ↗
              </a>
            </div>
          )}
        </div>
      </div>
    </IvLabelPageShell>
  )
}
