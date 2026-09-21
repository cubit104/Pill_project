import { TriangleAlert } from '../../../components/IvIcons'
import { FDA_SHORTAGE_PAGE, type Shortage } from '../../../lib/shortages'

const LISTED = 4

function monthYear(iso: string): string {
  return iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : ''
}

/**
 * Shown only while the drug is on the shortage list. FDA keeps a drug listed even when supply is back, so the
 * banner says how much is actually limited: amber when something is, quiet otherwise. "Supply available" is said
 * only when every listed product is reported available; a status that could not be read is never counted as that.
 */
export default function ShortageBanner({ shortage }: { shortage: Shortage }) {
  const tight = shortage.constrained > 0
  const allAvailable = shortage.available === shortage.items.length
  const affected = shortage.items.filter((i) => i.availability === 'unavailable' || i.availability === 'limited')
  const since = monthYear(shortage.since)
  return (
    <section
      aria-label="Drug shortage"
      className={`flex flex-wrap items-start gap-3 rounded-xl border p-4 ${tight ? 'border-amber-200 bg-gradient-to-r from-amber-50 to-white' : 'border-slate-200 bg-white'}`}
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tight ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
        <TriangleAlert className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`font-semibold ${tight ? 'text-amber-800' : 'text-slate-800'}`}>{tight ? 'Currently in shortage' : allAvailable ? 'On the shortage list, supply available' : 'On the shortage list'}</p>
        <p className="mt-0.5 text-sm text-slate-700">
          {since && `Since ${since}: `}
          {tight
            ? `${shortage.constrained} of ${shortage.items.length} listed presentations limited or unavailable.`
            : allAvailable
              ? `all ${shortage.items.length} listed presentations are reported available.`
              : `${shortage.available} of ${shortage.items.length} listed presentations are reported available; check the rest.`}
        </p>
        {tight && (
          <details className="mt-1.5 text-sm">
            <summary className="cursor-pointer text-sky-700 hover:text-sky-900">Which ones</summary>
            <ul className="mt-1.5 space-y-1 text-slate-700">
              {affected.slice(0, LISTED).map((item, i) => (
                <li key={i}>
                  <span className={item.availability === 'unavailable' ? 'font-semibold text-rose-700' : 'font-semibold text-amber-700'}>
                    {item.availability === 'unavailable' ? 'Unavailable' : 'Limited'}
                  </span>{' '}
                  · {item.presentation}
                  {item.company ? ` · ${item.company}` : ''}
                </li>
              ))}
              {affected.length > LISTED && <li className="text-slate-500">and {affected.length - LISTED} more</li>}
            </ul>
          </details>
        )}
      </div>
      <a href={FDA_SHORTAGE_PAGE} target="_blank" rel="noopener noreferrer" className="self-center whitespace-nowrap text-sm font-semibold text-sky-700 hover:underline">
        Details →
      </a>
    </section>
  )
}
