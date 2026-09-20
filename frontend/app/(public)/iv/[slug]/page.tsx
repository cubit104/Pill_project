import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import DrugPageHeader from '../../pill/[slug]/medication-guide/DrugPageHeader'
import MedicationGuideTabs from '../../pill/[slug]/medication-guide/MedicationGuideTabs'
import RecallCard from '../../../components/RecallCard'
import ReviewedBy from '../../../components/ReviewedBy'
import { fetchIvDrug, ivHeaderProps, ivTabHrefs, type IvDrug } from '../../../lib/iv'
import { recallsForDrugSafe } from '../../../lib/recalls'
import { slugifyDrugName } from '../../../lib/slug'
import { breadcrumbSchema, guidePageSchema, safeJsonLd } from '../../../lib/structured-data'
import IvAdministrationCard from './IvAdministrationCard'

type PageParams = Promise<{ slug: string }>

const RECALLS_SHOWN = 3
const STRENGTHS_SHOWN = 8

function describe(drug: IvDrug): string {
  const brands = drug.brand_names.length ? ` (${drug.brand_names.slice(0, 3).join(', ')})` : ''
  return (
    drug.meta_description ||
    `${drug.name}${brands} injection: how it is given, strengths from ${drug.maker_count} manufacturers, and the full FDA label with dosage, warnings and side effects.`
  )
}

export async function generateMetadata({ params }: { params: PageParams }): Promise<Metadata> {
  const { slug } = await params
  const drug = await fetchIvDrug(slug)
  if (!drug) return { title: 'IV drug not found', robots: { index: false, follow: true } }
  return {
    title: drug.meta_title || `${drug.name} IV: Administration, Strengths and FDA Label`,
    description: describe(drug),
    alternates: { canonical: `/iv/${drug.slug}` },
  }
}

function SafetyStrip({ drug, recallCount }: { drug: IvDrug; recallCount: number | undefined }) {
  const base = 'rounded-lg border px-3 py-2 text-sm'
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {drug.label_pages.has_boxed_warning ? (
        <Link href={`/iv/${drug.slug}/professional-information#boxed-warning`} className={`${base} border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100`}>
          <b className="block">Boxed warning</b>Read it in the FDA label
        </Link>
      ) : (
        <div className={`${base} border-emerald-200 bg-emerald-50 text-emerald-800`}>
          <b className="block">No boxed warning</b>In the current FDA label
        </div>
      )}
      {drug.dea_schedule ? (
        <div className={`${base} border-amber-200 bg-amber-50 text-amber-800`}>
          <b className="block">Controlled substance</b>DEA schedule {drug.dea_schedule.replace(/^C/i, '')}
        </div>
      ) : (
        <div className={`${base} border-slate-200 bg-white text-slate-600`}>
          <b className="block text-slate-800">Prescription only</b>Not a controlled substance
        </div>
      )}
      {recallCount === undefined ? (
        <Link href="/recalls" className={`${base} border-slate-200 bg-white text-slate-600 hover:bg-slate-50`}>
          <b className="block text-slate-800">FDA recalls</b>Check the FDA alerts page
        </Link>
      ) : recallCount > 0 ? (
        <a href="#recalls" className={`${base} border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100`}>
          <b className="block">{recallCount === 1 ? '1 FDA recall' : `${recallCount} FDA recalls`}</b>In the last 12 months
        </a>
      ) : (
        <div className={`${base} border-emerald-200 bg-emerald-50 text-emerald-800`}>
          <b className="block">No FDA recalls</b>In the last 12 months
        </div>
      )}
    </div>
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
        {drug.product_count} products from {drug.maker_count} {drug.maker_count === 1 ? 'manufacturer' : 'manufacturers'} in FDA&apos;s drug
        listing.
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

  const recalls = await recallsForDrugSafe(drug.name, null)
  const tabs = ivTabHrefs(drug)
  const labelLinks = [
    tabs.dosageHref && { href: tabs.dosageHref, label: 'Dosage', note: 'How much and how often' },
    tabs.adverseReactionsHref && { href: tabs.adverseReactionsHref, label: 'Side effects', note: 'Adverse reactions in the label' },
    tabs.medicationGuideHref && { href: tabs.medicationGuideHref, label: 'Medication guide', note: 'FDA guide for patients' },
    { href: tabs.professionalHref, label: 'Professional information', note: 'The full FDA prescribing label' },
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

        <SafetyStrip drug={drug} recallCount={recalls?.length} />

        {drug.card && <IvAdministrationCard drug={drug} card={drug.card} />}

        <StrengthsTable drug={drug} />

        <section className="rounded-xl border border-emerald-200 bg-white p-6 shadow-sm" aria-labelledby="label-heading">
          <h2 id="label-heading" className="mb-4 border-l-4 border-emerald-500 pl-3 text-base font-semibold text-slate-800">
            From the FDA label
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {labelLinks.map((link) => (
              <Link key={link.href} href={link.href} className="rounded-lg border border-slate-100 p-3 hover:border-emerald-300 hover:bg-emerald-50 transition-colors">
                <span className="block text-sm font-medium text-slate-800">{link.label}</span>
                <span className="block text-xs text-slate-500">{link.note}</span>
              </Link>
            ))}
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Label used: {drug.label.brand || drug.name}
            {drug.label.maker ? `, ${drug.label.maker}` : ''}
            {drug.label.version ? ` · version ${drug.label.version}` : ''}
            {drug.label.date ? ` · ${drug.label.date}` : ''} ·{' '}
            <a href={drug.label.source_url} target="_blank" rel="noopener noreferrer" className="text-sky-700 hover:underline">
              DailyMed ↗
            </a>
          </p>
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

        {recalls && recalls.length > 0 && (
          <section id="recalls" className="rounded-xl border border-amber-200 bg-white p-6 shadow-sm" aria-labelledby="recalls-heading">
            <h2 id="recalls-heading" className="mb-1 border-l-4 border-amber-400 pl-3 text-base font-semibold text-slate-800">
              Recalls and safety alerts
            </h2>
            <p className="mb-4 text-sm text-slate-600">
              {recalls.length === 1 ? '1 FDA recall' : `${recalls.length} FDA recalls`} for {drug.name} in the last 12 months. Recalls are for
              specific lots: compare lot numbers with your stock. <Link href="/recalls" className="font-medium text-emerald-700 hover:underline">All FDA alerts</Link>
            </p>
            <div className="space-y-3">
              {recalls.slice(0, RECALLS_SHOWN).map((recall) => (
                <RecallCard key={recall.id} recall={recall} />
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-400">Source: FDA enforcement reports (openFDA), updated daily.</p>
          </section>
        )}

        <section className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-amber-800 mb-2">⚠️ Disclaimer</h2>
          <p className="text-xs text-amber-700 leading-8">
            This information is for educational purposes only and is not medical advice. It does not replace the full FDA label, your
            pharmacy, or your institution&apos;s policies and infusion pump library.{' '}
            <Link href="/medical-disclaimer" className="underline hover:text-amber-900">Read full medical disclaimer</Link>.
          </p>
        </section>
      </div>
    </>
  )
}
