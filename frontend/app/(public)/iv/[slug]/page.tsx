import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import DrugPageHeader from '../../pill/[slug]/medication-guide/DrugPageHeader'
import MedguideMetaBar from '../../pill/[slug]/medication-guide/MedguideMetaBar'
import MedicationGuideTabs from '../../pill/[slug]/medication-guide/MedicationGuideTabs'
import { OctagonAlert } from '../../../components/IvIcons'
import ReviewedBy from '../../../components/ReviewedBy'
import { fetchIvDrug, isIvPageIndexable, ivHeaderProps, ivTabHrefs, type IvDrug } from '../../../lib/iv'
import { classText, prettyDate, recallsForDrugSafe, type Recall } from '../../../lib/recalls'
import { shortageForDrugSafe } from '../../../lib/shortages'
import { slugifyDrugName } from '../../../lib/slug'
import { breadcrumbSchema, guidePageSchema, safeJsonLd } from '../../../lib/structured-data'
import InfusionCalculator from './InfusionCalculator'
import IvAdministrationCard from './IvAdministrationCard'
import ShortageBanner from './ShortageBanner'

type PageParams = Promise<{ slug: string }>

const RECALLS_SHOWN = 3
const STRENGTHS_SHOWN = 8

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

/** Only what needs saying: a boxed warning, a controlled substance. No "all clear" chips. */
function SafetyNotices({ drug }: { drug: IvDrug }) {
  if (!drug.label_pages.has_boxed_warning && !drug.dea_schedule) return null
  return (
    <div className="flex flex-wrap gap-3">
      {drug.label_pages.has_boxed_warning && (
        <Link
          href={`/iv/${drug.slug}/professional-information#boxed-warning`}
          className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800 hover:bg-rose-100"
        >
          <OctagonAlert className="h-4 w-4" /> Boxed warning: read it in Professional Information
        </Link>
      )}
      {drug.dea_schedule && (
        <span className="inline-flex items-center rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
          Controlled substance · Schedule {drug.dea_schedule.replace(/^C/i, '')}
        </span>
      )}
    </div>
  )
}

function RecallsBox({ drugName, recalls }: { drugName: string; recalls: Recall[] }) {
  if (recalls.length === 0) return null
  return (
    <section id="recalls" className="rounded-xl border border-amber-200 bg-white p-5 shadow-sm" aria-labelledby="recalls-heading">
      <h2 id="recalls-heading" className="mb-2 border-l-4 border-amber-400 pl-3 text-base font-semibold text-slate-800">
        {recalls.length === 1 ? '1 recall' : `${recalls.length} recalls`}, last 12 months
      </h2>
      <ul className="space-y-2.5 text-sm text-slate-700">
        {recalls.slice(0, RECALLS_SHOWN).map((recall) => (
          <li key={recall.id}>
            <span className="font-semibold text-slate-900">{classText(recall.cls) || 'Recall'}</span> · {prettyDate(recall.date)}
            <span className="block text-slate-600">{recall.reason.length > 110 ? `${recall.reason.slice(0, 107)}…` : recall.reason}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-slate-500">
        Recalls are for specific lots of {drugName}.{' '}
        <Link href="/recalls" className="font-medium text-emerald-700 hover:underline">See lots and all alerts →</Link>
      </p>
    </section>
  )
}

function StrengthRows({ rows }: { rows: IvDrug['strengths'] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wider text-slate-500">
          <th className="w-1/3 py-2 pr-4 font-semibold">Strength</th>
          <th className="w-1/3 py-2 pr-4 font-semibold">Form</th>
          <th className="py-2 font-semibold">Manufacturers</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={`${s.strength}|${s.form}`} className="border-b border-slate-100 last:border-0">
            <td className="py-2 pr-4 font-medium text-slate-900">{s.strength}</td>
            <td className="py-2 pr-4 text-slate-700">{s.form}</td>
            <td className="py-2 text-slate-700">{s.makers}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function StrengthsTable({ drug }: { drug: IvDrug }) {
  if (drug.strengths.length === 0) return null
  // the strengths most makers sell come first on screen; the full list is one click away
  const common = [...drug.strengths].sort((a, b) => b.makers - a.makers).slice(0, STRENGTHS_SHOWN)
  const shown = drug.strengths.filter((s) => common.includes(s))
  return (
    <section className="rounded-xl border border-emerald-200 bg-white p-6 shadow-sm" aria-labelledby="strengths-heading">
      <h2 id="strengths-heading" className="mb-1 border-l-4 border-emerald-500 pl-3 text-base font-semibold text-slate-800">
        Strengths and forms
      </h2>
      <p className="mb-4 text-sm text-slate-600">
        {drug.product_count} products from {drug.maker_count} {drug.maker_count === 1 ? 'manufacturer' : 'manufacturers'}.
      </p>
      <div className="overflow-x-auto">
        <StrengthRows rows={shown} />
      </div>
      {drug.strengths.length > shown.length && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold text-emerald-700 hover:text-emerald-800">
            Show all {drug.strengths.length} strengths
          </summary>
          <div className="mt-3 overflow-x-auto">
            <StrengthRows rows={drug.strengths} />
          </div>
        </details>
      )}
    </section>
  )
}

export default async function IvDrugPage({ params }: { params: PageParams }) {
  const { slug } = await params
  const drug = await fetchIvDrug(slug)
  if (!drug) notFound()

  const [recalls, shortage] = await Promise.all([recallsForDrugSafe(drug.name, null), shortageForDrugSafe(drug.name)])
  const tabs = ivTabHrefs(drug)
  const labelLinks = [
    tabs.dosageHref && { href: tabs.dosageHref, label: 'Dosage', note: 'How much and how often' },
    tabs.adverseReactionsHref && { href: tabs.adverseReactionsHref, label: 'Side effects', note: 'Adverse reactions in the label' },
    tabs.medicationGuideHref && { href: tabs.medicationGuideHref, label: 'Medication guide', note: 'Written for patients' },
    { href: tabs.professionalHref, label: 'Professional information', note: 'The full prescribing label' },
    { href: '/interactions', label: 'Drug interactions', note: 'Check against other medicines' },
  ].filter(Boolean) as Array<{ href: string; label: string; note: string }>

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

        <DrugPageHeader pageLabel="IV Drug" {...ivHeaderProps(drug)} />
        <MedicationGuideTabs activeTab="iv" interactionsHref="/interactions" {...tabs} />
        {/* a reviewer's name goes on this page only once they approved its card */}
        {drug.card && <ReviewedBy lastVerifiedIso={drug.card.reviewed_at} />}
        <MedguideMetaBar guide={{ source_url: drug.label.source_url, fetched_at: drug.label.date }} />

        {shortage && <ShortageBanner shortage={shortage} />}
        <SafetyNotices drug={drug} />

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-6">
            {drug.card && <IvAdministrationCard drug={drug} card={drug.card} />}

            <StrengthsTable drug={drug} />

            <section className="rounded-xl border border-emerald-200 bg-white p-6 shadow-sm" aria-labelledby="more-heading">
              <h2 id="more-heading" className="mb-4 border-l-4 border-emerald-500 pl-3 text-base font-semibold text-slate-800">
                More about {drug.name}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {labelLinks.map((link) => (
                  <Link key={link.href} href={link.href} className="rounded-lg border border-slate-200 p-3 hover:border-emerald-300 hover:bg-emerald-50 transition-colors">
                    <span className="block text-sm font-semibold text-slate-800">{link.label}</span>
                    <span className="block text-xs text-slate-500">{link.note}</span>
                  </Link>
                ))}
              </div>
            </section>

            {drug.pill_drugs.length > 0 && (
              <section className="rounded-xl border border-emerald-200 bg-white p-6 shadow-sm" aria-labelledby="pills-heading">
                <h2 id="pills-heading" className="mb-1 border-l-4 border-emerald-500 pl-3 text-base font-semibold text-slate-800">
                  Also comes as a pill
                </h2>
                <p className="mb-3 text-sm text-slate-600">Tablets and capsules with the same active ingredient, with photos and imprints.</p>
                <div className="flex flex-wrap gap-2">
                  {drug.pill_drugs.map((pill) => (
                    <Link
                      key={pill.name}
                      href={`/drug/${slugifyDrugName(pill.name)}`}
                      className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-sm font-medium text-sky-700 hover:bg-sky-100 transition-colors"
                    >
                      {pill.name} <span className="text-sky-500">· {pill.pill_count} {pill.pill_count === 1 ? 'pill' : 'pills'}</span>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside className="space-y-6 lg:sticky lg:top-20">
            <InfusionCalculator />
            {recalls && <RecallsBox drugName={drug.name} recalls={recalls} />}
          </aside>
        </div>

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
