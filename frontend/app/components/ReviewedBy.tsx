import Image from 'next/image'
import Link from 'next/link'
import { fetchPublicReviewers } from '../lib/reviewers'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'

function formatDate(value?: string | null): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export default async function ReviewedBy({ lastVerifiedIso }: { lastVerifiedIso?: string | null }) {
  const reviewers = await fetchPublicReviewers(API_BASE, { next: { revalidate: 3600 } })
  const preferredReviewer =
    reviewers.find((reviewer) => reviewer.role?.toLowerCase() === 'medical_reviewer') ?? reviewers[0]

  const reviewerName = preferredReviewer?.name || 'PillSeek Editorial Team'
  const reviewerCredentials = preferredReviewer?.credentials?.trim() || null
  const reviewerSlug = preferredReviewer?.slug || null
  const reviewerAvatar = preferredReviewer?.avatar_url || null
  const href = reviewerSlug ? `/editorial-team/${reviewerSlug}` : '/editorial-team'
  const formattedDate = formatDate(lastVerifiedIso)
  const avatarLabel = getInitials(reviewerName)

  return (
    <p className="text-xs text-slate-500 mb-3 flex items-center gap-2 flex-wrap">
      {reviewerAvatar ? (
        <Image
          src={reviewerAvatar}
          alt={reviewerName}
          width={28}
          height={28}
          className="rounded-full object-cover"
        />
      ) : (
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-semibold text-emerald-700">
          {avatarLabel}
        </span>
      )}
      <span>
        Reviewed by{' '}
        <Link href={href} className="underline hover:text-slate-700">
          {reviewerName}
          {reviewerCredentials ? `, ${reviewerCredentials}` : ''}
        </Link>
        {formattedDate && (
          <>
            {' · '}Last verified <time dateTime={lastVerifiedIso ?? undefined}>{formattedDate}</time>
          </>
        )}
      </span>
    </p>
  )
}
