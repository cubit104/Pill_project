import Link from 'next/link'

export default function NotFound() {
  return (
    <section className="py-24 px-4 text-center">
      <img src="/logo-mark.svg" alt="" width={120} height={120} className="mx-auto mb-6 opacity-60" />
      <h1 className="text-4xl font-bold text-slate-900 mb-3">Page not found</h1>
      <p className="text-slate-600 mb-8 max-w-md mx-auto">
        We couldn&apos;t find the pill you were looking for. Try searching by imprint, drug name, or NDC.
      </p>
      <Link
        href="/"
        className="inline-block bg-emerald-700 hover:bg-emerald-800 text-white font-semibold px-6 py-3 rounded-lg transition-colors"
      >
        Back to Home
      </Link>
    </section>
  )
}
