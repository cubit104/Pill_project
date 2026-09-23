import Card, { SectionLabel } from './Card'
import { ActivityIcon, DropletIcon, FlaskIcon, ShieldAlertIcon, SyringeIcon, TargetIcon, ThermometerIcon, type IvIcon } from './IvIcons'
import { isIntravenous, type IvDrug } from '../lib/api'
import { useT } from '../lib/i18n'

/** The six answers, in the order they are needed at the bedside. Same on every drug, same as the website. */
const FIELDS: Array<{ key: string; label: string; Icon: IvIcon; tint: string }> = [
  { key: 'iv_push', label: 'Push', Icon: SyringeIcon, tint: 'bg-emerald-50 text-emerald-700' },
  { key: 'infusion', label: 'Infusion', Icon: DropletIcon, tint: 'bg-sky-100 text-sky-700' },
  { key: 'mixing', label: 'Mixing', Icon: FlaskIcon, tint: 'bg-violet-50 text-violet-700' },
  { key: 'special_handling', label: 'Special handling', Icon: ShieldAlertIcon, tint: 'bg-rose-50 text-rose-700' },
  { key: 'storage', label: 'Storage', Icon: ThermometerIcon, tint: 'bg-amber-100 text-amber-700' },
  { key: 'monitoring', label: 'Watch', Icon: ActivityIcon, tint: 'bg-sky-100 text-sky-700' },
]

/** A drug that is not given IV has no push or infusion: the same two answers say where and how it is injected. */
const NON_IV: Record<string, { label: string; Icon: IvIcon }> = {
  iv_push: { label: 'Where to inject', Icon: TargetIcon },
  infusion: { label: 'How to give it', Icon: SyringeIcon },
}

/**
 * The "at a glance" card: up to six short answers a nurse reads in seconds, only what the label states, shown
 * only once a reviewer approved it (the API never sends a draft). A line that starts with "Do not" or "Never"
 * is drawn in red, as on the website.
 */
export default function IvGlanceCard({ drug }: { drug: IvDrug }) {
  const t = useT()
  const card = drug.card
  if (!card) return null
  const intravenous = isIntravenous(drug.routes)
  const fields = intravenous ? FIELDS : FIELDS.map((f) => ({ ...f, ...NON_IV[f.key] }))
  const shown = fields.filter((f) => ['stated', 'not_applicable'].includes(card.fields[f.key]?.status ?? ''))
  const silent = fields.filter((f) => (card.fields[f.key]?.status ?? 'not_stated') === 'not_stated')
  if (shown.length === 0) return null

  return (
    <section>
      <SectionLabel>{intravenous ? t('IV at a glance') : t('Injection at a glance')}</SectionLabel>
      <Card padded={false} className="overflow-hidden">
        {card.label_updated_since && (
          <p className="border-b border-line bg-[var(--warn-tint,transparent)] px-4 py-2.5 text-[13px] text-body">
            {t('The label was updated after this card was reviewed. Confirm each line against the full label until it is checked again.')}
          </p>
        )}
        <dl className="divide-y divide-line">
          {shown.map(({ key, label, Icon, tint }) => {
            const field = card.fields[key]
            if (!field) return null
            const forbids = /^(do not|never)\b/i.test(field.value)
            return (
              <div key={key} className={`grid grid-cols-[2.5rem_1fr] gap-3 px-4 py-3 ${forbids ? 'bg-rose-50' : ''}`}>
                <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${forbids ? 'bg-white text-rose-700' : tint}`}>
                  <Icon size={20} />
                </span>
                <div className="min-w-0">
                  <dt className="text-[11px] font-bold uppercase tracking-widest text-muted">{t(label)}</dt>
                  <dd className={`mt-0.5 text-[16px] leading-snug ${forbids ? 'font-semibold text-rose-700' : field.status === 'stated' ? 'font-semibold text-ink' : 'text-body'}`}>
                    {field.value}
                  </dd>
                </div>
              </div>
            )
          })}
        </dl>
        <p className="border-t border-line px-4 py-3 text-[12px] leading-relaxed text-muted">
          {silent.length > 0 && `${t('Nothing listed for: {items}.', { items: silent.map((f) => t(f.label).toLowerCase()).join(', ') })} `}
          {drug.label.presentation ? `${t('{presentation} product; other presentations may differ.', { presentation: drug.label.presentation.charAt(0).toUpperCase() + drug.label.presentation.slice(1) })} ` : ''}
          {t('Verify with your pharmacy and institution policy.')}
        </p>
      </Card>
    </section>
  )
}
