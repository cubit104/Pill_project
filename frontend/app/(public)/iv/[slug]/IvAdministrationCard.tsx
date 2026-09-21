import { Activity, Droplet, FlaskConical, ShieldAlert, Syringe, Thermometer, type IvIcon } from '../../../components/IvIcons'
import { isIntravenous, type IvCard, type IvDrug } from '../../../lib/iv'

/** The six answers, in the order they are needed at the bedside. Same on every drug. */
const FIELDS: Array<{ key: string; label: string; icon: IvIcon; tint: string }> = [
  { key: 'iv_push', label: 'Push', icon: Syringe, tint: 'bg-emerald-50 text-emerald-700' },
  { key: 'infusion', label: 'Infusion', icon: Droplet, tint: 'bg-sky-100 text-sky-700' },
  { key: 'mixing', label: 'Mixing', icon: FlaskConical, tint: 'bg-violet-50 text-violet-700' },
  { key: 'special_handling', label: 'Special handling', icon: ShieldAlert, tint: 'bg-rose-50 text-rose-700' },
  { key: 'storage', label: 'Storage', icon: Thermometer, tint: 'bg-amber-100 text-amber-700' },
  { key: 'monitoring', label: 'Watch', icon: Activity, tint: 'bg-sky-100 text-sky-700' },
]

/**
 * IV glance card: up to six short answers a nurse or doctor reads in seconds; the label tabs are for everything
 * else. Only what the label states is shown, and the card appears only after a reviewer approved it (the API
 * never sends a draft). The label quotes behind each answer stay in the admin, where they are checked.
 */
export default function IvAdministrationCard({ drug, card }: { drug: IvDrug; card: IvCard }) {
  // "not applicable" is an answer too ("Mixing: ready to use"); only "not stated" is left off the card
  const shown = FIELDS.filter((f) => ['stated', 'not_applicable'].includes(card.fields[f.key]?.status ?? ''))
  const silent = FIELDS.filter((f) => (card.fields[f.key]?.status ?? 'not_stated') === 'not_stated')
  if (shown.length === 0) return null

  return (
    <section className="rounded-xl border border-emerald-200 bg-white p-6 shadow-sm" aria-labelledby="iv-card-heading">
      <h2 id="iv-card-heading" className="mb-4 border-l-4 border-emerald-500 pl-3 text-base font-semibold text-slate-800">
        {isIntravenous(drug) ? 'IV at a glance' : 'Injection at a glance'}
      </h2>

      {card.label_updated_since && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          The drug&apos;s label was updated after this card was reviewed. Confirm each line in Professional Information until it is checked again.
        </p>
      )}

      <dl className="grid gap-3 sm:grid-cols-2">
        {shown.map(({ key, label, icon: Icon, tint }, index) => {
          const field = card.fields[key]
          const forbids = /^(do not|never)\b/i.test(field.value)
          // an odd tile at the end takes the full row instead of leaving a hole
          const wide = index === shown.length - 1 && shown.length % 2 === 1
          return (
            <div
              key={key}
              className={`grid grid-cols-[2.75rem_1fr] gap-3 rounded-xl border p-3.5 ${wide ? 'sm:col-span-2' : ''} ${forbids ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-white'}`}
            >
              <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${forbids ? 'bg-white text-rose-700' : tint}`}>
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <dt className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{label}</dt>
                <dd className={`mt-0.5 text-base leading-snug ${forbids ? 'font-semibold text-rose-700' : field.status === 'stated' ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>
                  {field.value}
                </dd>
              </div>
            </div>
          )
        })}
      </dl>

      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        {silent.length > 0 && <>Nothing listed for: {silent.map((f) => f.label.toLowerCase()).join(', ')}. </>}
        {drug.label.presentation ? `${drug.label.presentation.charAt(0).toUpperCase()}${drug.label.presentation.slice(1)} product; other presentations may differ. ` : ''}
        Verify with your pharmacy and institution policy.
      </p>
    </section>
  )
}
