import { useState } from 'react'
import Card from './Card'
import { ExternalIcon } from './Icons'
import { TriangleAlertIcon } from './IvIcons'
import { useT } from '../lib/i18n'
import { hapticTick, openUrl } from '../lib/native'
import { FDA_SHORTAGE_PAGE, type Shortage } from '../lib/shortages'

const LISTED = 4

function monthYear(iso: string): string {
  return iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' }) : ''
}

/**
 * Shown only while the drug is on the FDA shortage list. The FDA keeps a drug listed even when supply is back,
 * so the card says how much is actually limited: amber when something is, quiet otherwise.
 */
export default function ShortageCard({ shortage }: { shortage: Shortage }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const tight = shortage.constrained > 0
  const allAvailable = shortage.available === shortage.items.length
  const affected = shortage.items.filter((i) => i.availability === 'unavailable' || i.availability === 'limited')
  const since = monthYear(shortage.since)
  const n = shortage.items.length
  return (
    <Card tone={tight ? 'warn' : 'surface'} className="flex items-start gap-3">
      <span className={`flex h-10 w-10 flex-none items-center justify-center rounded-xl ${tight ? 'bg-amber-100 text-amber-700' : 'bg-brand-tint text-muted'}`}>
        <TriangleAlertIcon size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-[15px] font-semibold ${tight ? 'text-amber-800' : 'text-ink'}`}>
          {tight ? t('Currently in shortage') : allAvailable ? t('On the shortage list, supply available') : t('On the shortage list')}
        </p>
        <p className="mt-0.5 text-[14px] text-body">
          {since && `${t('Since {when}', { when: since })}: `}
          {tight
            ? t('{k} of {n} listed presentations limited or unavailable.', { k: shortage.constrained, n })
            : allAvailable
              ? t('all {n} listed presentations are reported available.', { n })
              : t('{k} of {n} listed presentations are reported available; check the rest.', { k: shortage.available, n })}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-4">
          {tight && (
            <button
              type="button"
              onClick={() => {
                void hapticTick()
                setOpen((v) => !v)
              }}
              className="pressable min-h-[36px] text-[14px] font-semibold text-brand"
              aria-expanded={open}
            >
              {open ? t('Hide the list') : t('Which ones')}
            </button>
          )}
          <button type="button" onClick={() => void openUrl(FDA_SHORTAGE_PAGE)} className="pressable inline-flex min-h-[36px] items-center gap-1 text-[14px] font-semibold text-brand">
            {t('Details on FDA.gov')} <ExternalIcon size={14} />
          </button>
        </div>
        {tight && open && (
          <ul className="mt-1 space-y-1 text-[14px] text-body">
            {affected.slice(0, LISTED).map((item, i) => (
              <li key={i}>
                <span className={item.availability === 'unavailable' ? 'font-semibold text-rose-700' : 'font-semibold text-amber-700'}>
                  {item.availability === 'unavailable' ? t('Unavailable') : t('Limited')}
                </span>
                {' · '}
                {item.presentation}
                {item.company ? ` · ${item.company}` : ''}
              </li>
            ))}
            {affected.length > LISTED && <li className="text-muted">{t('and {n} more', { n: affected.length - LISTED })}</li>}
          </ul>
        )}
      </div>
    </Card>
  )
}
