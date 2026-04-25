'use client'

export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded-xl bg-white border border-gray-100 shadow-sm p-5 ${className}`}>
      <div className="h-3 w-24 bg-gray-200 rounded mb-3" />
      <div className="h-8 w-32 bg-gray-200 rounded mb-2" />
      <div className="h-2 w-full bg-gray-100 rounded" />
    </div>
  )
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="animate-pulse space-y-2">
      <div className="flex gap-3">
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="h-3 flex-1 bg-gray-200 rounded" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3">
          {Array.from({ length: cols }).map((_, j) => (
            <div key={j} className={`h-4 flex-1 bg-gray-${i % 2 === 0 ? '100' : '50'} rounded`} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function SkeletonChart({ height = 200 }: { height?: number }) {
  return (
    <div className="animate-pulse rounded-lg bg-gray-100" style={{ height }} />
  )
}
