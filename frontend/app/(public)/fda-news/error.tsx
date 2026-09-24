'use client'

import Link from 'next/link'

/** Shown when the FDA feed did not answer; nothing is cached, so the next visit tries again. */
export default function FdaNewsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center">
      <h1 className="text-2xl font-bold text-slate-900">The FDA is not answering right now</h1>
      <p className="mt-3 text-slate-600">This page is built from live FDA data, and the FDA feed did not respond. Please try again in a minute.</p>
      <div className="mt-6 flex justify-center gap-4 text-sm font-semibold">
        <button type="button" onClick={reset} className="rounded-lg bg-emerald-700 px-4 py-2 text-white hover:bg-emerald-800">
          Try again
        </button>
        <Link href="/fda-news" className="rounded-lg border border-slate-300 px-4 py-2 text-slate-700 hover:bg-slate-50">
          All FDA news
        </Link>
      </div>
    </div>
  )
}
