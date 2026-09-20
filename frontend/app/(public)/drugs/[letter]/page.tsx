import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { fetchDrugIndex, INDEX_LETTERS, type DrugIndexEntry } from '../../../lib/iv'
import { slugifyDrugName } from '../../../lib/slug'
import { breadcrumbSchema, safeJsonLd } from '../../../lib/structured-data'
import DrugIndexNav from '../DrugIndexNav'

export const revalidate = 3600

type PageParams = Promise<{ letter: string }>

export function generateStaticParams() {
  return INDEX_LETTERS.map((letter) => ({ letter }))
}

function letterLabel(letter: string): string {
  return letter === '0-9' ? '0 to 9' : letter.toUpperCase()
}

export async function generateMetadata({ params }: { params: PageParams }): Promise<Metadata> {
  const { letter } = await params
  if (!INDEX_LETTERS.includes(letter)) return { title: 'Drugs A to Z', robots: { index: false, follow: true } }
  return {
    title: `Drugs Starting With ${letterLabel(letter)}: Pills and IV Medicines`,
    description: `Every drug name starting with ${letterLabel(letter)} on PillSeek, brand and generic: pills with photos and imprints, and IV drugs with the full FDA label.`,
    alternates: { canonical: `/drugs/${letter}` },
  }
}

/** Pill names arrive as typed on the label: "VALTREX", "vardenafil". One style reads better in a list. */
function displayName(name: string): string {
  if (name !== name.toUpperCase() && name !== name.toLowerCase()) return name
  return name.toLowerCase().replace(/(^|[\s(/-])([a-z])/g, (_, before: string, letter: string) => before + letter.toUpperCase())
}

function Entry({ entry }: { entry: DrugIndexEntry }) {
  // a name that only exists as an IV drug opens its IV page; anything with pills opens the drug page
  const href = entry.pill_count > 0 ? `/drug/${slugifyDrugName(entry.name)}` : `/iv/${entry.iv_slug}`
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <Link href={href} className="font-medium text-sky-700 hover:underline">{displayName(entry.name)}</Link>
      {entry.pill_count > 0 && (
        <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
          {entry.pill_count} {entry.pill_count === 1 ? 'pill' : 'pills'}
        </span>
      )}
      {entry.iv_slug && (
        <Link
          href={`/iv/${entry.iv_slug}`}
          className="rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700 hover:bg-teal-100"
        >
          IV
        </Link>
      )}
    </li>
  )
}

export default async function DrugsLetterPage({ params }: { params: PageParams }) {
  const { letter } = await params
  if (!INDEX_LETTERS.includes(letter)) notFound()

  const index = await fetchDrugIndex(letter)
  if (!index) notFound()
  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: 'Drugs A to Z', url: '/drugs' },
    { name: letterLabel(letter), url: `/drugs/${letter}` },
  ])

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbs) }} />
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <nav aria-label="Breadcrumb">
          <ol className="flex items-center gap-1 text-sm text-slate-500">
            <li><Link href="/" className="hover:text-sky-700 transition-colors">Home</Link></li>
            <li aria-hidden="true" className="select-none">›</li>
            <li><Link href="/drugs" className="hover:text-sky-700 transition-colors">Drugs A to Z</Link></li>
            <li aria-hidden="true" className="select-none">›</li>
            <li className="text-slate-700 font-medium">{letterLabel(letter)}</li>
          </ol>
        </nav>

        <header className="space-y-2">
          <h1 className="text-4xl font-extrabold text-slate-900 leading-tight">Drugs starting with {letterLabel(letter)}</h1>
          <p className="text-slate-600">
            {index.entries.length.toLocaleString('en-US')} names, brand and generic together.{' '}
            <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">pills</span> = photos
            and imprints,{' '}
            <span className="rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700">IV</span> = IV drug
            page.
          </p>
        </header>

        <DrugIndexNav letters={index.letters} active={letter} />

        <section className="rounded-xl border border-emerald-200 bg-white p-6 shadow-sm">
          {index.entries.length === 0 ? (
            <p className="text-slate-600">No drugs under this letter yet.</p>
          ) : (
            <ul className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {index.entries.map((entry) => (
                <Entry key={entry.name} entry={entry} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  )
}
