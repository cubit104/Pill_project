import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cleanDosageHtml } from '../../../pill/[slug]/dosage/cleanDosageHtml'
import { SHARED_CONTENT_CARD_CLASSES, SHARED_READING_PROSE_CLASSES } from '../../../pill/[slug]/medication-guide/layoutStyles'
import { sanitizeRenderedHtml } from '../../../pill/[slug]/medication-guide/sanitizeRenderedHtml'
import { fetchIvDrug, fetchIvLabelSections } from '../../../../lib/iv'
import IvLabelPageShell from '../IvLabelPageShell'

type PageParams = Promise<{ slug: string }>

export async function generateMetadata({ params }: { params: PageParams }): Promise<Metadata> {
  const { slug } = await params
  const drug = await fetchIvDrug(slug)
  if (!drug) return { title: 'IV drug not found', robots: { index: false, follow: true } }
  return {
    title: `${drug.name} IV Dosage and Administration`,
    description: `Recommended dosage and administration of ${drug.name} injection from the FDA label: dosing, preparation, infusion instructions, and dosage forms and strengths.`,
    alternates: { canonical: `/iv/${drug.slug}/dosage` },
    // a reprint of the label, so it stays out of the index like the pill label pages; the drug's own page is indexed
    robots: { index: false, follow: true },
  }
}

export default async function IvDosagePage({ params }: { params: PageParams }) {
  const { slug } = await params
  const drug = await fetchIvDrug(slug)
  if (!drug || !drug.label_pages.has_dosage) notFound()

  const sections = await fetchIvLabelSections(slug)
  const dosageHtml = sections?.dosage_administration ? sanitizeRenderedHtml(cleanDosageHtml(sections.dosage_administration)) : null
  if (!dosageHtml) notFound()
  const formsHtml =
    sections?.dosage_forms_and_strengths && sections.dosage_forms_and_strengths !== sections.dosage_administration
      ? sanitizeRenderedHtml(sections.dosage_forms_and_strengths)
      : null

  return (
    <IvLabelPageShell drug={drug} page="dosage" guide={sections}>
      <div className={`${SHARED_CONTENT_CARD_CLASSES} lg:max-w-[60rem] lg:mx-auto`}>
        <h2 className="text-xl font-semibold text-slate-900 mb-5">Recommended Dosage &amp; Administration</h2>
        {/* Scoped emerald left-border accent on subsection h3 headings */}
        <div className="[&_h3]:border-l-4 [&_h3]:border-emerald-500 [&_h3]:pl-3 [&_h3]:text-emerald-900">
          <article id="dosage-content" className={SHARED_READING_PROSE_CLASSES} dangerouslySetInnerHTML={{ __html: dosageHtml }} />
        </div>
        {formsHtml && (
          <div className="mt-6 pt-5 border-t border-slate-100 mx-4 sm:mx-8">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4">
              <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-3">📋 Dosage Forms &amp; Strengths</p>
              <div className={SHARED_READING_PROSE_CLASSES} dangerouslySetInnerHTML={{ __html: formsHtml }} />
            </div>
          </div>
        )}
      </div>
    </IvLabelPageShell>
  )
}
