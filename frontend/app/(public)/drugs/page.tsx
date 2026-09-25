import Link from 'next/link'
import type { Metadata } from 'next'
import { fetchDrugIndex } from '../../lib/iv'
import { breadcrumbSchema, safeJsonLd } from '../../lib/structured-data'
import DrugNameSearch from '../../components/DrugNameSearch'
import DrugIndexNav from './DrugIndexNav'

export const revalidate = 3600

export const metadata: Metadata = {
  title: 'Drugs A to Z: Pills and IV Medicines',
  description:
    'Browse every drug on PillSeek from A to Z, brand and generic names together. Find pills by photo and imprint, and IV drugs with administration facts and the full FDA label.',
  alternates: { canonical: '/drugs' },
}

export default async function DrugsIndexPage() {
  const index = await fetchDrugIndex('a')
  const letters = index?.letters ?? {}
  const total = Object.values(letters).reduce((sum, n) => sum + n, 0)
  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: 'Drugs A to Z', url: '/drugs' },
  ])

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbs) }} />
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <nav aria-label="Breadcrumb">
          <ol className="flex items-center gap-1 text-sm text-slate-500">
            <li><Link href="/" className="hover:text-sky-700 transition-colors">Home</Link></li>
            <li aria-hidden="true" className="select-none">›</li>
            <li className="text-slate-700 font-medium">Drugs A to Z</li>
          </ol>
        </nav>

        <header className="space-y-2">
          <p className="text-xs font-semibold text-emerald-700 uppercase tracking-widest">All medicines</p>
          <h1 className="text-4xl font-extrabold text-slate-900 leading-tight">Drugs A to Z</h1>
          <p className="max-w-3xl text-slate-600">
            {total > 0 ? `${total.toLocaleString('en-US')} drug names` : 'Every drug name'}, brand and generic together. Pick a letter. Each
            name shows whether we have pills with photos and imprints, an IV drug page, or both.
          </p>
        </header>

        <DrugNameSearch label="Search all drugs" placeholder="Type a drug name, e.g. metformin" />
        <DrugIndexNav letters={letters} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Link href="/search" className="rounded-xl border border-emerald-200 bg-white p-5 shadow-sm hover:bg-emerald-50 transition-colors">
            <span className="block font-semibold text-slate-900">Identify a pill</span>
            <span className="text-sm text-slate-600">Search by imprint, color and shape.</span>
          </Link>
          <Link href="/iv" className="rounded-xl border border-emerald-200 bg-white p-5 shadow-sm hover:bg-emerald-50 transition-colors">
            <span className="block font-semibold text-slate-900">IV drugs A to Z</span>
            <span className="text-sm text-slate-600">How each one is given, strengths, and the FDA label.</span>
          </Link>
        </div>
      </div>
    </>
  )
}
