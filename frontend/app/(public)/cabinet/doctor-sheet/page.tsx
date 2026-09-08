import type { Metadata } from 'next'
import DoctorSheetClient from './DoctorSheetClient'

export const metadata: Metadata = {
  title: 'Doctor Sheet — My Medications | PillSeek',
  description: 'A printable list of the medicines in your PillSeek cabinet to share with your doctor or pharmacist.',
  alternates: { canonical: '/cabinet/doctor-sheet' },
  robots: { index: false, follow: false },
}

export default function DoctorSheetPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <h1 className="no-print text-3xl font-extrabold tracking-tight text-slate-900">Doctor sheet</h1>
      <p className="no-print mt-2 text-slate-600">Everything in your cabinet in one list to print, save as PDF, or show at your next appointment.</p>
      <div className="mt-6">
        <DoctorSheetClient />
      </div>
    </div>
  )
}
