import Link from 'next/link'
import type { Metadata } from 'next'
import { fetchIvList, type IvListItem } from '../../lib/iv'
import { breadcrumbSchema, safeJsonLd } from '../../lib/structured-data'

export const revalidate = 3600

export const metadata: Metadata = {
  title: 'IV Drugs A to Z: Administration, Strengths and FDA Labels',
  description:
    'Intravenous drugs A to Z. For each drug: how it is given, every strength and manufacturer, recalls, and the full FDA label with dosage, warnings and side effects.',
  alternates: { canonical: '/iv' },
}

function groupByLetter(drugs: IvListItem[]): Array<[string, IvListItem[]]> {
  const groups = new Map<string, IvListItem[]>()
  for (const drug of drugs) {
    const first = drug.name.charAt(0).toUpperCase()
    const letter = /[A-Z]/.test(first) ? first : '0-9'
    groups.set(letter, [...(groups.get(letter) ?? []), drug])
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}

export default async function IvHubPage() {
  const drugs = await fetchIvList()
  const groups = groupByLetter(drugs)
  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: 'IV drugs', url: '/iv' },
  ])

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbs) }} />
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <nav aria-label="Breadcrumb">
          <ol className="flex items-center gap-1 text-sm text-slate-500">
            <li><Link href="/" className="hover:text-sky-700 transition-colors">Home</Link></li>
            <li aria-hidden="true" className="select-none">›</li>
            <li className="text-slate-700 font-medium">IV drugs</li>
          </ol>
        </nav>

        <header className="space-y-2">
          <p className="text-xs font-semibold text-emerald-700 uppercase tracking-widest">Intravenous medicines</p>
          <h1 className="text-4xl font-extrabold text-slate-900 leading-tight">IV drugs A to Z</h1>
          <p className="max-w-3xl text-slate-600">
            {drugs.length} intravenous and other injection drugs. Each page shows how the drug is given, every strength and manufacturer, FDA recalls, and the
            full FDA label. Looking for tablets and capsules too?{' '}
            <Link href="/drugs" className="font-medium text-emerald-700 hover:underline">See all drugs A to Z</Link>.
          </p>
        </header>

        {groups.length > 0 && (
          <nav aria-label="Jump to letter" className="no-print flex flex-wrap gap-1.5">
            {groups.map(([letter]) => (
              <a key={letter} href={`#letter-${letter}`} className="min-w-9 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-center text-sm font-semibold text-slate-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800">
                {letter}
              </a>
            ))}
          </nav>
        )}

        {groups.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-6 text-slate-600">IV drug pages are being prepared. Please check back soon.</p>}

        {groups.map(([letter, items]) => (
          <section key={letter} id={`letter-${letter}`} className="scroll-mt-24 rounded-xl border border-emerald-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 border-l-4 border-emerald-500 pl-3 text-base font-semibold text-slate-800">{letter}</h2>
            <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((drug) => (
                <li key={drug.slug} className="text-sm">
                  <Link href={`/iv/${drug.slug}`} className="font-medium text-sky-700 hover:underline">{drug.name}</Link>
                  {drug.brand_names.length > 0 && <span className="text-slate-500"> · {drug.brand_names.slice(0, 2).join(', ')}</span>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  )
}
