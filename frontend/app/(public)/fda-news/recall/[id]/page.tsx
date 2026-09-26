import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { recallNotice, type FdaPage } from '../../../../lib/fda-announcements'
import { fdaNewsSwitches } from '../../../../lib/fda-news-switches'
import { FDA_RECALLS_PAGE, NOTICE_TAG, plainReason, recallDetail, recallTag, shortProduct, type RecallDetail } from '../../../../lib/fda-news'
import { pillSeekLinks, type PillSeekLink } from '../../../../lib/pillseek-links'
import { classText, prettyDate } from '../../../../lib/recalls'
import { DetailHeader, ExternalLink, Facts, NewsJsonLd, PillSeekLinks, Section, SourceNote, WhatToDo } from '../../NewsDetail'

type Params = Promise<{ id: string }>

/** FDA recall numbers ("D-0850-2026") come from the weekly enforcement reports; anything else is the slug of a notice on fda.gov. */
const RECALL_NUMBER = /^[A-Z]-\d{3,5}-\d{4}$/i

/** `undefined` from a feed means the FDA did not answer: throw, so the error page shows and nothing is cached. */
async function load(id: string) {
  if (!(await fdaNewsSwitches()).recall) notFound() // switched off in Admin → Settings
  const key = decodeURIComponent(id)
  if (RECALL_NUMBER.test(key)) {
    const data = await recallDetail(key)
    if (data === undefined) throw new Error('The FDA recall feed did not answer')
    if (data === null) notFound()
    return { kind: 'report' as const, ...data }
  }
  const notice = await recallNotice(key.toLowerCase())
  if (notice === undefined) throw new Error('fda.gov did not answer')
  if (notice === null) notFound()
  return { kind: 'notice' as const, slug: key.toLowerCase(), ...notice }
}

type Loaded = Awaited<ReturnType<typeof load>>

/** The page in a few words (search result, news markup), its address and its FDA source. */
function summaryOf(data: Loaded): { headline: string; description: string; date: string; path: string; source: string } {
  if (data.kind === 'notice') {
    return {
      headline: data.page.title,
      description: `Drug recall announced ${prettyDate(data.page.announced || data.page.date)}: ${data.page.reason}`,
      date: data.page.announced || data.page.date,
      path: `/fda-news/recall/${data.slug}`,
      source: data.url,
    }
  }
  const { recall } = data
  return {
    headline: recall.headline,
    description: `${recallTag(recall.cls)}. FDA recall ${recall.id} reported ${prettyDate(recall.date)}: ${recall.reason}`,
    date: recall.date,
    path: `/fda-news/recall/${recall.id}`,
    source: FDA_RECALLS_PAGE,
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const summary = summaryOf(await load((await params).id))
  return {
    title: summary.headline,
    description: summary.description.slice(0, 300),
    robots: { index: true, follow: true },
    alternates: { canonical: summary.path },
  }
}

export default async function RecallNewsPage({ params }: { params: Params }) {
  const data = await load((await params).id)
  const summary = summaryOf(data)
  // the recalled medicine's own pages on PillSeek, by the names the FDA gives it
  const links = await pillSeekLinks(data.kind === 'notice' ? [data.page.brand, data.page.product] : [data.recall.generic, data.recall.product])
  return (
    <>
      <NewsJsonLd headline={summary.headline} path={summary.path} date={summary.date} description={summary.description} source={summary.source} />
      {data.kind === 'notice' ? <NoticeView page={data.page} url={data.url} links={links} /> : <ReportView recall={data.recall} others={data.others} links={links} />}
    </>
  )
}

function RecallWhatToDo() {
  return (
    <WhatToDo>
      <ul className="list-disc space-y-1 pl-5">
        <li>Do not stop taking a medicine on your own. Stopping some medicines suddenly is riskier than the recall itself.</li>
        <li>Check whether the product, strength and lot number match the one you have.</li>
        <li>If they match, call your pharmacy or prescriber before taking more.</li>
      </ul>
    </WhatToDo>
  )
}

/** A recall the company announced and the FDA posted; the FDA's own classification follows weeks later. */
function NoticeView({ page, url, links }: { page: FdaPage; url: string; links: PillSeekLink[] }) {
  const plain = plainReason(page.reason)
  return (
    <>
      <DetailHeader kind="recall" headline={page.title} date={page.announced || page.date} tag={NOTICE_TAG} />
      <div className="mx-auto max-w-4xl px-4 pt-8">
        <Facts
          rows={[
            ['Recalled product', page.product],
            ['Company', page.company],
            ['Brand name', page.brand],
            ['Product type', page.productType],
            ['Company announcement', page.announced ? prettyDate(page.announced) : ''],
            ['Posted by the FDA', page.published ? prettyDate(page.published) : ''],
          ]}
        />

        <Section title="Why it was recalled">
          <p>{page.reason || 'See the FDA notice for the reason.'}</p>
          {plain && <p className="mt-2 text-sm text-slate-600">In plain words: {plain}.</p>}
        </Section>

        <Section title="Lot numbers">
          <p>
            The notice on the FDA website lists the lot numbers, expiry dates and who to contact.{' '}
            <ExternalLink href={url}>Read the full FDA notice</ExternalLink>
          </p>
        </Section>

        <PillSeekLinks links={links} />
        <RecallWhatToDo />

        <SourceNote>
          Source: company recall announcement posted by the FDA{page.published ? ` on ${prettyDate(page.published)}` : ''}. The FDA classifies the
          recall (Class I, II or III) in a later weekly enforcement report.
        </SourceNote>
      </div>
    </>
  )
}

function ReportView({ recall, others, links }: { recall: RecallDetail; others: RecallDetail[]; links: PillSeekLink[] }) {
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

        <PillSeekLinks links={links} />
        <RecallWhatToDo />

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
