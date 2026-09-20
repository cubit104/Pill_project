import Link from 'next/link'
import type { ReactNode } from 'react'
import DrugPageHeader from '../../pill/[slug]/medication-guide/DrugPageHeader'
import MedguideMetaBar from '../../pill/[slug]/medication-guide/MedguideMetaBar'
import MedicationGuideTabs from '../../pill/[slug]/medication-guide/MedicationGuideTabs'
import ReviewedBy from '../../../components/ReviewedBy'
import { ivHeaderProps, ivTabHrefs, type IvDrug } from '../../../lib/iv'
import { breadcrumbSchema, guidePageSchema, safeJsonLd } from '../../../lib/structured-data'

type LabelPage = 'dosage' | 'adverse-reactions' | 'professional-information' | 'medication-guide'

const PAGES: Record<LabelPage, { tab: 'dosage' | 'adverse' | 'pro' | 'consumer'; path: string; crumb: string; label: string }> = {
  dosage: { tab: 'dosage', path: 'dosage', crumb: 'Dosage', label: 'Dosage & Administration' },
  'adverse-reactions': { tab: 'adverse', path: 'side-effects', crumb: 'Side Effects', label: 'Side Effects & Adverse Reactions' },
  'professional-information': { tab: 'pro', path: 'professional-information', crumb: 'Professional Information', label: 'Full FDA Prescribing Details' },
  'medication-guide': { tab: 'consumer', path: 'medication-guide', crumb: 'Medication Guide', label: 'FDA Medication Guide' },
}

/**
 * Frame shared by the label pages of one IV drug (dosage, side effects, professional information):
 * the same header, tabs, reviewer line, source bar, sources box and disclaimer the pill label pages have.
 */
export default function IvLabelPageShell({
  drug,
  page,
  guide,
  beforeContent,
  children,
}: {
  drug: IvDrug
  page: LabelPage
  guide: { source_url?: string | null; fetched_at?: string | null } | null
  beforeContent?: ReactNode
  children: ReactNode
}) {
  const info = PAGES[page]
  const path = `/iv/${drug.slug}/${info.path}`
  const jsonLd = guidePageSchema({
    drugName: drug.name,
    slug: drug.slug,
    pageType: page,
    splSetId: drug.spl_set_id,
    genericName: drug.name,
    brandName: drug.brand_names[0],
    fetchedAt: guide?.fetched_at,
    pagePathOverride: path,
  })
  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: 'IV drugs', url: '/iv' },
    { name: drug.name, url: `/iv/${drug.slug}` },
    { name: info.crumb, url: path },
  ])

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />
      {beforeContent}

      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <nav aria-label="Breadcrumb">
          <ol className="flex items-center gap-1 text-sm text-slate-500 flex-wrap">
            <li><Link href="/" className="hover:text-sky-700 transition-colors">Home</Link></li>
            <li aria-hidden="true" className="select-none">›</li>
            <li><Link href="/iv" className="hover:text-sky-700 transition-colors">IV drugs</Link></li>
            <li aria-hidden="true" className="select-none">›</li>
            <li><Link href={`/iv/${drug.slug}`} className="hover:text-sky-700 transition-colors">{drug.name}</Link></li>
            <li aria-hidden="true" className="select-none">›</li>
            <li className="text-slate-700 font-medium">{info.crumb}</li>
          </ol>
        </nav>

        <DrugPageHeader pageLabel={info.label} {...ivHeaderProps(drug)} />
        <MedicationGuideTabs activeTab={info.tab} interactionsHref="/interactions" {...ivTabHrefs(drug)} />
        <ReviewedBy lastVerifiedIso={guide?.fetched_at ?? null} />
        <MedguideMetaBar guide={guide} />

        {children}

        <section className="border border-slate-200 rounded-xl p-4 text-xs text-slate-500 space-y-1">
          <h2 className="font-semibold text-slate-600 mb-2">Sources</h2>
          <p>
            <span className="font-medium">FDA label:</span> {drug.label.brand || drug.name}
            {drug.label.maker ? `, ${drug.label.maker}` : ''}
            {drug.label.version ? ` (version ${drug.label.version}${drug.label.date ? `, ${drug.label.date}` : ''})` : ''}
          </p>
          <p><span className="font-medium">SPL Set ID:</span> {drug.spl_set_id}</p>
          <p>
            <span className="font-medium">Source:</span>{' '}
            <a href={guide?.source_url || drug.label.source_url} target="_blank" rel="noopener noreferrer" className="text-sky-700 hover:underline">
              DailyMed ↗
            </a>
          </p>
        </section>

        <section className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-amber-800 mb-2">⚠️ Disclaimer</h2>
          <p className="text-xs text-amber-700 leading-8">
            This information is for educational purposes only and is not medical advice. Always consult your doctor,
            pharmacist, or other licensed healthcare professional before starting, stopping, or changing any medicine.{' '}
            <Link href="/medical-disclaimer" className="underline hover:text-amber-900">Read full medical disclaimer</Link>.
          </p>
        </section>
      </div>
    </>
  )
}
