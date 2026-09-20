import type { IvCard, IvCardField, IvDrug } from '../../../lib/iv'

/** The fixed set of questions, in the order nurses look for them. Same on every drug. */
const FIELDS: Array<[key: string, question: string]> = [
  ['iv_push', 'IV push?'],
  ['infusion_rate_time', 'Infusion time and rate'],
  ['reconstitution', 'Reconstitution'],
  ['dilution', 'Dilution'],
  ['filter', 'Filter'],
  ['light_protection', 'Protect from light'],
  ['line_and_site', 'Line and site'],
  ['storage_unopened', 'Storage (unopened)'],
  ['stability_after_mixing', 'Stability after mixing'],
  ['incompatibilities', 'Do not mix with'],
  ['monitoring', 'Watch during the infusion'],
]

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
}

function Fact({ question, field }: { question: string; field: IvCardField | undefined }) {
  const stated = field?.status === 'stated' || field?.status === 'not_applicable'
  return (
    <div className="rounded-lg border border-slate-100 p-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{question}</h3>
      {stated && field ? (
        <>
          <p className={`mt-0.5 text-[15px] leading-snug ${field.status === 'stated' ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>
            {field.value}
          </p>
          {field.quotes.length > 0 && (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-sky-700 hover:text-sky-900">Source in the FDA label</summary>
              {field.quotes.map((quote, i) => (
                <blockquote key={i} className="mt-2 rounded-r-lg border-l-4 border-emerald-500 bg-emerald-50 px-3 py-2 text-slate-700">
                  {quote.text}
                  <span className="mt-1 block text-xs text-slate-500">{quote.section}</span>
                </blockquote>
              ))}
            </details>
          )}
        </>
      ) : (
        <p className="mt-0.5 text-[15px] italic text-slate-400">Not stated in the FDA label</p>
      )}
    </div>
  )
}

/**
 * IV administration card. Every fact is quoted word for word from the FDA label and the card is shown
 * only after a reviewer approved it (the API never sends a draft).
 */
export default function IvAdministrationCard({ drug, card }: { drug: IvDrug; card: IvCard }) {
  const reviewed = formatDate(card.reviewed_at)
  return (
    <section className="rounded-xl border border-emerald-200 bg-white p-6 shadow-sm" aria-labelledby="iv-card-heading">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <h2 id="iv-card-heading" className="border-l-4 border-emerald-500 pl-3 text-base font-semibold text-slate-800">
          IV administration card
        </h2>
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-800">
          Every fact quoted from the FDA label{reviewed ? ` · reviewed ${reviewed}` : ''}
        </span>
      </div>

      {card.label_updated_since && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          The FDA label was updated after this card was reviewed. The card is being checked against the new label; until
          then, confirm each fact in the full label below.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map(([key, question]) => (
          <Fact key={key} question={question} field={card.fields[key]} />
        ))}
      </div>

      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        Covers the {drug.label.presentation || 'product'} described in the {drug.label.brand || drug.name} label
        {drug.label.maker ? ` (${drug.label.maker})` : ''}. Other presentations, such as premixed bags, may differ.
        Compatibility shown is only what this label states; it is not a full Y-site reference. Always verify with your
        pharmacy and your institution&apos;s policy.
      </p>
    </section>
  )
}
