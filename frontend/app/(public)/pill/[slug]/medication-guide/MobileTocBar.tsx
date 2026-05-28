'use client'

import { useEffect, useRef, useState } from 'react'

interface MobileTocBarProps {
  /** The anchor id of the sentinel element placed just above the content area.
   *  When this element scrolls OUT of view (user scrolled down), the bar appears.
   *  When it scrolls back INTO view (user scrolled up to top), the bar hides.
   */
  sentinelId: string
  children: React.ReactNode
}

/**
 * Sticky mobile TOC bar that:
 * - Is hidden at the top of the page
 * - Appears (slides in from top) once the user scrolls past the sentinelId element
 * - Disappears again when the user scrolls back up past it
 * - Only renders on mobile (hidden on lg+ where the sidebar TOC is visible)
 */
export default function MobileTocBar({ sentinelId, children }: MobileTocBarProps) {
  const [visible, setVisible] = useState(false)
  const [open, setOpen] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const sentinel = document.getElementById(sentinelId)
    if (!sentinel) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        // Sentinel leaving viewport (scrolled down) → show bar
        // Sentinel entering viewport (scrolled up) → hide bar
        setVisible(!entry.isIntersecting)
        if (entry.isIntersecting) setOpen(false)
      },
      { threshold: 0 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [sentinelId])

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div
      ref={barRef}
      className={
        'no-print lg:hidden fixed top-0 left-0 right-0 z-40 transition-transform duration-200 ' +
        (visible ? 'translate-y-0' : '-translate-y-full')
      }
    >
      {/* Sticky bar button */}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-white border-b border-slate-200 shadow-sm text-sm font-semibold text-slate-800"
      >
        <span>On this page</span>
        <svg
          className={'h-4 w-4 text-slate-500 transition-transform ' + (open ? 'rotate-180' : '')}
          viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
        >
          <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {/* Dropdown TOC panel */}
      {open && (
        <div className="bg-white border-b border-slate-200 shadow-md px-4 py-3 max-h-[50vh] overflow-y-auto">
          {children}
        </div>
      )}
    </div>
  )
}
