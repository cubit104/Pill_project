import type { IvCard, IvDrug } from '../../../lib/iv'

/** The six answers, in the order they are needed at the bedside. Same on every drug. */
const FIELDS: Array<[key: string, label: string]> = [
  ['iv_push', 'Push'],
  ['infusion', 'Infusion'],
  ['mixing', 'Mixing'],
  ['special_handling', 'Special handling'],
  ['storage', 'Storage'],
  ['monitoring', 'Watch'],
]

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
}

/**
 * IV glance card: six short answers a nurse or doctor reads in seconds; the full label is for everything else.
 * Only what the FDA label states is shown (each line keeps its quote one tap away), and the card appears only
 * after a reviewer approved it (the API never sends a draft).
 */
export default function IvAdministrationCard({ drug, card }: { drug: IvDrug; card: IvCard }) {
  // "not applicable" is an answer too ("Mixing: ready to use"), backed by a quote like any other; only
  // "not stated" is left off the card and summed up in the grey line below
  const shown = FIELDS.filter(([key]) => ['stated', 'not_applicable'].includes(card.fields[key]?.status ?? ''))
  const silent = FIELDS.filter(([key]) => (card.fields[key]?.status ?? 'not_stated') === 'not_stated')
  if (shown.length === 0) return null
  const reviewed = formatDate(card.reviewed_at)

  return (
    <section className="rounded-xl border border-emerald-200 bg-white p-6 shadow-sm" aria-labelledby="iv-card-heading">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="iv-card-heading" className="border-l-4 border-emerald-500 pl-3 text-base font-semibold text-slate-800">
          IV at a glance
        </h2>
        <span className="text-xs text-slate-500">From the FDA label{reviewed ? ` · pharmacist reviewed ${reviewed}` : ''}</span>
      </div>

      {card.label_updated_since && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          The FDA label was updated after this card was reviewed. Confirm each line in the full label until it is checked again.
        </p>
      )}

      <dl className="divide-y divide-slate-100">
        {shown.map(([key, label]) => {
          const field = card.fields[key]
          const warns = /^do not|^never/i.test(field.value)
          const tone = warns ? 'font-semibold text-rose-700' : field.status === 'stated' ? 'font-medium text-slate-900' : 'text-slate-600'
          return (
            <div key={key} className="grid gap-x-4 py-2.5 sm:grid-cols-[9rem_1fr]">
              <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500 sm:pt-0.5">{label}</dt>
              <dd className={`text-[15px] leading-snug ${tone}`}>
                {field.value}
                {field.quotes.length > 0 && (
                  <details className="mt-1 text-sm font-normal">
                    <summary className="cursor-pointer text-xs text-sky-700 hover:text-sky-900">source</summary>
                    {field.quotes.map((quote, i) => (
                      <blockquote key={i} className="mt-1.5 rounded-r-lg border-l-4 border-emerald-500 bg-emerald-50 px-3 py-2 text-slate-700">
                        {quote.text}
                        <span className="mt-1 block text-xs text-slate-500">FDA label · {quote.section}</span>
                      </blockquote>
                    ))}
                  </details>
                )}
              </dd>
            </div>
          )
        })}
      </dl>

      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        {silent.length > 0 && <>Not stated in this label: {silent.map(([, label]) => label.toLowerCase()).join(', ')}. </>}
        Based on the {drug.label.brand || drug.name} {drug.label.presentation || 'product'} label; other presentations may differ. Verify with
        your pharmacy and institution policy.{' '}
        <a href={`/iv/${drug.slug}/professional-information`} className="text-sky-700 hover:underline">Full FDA label →</a>
      </p>
    </section>
  )
}
