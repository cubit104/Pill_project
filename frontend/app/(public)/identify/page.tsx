import type { Metadata } from 'next'
import IdentifyClient from './IdentifyClient'

export const metadata: Metadata = {
  title: 'Identify a Pill by Photo — Free Camera Pill Identifier',
  description:
    'Take a photo of both sides of a pill and identify it. Free camera-based pill identification by imprint, color, and shape. Photos are analyzed in memory and only kept if you choose to share them.',
  alternates: { canonical: '/identify' },
}

export default function IdentifyPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-slate-900 mb-2">
        Identify a Pill by <span className="text-emerald-700">Photo</span>
      </h1>
      <p className="text-slate-600 mb-6">
        Snap a photo of each side of the pill. Our own reader, trained on PillSeek&apos;s pill photo
        library, reads the imprint and matches it against 14,000+ medications. Photos are analyzed
        in memory and <strong>never stored</strong> unless you choose to share them to improve the reader.
      </p>
      <IdentifyClient />
    </main>
  )
}
