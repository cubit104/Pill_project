import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cleanAdverseReactionsHtml } from '../../../pill/[slug]/adverse-reactions/cleanAdverseReactionsHtml'
import { SHARED_CONTENT_CARD_CLASSES, SHARED_READING_PROSE_CLASSES } from '../../../pill/[slug]/medication-guide/layoutStyles'
import { sanitizeRenderedHtml } from '../../../pill/[slug]/medication-guide/sanitizeRenderedHtml'
import { fetchIvDrug, fetchIvLabelSections, isIntravenous } from '../../../../lib/iv'
import IvLabelPageShell from '../IvLabelPageShell'

type PageParams = Promise<{ slug: string }>

export async function generateMetadata({ params }: { params: PageParams }): Promise<Metadata> {
  const { slug } = await params
  const drug = await fetchIvDrug(slug)
  if (!drug) return { title: 'IV drug not found', robots: { index: false, follow: true } }
  return {
    // "IV" and "infusion" only for a drug that is given intravenously
    title: `${drug.name} ${isIntravenous(drug) ? 'IV' : 'Injection'} Side Effects and Adverse Reactions`,
    description: `Side effects of ${drug.name} injection reported in the FDA label, including ${isIntravenous(drug) ? 'infusion' : 'injection site'} reactions, common adverse reactions and serious warnings.`,
    alternates: { canonical: `/iv/${drug.slug}/side-effects` },
    // a reprint of the label, so it stays out of the index like the pill label pages; the drug's own page is indexed
    robots: { index: false, follow: true },
  }
}

export default async function IvSideEffectsPage({ params }: { params: PageParams }) {
  const { slug } = await params
  const drug = await fetchIvDrug(slug)
  if (!drug || !drug.label_pages.has_adverse_reactions) notFound()

  const sections = await fetchIvLabelSections(slug)
  const html = sections?.adverse_reactions ? sanitizeRenderedHtml(cleanAdverseReactionsHtml(sections.adverse_reactions)) : null
  if (!html) notFound()

  return (
    <IvLabelPageShell drug={drug} page="adverse-reactions" guide={sections}>
      <div className={`${SHARED_CONTENT_CARD_CLASSES} lg:max-w-[60rem] lg:mx-auto`}>
        <h2 className="text-xl font-semibold text-slate-900 mb-5">Adverse Reactions</h2>
        <div className="[&_h3]:border-l-4 [&_h3]:border-emerald-500 [&_h3]:pl-3 [&_h3]:text-emerald-900">
          <article id="adverse-reactions-content" className={SHARED_READING_PROSE_CLASSES} dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    </IvLabelPageShell>
  )
}
