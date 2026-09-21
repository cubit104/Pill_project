import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import ReviewedBy from '../../../components/ReviewedBy'
import { fetchIvDrug, isIvPageIndexable } from '../../../lib/iv'
import { recallsForDrugSafe } from '../../../lib/recalls'
import { shortageForDrugSafe } from '../../../lib/shortages'
import { breadcrumbSchema, guidePageSchema, safeJsonLd } from '../../../lib/structured-data'
import IvDrugBody from './IvDrugBody'

type PageParams = Promise<{ slug: string }>

export async function generateMetadata({ params }: { params: PageParams }): Promise<Metadata> {
  const { slug } = await params
  const drug = await fetchIvDrug(slug)
  if (!drug) return { title: 'IV drug not found', robots: { index: false, follow: true } }
  return {
    // the API sends the editor's text or, when there is none, the automatic text the admin shows as the suggestion
    title: drug.meta_title || `${drug.name} IV`,
    description: drug.meta_description || undefined,
    alternates: { canonical: `/iv/${drug.slug}` },
    robots: {
      index: isIvPageIndexable({
        hasCard: Boolean(drug.card),
        hasProfessional: drug.label_pages.has_professional,
        hasDosage: drug.label_pages.has_dosage,
        hasAdverseReactions: drug.label_pages.has_adverse_reactions,
      }),
      follow: true,
    },
  }
}

export default async function IvDrugPage({ params }: { params: PageParams }) {
  const { slug } = await params
  const drug = await fetchIvDrug(slug)
  if (!drug) notFound()

  const [recalls, shortage] = await Promise.all([recallsForDrugSafe(drug.name, null), shortageForDrugSafe(drug.name)])
  const jsonLd = guidePageSchema({
    drugName: drug.name,
    slug: drug.slug,
    pageType: 'professional-information',
    splSetId: drug.spl_set_id,
    genericName: drug.name,
    brandName: drug.brand_names[0],
    fetchedAt: drug.card?.reviewed_at ?? drug.updated_at,
    pagePathOverride: `/iv/${drug.slug}`,
  })
  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: 'IV drugs', url: '/iv' },
    { name: drug.name, url: `/iv/${drug.slug}` },
  ])

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />

      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <nav aria-label="Breadcrumb">
          <ol className="flex items-center gap-1 text-sm text-slate-500 flex-wrap">
            <li><Link href="/" className="hover:text-sky-700 transition-colors">Home</Link></li>
            <li aria-hidden="true" className="select-none">›</li>
            <li><Link href="/iv" className="hover:text-sky-700 transition-colors">IV drugs</Link></li>
            <li aria-hidden="true" className="select-none">›</li>
            <li className="text-slate-700 font-medium">{drug.name}</li>
          </ol>
        </nav>

        <IvDrugBody
          drug={drug}
          recalls={recalls}
          shortage={shortage}
          // shown only once a reviewer approved the card (the body decides), so their name never sits on a page without one
          reviewedBy={<ReviewedBy lastVerifiedIso={drug.card?.reviewed_at} />}
        />

        <section className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-amber-800 mb-2">⚠️ Disclaimer</h2>
          <p className="text-xs text-amber-700 leading-8">
            This information is for educational purposes only and is not medical advice. It does not replace the full prescribing label, your
            pharmacy, or your institution&apos;s policies and infusion pump library.{' '}
            <Link href="/medical-disclaimer" className="underline hover:text-amber-900">Read full medical disclaimer</Link>.
          </p>
        </section>
      </div>
    </>
  )
}
