import type { Metadata } from 'next'
import CabinetClient from './CabinetClient'

export const metadata: Metadata = {
  title: 'My Medicine Cabinet',
  description: 'Save the pills you take, set reminders, and check them for interactions. One account for pillseek.com and the PillSeek app.',
  alternates: { canonical: '/cabinet' },
  robots: { index: false, follow: false },
}

export default function CabinetPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
      <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">My cabinet</h1>
      <p className="mt-2 text-slate-600">Save the pills you take, set reminders, and check them for interactions. Sign in with your email to keep it on every device.</p>
      <div className="mt-6">
        <CabinetClient />
      </div>
    </div>
  )
}
