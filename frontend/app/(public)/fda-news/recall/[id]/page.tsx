import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FDA_RECALLS_PAGE, plainReason, recallDetail, recallTag, shortProduct } from '../../../../lib/fda-news'
import { classText, prettyDate } from '../../../../lib/recalls'
import { DetailHeader, ExternalLink, Facts, Section, SourceNote, WhatToDo } from '../../NewsDetail'

type Params = Promise<{ id: string }>

/** `undefined` from the feed means the FDA did not answer: throw, so the error page shows and nothing is cached. */
async function load(id: string) {
  const data = await recallDetail(decodeURIComponent(id))
  if (data === undefined) throw new Error('The FDA recall feed did not answer')
  if (data === null) notFound()
  return data
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { recall } = await load((await params).id)
  return {
    title: recall.headline,
    description: `${recallTag(recall.cls)}. FDA recall ${recall.id} reported ${prettyDate(recall.date)}: ${recall.reason}`.slice(0, 300),
    // FDA wording shown as is: useful to people, not something to rank
    robots: { index: false, follow: true },
    alternates: { canonical: `/fda-news/recall/${recall.id}` },
  }
}

export default async function RecallNewsPage({ params }: { params: Params }) {
  const { recall, others } = await load((await params).id)
  const plain = plainReason(recall.reason)
  const open = /ongoing/i.test(recall.status)
  const drug = recall.generic

  return (
    <>
      <DetailHeader kind="recall" headline={recall.headline} date={recall.date} tag={recallTag(recall.cls)} />
      <div className="mx-auto max-w-4xl px-4 pt-8">
        <Facts
          rows={[
            ['Recalled product', recall.product],
            ['Company', [recall.firm, recall.place].filter(Boolean).join(' · ')],
            ['Recall class', classText(recall.cls)],
            ['Status', open ? 'Recall still open' : recall.status],
            ['Recall started', recall.initiated ? prettyDate(recall.initiated) : ''],
            ['FDA report date', prettyDate(recall.date)],
            ['Quantity', recall.quantity],
            ['Shipped to', recall.distribution],
            ['Recall number', recall.id],
            ['Started by', recall.voluntary],
          ]}
        />

        <Section title="Why it was recalled">
          <p>{recall.reason || 'The FDA did not give a reason.'}</p>
          {plain && <p className="mt-2 text-sm text-slate-600">In plain words: {plain}.</p>}
        </Section>

        {recall.lots && (
          <Section title="Lot numbers">
            <p className="text-sm text-slate-600">Compare these with the lot number printed on your package.</p>
            <p className="mt-2 whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-800">
              {recall.lots}
            </p>
          </Section>
        )}

        <WhatToDo>
          <ul className="list-disc space-y-1 pl-5">
            <li>Do not stop taking a medicine on your own. Stopping some medicines suddenly is riskier than the recall itself.</li>
            <li>Check whether the product, strength and lot number match the one you have.</li>
            <li>If they match, call your pharmacy or prescriber before taking more.</li>
          </ul>
        </WhatToDo>

        {others.length > 0 && (
          <Section title="Also in this recall">
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {others.slice(0, 20).map((o) => (
                <li key={o.id}>
                  <Link href={`/fda-news/recall/${encodeURIComponent(o.id)}`} className="block px-4 py-3 text-sm font-medium text-slate-800 hover:bg-slate-50 hover:text-emerald-700">
                    {shortProduct(o.product, o.firm)}
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {drug && (
          <p className="mt-8 text-sm">
            <Link href={`/recalls?drug=${encodeURIComponent(drug)}`} className="font-semibold text-emerald-700 hover:text-emerald-800">
              See every recall for {drug} in the last 12 months →
            </Link>
          </p>
        )}

        <SourceNote>
          Source: FDA enforcement report, recall {recall.id}, reported {prettyDate(recall.date)} (openFDA).{' '}
          <ExternalLink href={FDA_RECALLS_PAGE}>FDA recall database</ExternalLink>.
        </SourceNote>
      </div>
    </>
  )
}
