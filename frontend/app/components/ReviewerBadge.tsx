import Link from 'next/link'
import Image from 'next/image'

interface ReviewerBadgeProps {
  name: string
  credentials?: string | null
  slug: string
  photoUrl?: string | null
  lastReviewed?: string | null
  label?: string
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  } catch {
    return dateStr
  }
}

export default function ReviewerBadge({
  name,
  credentials,
  slug,
  photoUrl,
  lastReviewed,
  label = 'Medically reviewed by',
}: ReviewerBadgeProps) {
  const displayName = credentials ? `${name}, ${credentials}` : name

  return (
    <div className="flex flex-col gap-0.5">
      <Link
        href={`/editorial-team/${slug}`}
        className="flex items-center gap-2 text-sm text-slate-600 hover:text-emerald-700 transition-colors"
      >
        <span className="relative flex-shrink-0 w-8 h-8 rounded-full overflow-hidden bg-emerald-100 flex items-center justify-center">
          {photoUrl ? (
            <Image
              src={photoUrl}
              alt={name}
              fill
              className="object-cover"
              sizes="32px"
            />
          ) : (
            <span className="text-xs font-semibold text-emerald-700">
              {getInitials(name)}
            </span>
          )}
        </span>
        <span>
          <span className="text-slate-400 mr-1">{label}</span>
          <span className="font-medium text-slate-700">{displayName}</span>
        </span>
      </Link>
      {lastReviewed && (
        <p className="text-xs text-slate-400 pl-10">
          Last reviewed: {formatDate(lastReviewed)}
        </p>
      )}
    </div>
  )
}
