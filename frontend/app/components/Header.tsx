'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [hidden, setHidden] = useState(false)
  const lastScrollY = useRef(0)

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY
      const isMobile = window.innerWidth < 640

      if (!isMobile || menuOpen) {
        setHidden(false)
        lastScrollY.current = currentScrollY
        return
      }

      if (currentScrollY <= 0) {
        setHidden(false)
      } else if (currentScrollY > lastScrollY.current + 4) {
        setHidden(true)
      } else if (currentScrollY < lastScrollY.current - 4) {
        setHidden(false)
      }

      lastScrollY.current = currentScrollY
    }

    const handleResize = () => {
      if (window.innerWidth >= 640) {
        setHidden(false)
      }
    }

    lastScrollY.current = window.scrollY
    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleResize)
    }
  }, [menuOpen])

  return (
    <>
      <header
        className={`bg-white border-b border-slate-200 shadow-sm fixed sm:sticky top-0 left-0 w-full z-40 pt-[env(safe-area-inset-top)] sm:pt-0 transition-transform duration-300 sm:transition-none ${hidden ? '-translate-y-full sm:translate-y-0' : 'translate-y-0'}`}
      >
        <div className="max-w-6xl mx-auto px-4 h-12 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-1 hover:opacity-80 transition-opacity focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 rounded"
            aria-label="PillSeek home"
          >
            <img src="/logo-mark.svg" alt="" width={48} height={48} className="h-9 w-9 object-contain" />
            <span className="text-2xl font-extrabold tracking-tight">
              <span className="text-slate-900">Pill</span><span className="text-emerald-700">Seek</span>
            </span>
          </Link>

          <nav className="hidden sm:flex items-center gap-8" aria-label="Main navigation">
            <Link href="/" className="text-slate-600 hover:text-emerald-700 font-medium transition-colors text-base focus:outline-none focus:ring-2 focus:ring-emerald-500 rounded px-1">Home</Link>
            <Link href="/search" className="text-slate-600 hover:text-emerald-700 font-medium transition-colors text-base focus:outline-none focus:ring-2 focus:ring-emerald-500 rounded px-1">Search</Link>
          </nav>

          <button
            className="sm:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            onClick={() => setMenuOpen((prev) => !prev)}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          >
            {menuOpen ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
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
      <div className="h-[calc(3rem+env(safe-area-inset-top))] sm:hidden" />
    </>
  )
}
