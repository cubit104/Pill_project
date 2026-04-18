'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="bg-white border-b border-slate-200 shadow-sm sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-4 h-20 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2 hover:opacity-80 transition-opacity focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 rounded"
          aria-label="PillSeek home"
        >
          <img src="/1.png" alt="" width={56} height={56} className="h-12 w-12 object-contain" />
          <span className="text-2xl font-bold tracking-tight">
            <span className="text-slate-900">Pill</span><span className="text-emerald-700">Seek</span>
          </span>
        </Link>

        <nav className="hidden sm:flex items-center gap-6" aria-label="Main navigation">
          <Link href="/" className="text-slate-600 hover:text-emerald-700 font-medium transition-colors text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 rounded px-1">Home</Link>
          <Link href="/search" className="text-slate-600 hover:text-emerald-700 font-medium transition-colors text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 rounded px-1">Search</Link>
        </nav>

        <button
          className="sm:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          onClick={() => setMenuOpen((prev) => !prev)}
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        >
          {menuOpen ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
          )}
        </button>
      </div>

      {menuOpen && (
        <nav id="mobile-menu" className="sm:hidden bg-white border-t border-slate-100 px-4 py-3 flex flex-col gap-3" aria-label="Mobile navigation">
          <Link href="/" className="text-slate-700 hover:text-emerald-700 font-medium text-sm py-2 border-b border-slate-100" onClick={() => setMenuOpen(false)}>Home</Link>
          <Link href="/search" className="text-slate-700 hover:text-emerald-700 font-medium text-sm py-2" onClick={() => setMenuOpen(false)}>Search</Link>
        </nav>
      )}
    </header>
  )
}
