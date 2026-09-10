import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getReviewer, type Reviewer } from '../lib/api'
import { shortDate } from '../lib/format'
import { useT } from '../lib/i18n'
import { hapticTick } from '../lib/native'

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

/**
 * "Reviewed by <medical reviewer> · Last verified <date>" — the same byline
 * the website shows. The reviewer comes from the editorial-team API (cached
 * for the session); tapping opens their profile on pillseek.com.
 */
export default function ReviewedBy({ lastVerified, className = '' }: { lastVerified?: string | null; className?: string }) {
  const navigate = useNavigate()
  const t = useT()
  const [reviewer, setReviewer] = useState<Reviewer | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    getReviewer()
      .then((r) => !cancelled && setReviewer(r))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const name = reviewer?.name ?? t('PillSeek Editorial Team')
  const credentials = reviewer?.credentials ?? null
  const to = reviewer?.slug ? `/editorial-team/${encodeURIComponent(reviewer.slug)}` : '/editorial-team'
  const date = shortDate(lastVerified)

  return (
    <button
      type="button"
      onClick={() => {
        void hapticTick()
        navigate(to)
      }}
      className={`pressable flex w-full items-center gap-2.5 rounded-xl px-1 py-1.5 text-left active:bg-brand-tint ${className}`}
      aria-label={t('Reviewed by {name}. Open profile', { name: credentials ? `${name}, ${credentials}` : name })}
    >
      {reviewer?.avatar_url && !failed ? (
        <img
          src={reviewer.avatar_url}
          alt=""
          width={32}
          height={32}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="h-8 w-8 flex-none rounded-full object-cover"
        />
      ) : (
        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-brand-tint text-[11px] font-bold text-brand" aria-hidden>
          {initials(name)}
        </span>
      )}
      <span className="min-w-0 text-[13px] leading-snug text-muted">
        {t('Reviewed by')} <span className="font-semibold text-body">{name}</span>
        {credentials && <span className="text-body">, {credentials}</span>}
        {date && <span className="block">{t('Last verified {date}', { date })}</span>}
      </span>
    </button>
  )
}
