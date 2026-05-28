'use client'

import { useEffect, useRef, useState } from 'react'

interface MobileTocBarProps {
  /** The anchor id of the sentinel element placed just above the content area.
   *  When this element scrolls OUT of view (user scrolled down past it), the bar becomes
   *  eligible to show. It then hides while scrolling down and shows while scrolling up.
   *  When the sentinel re-enters view (scrolled back to top), the bar hides completely.
   */
  sentinelId: string
  children: React.ReactNode
}

const SCROLL_HIDE_THRESHOLD = 6 // px — ignore tiny jitter

/**
 * Sticky mobile TOC bar that:
 * - Is hidden at the top of the page (sentinel in view)
 * - Becomes active once user scrolls past the sentinel
 * - Hides (slides up) while scrolling DOWN
 * - Reappears (slides down) while scrolling UP
 * - Hides completely when user scrolls back to the top (sentinel re-enters view)
 * - Only renders on mobile (lg+ uses the sidebar TOC)
 */
export default function MobileTocBar({ sentinelId, children }: MobileTocBarProps) {
  const [pastSentinel, setPastSentinel] = useState(false)
  const [visible, setVisible] = useState(false)
  const [open, setOpen] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)
  const lastScrollY = useRef(0)

  // Track whether the sentinel has scrolled out of view
  useEffect(() => {
    const sentinel = document.getElementById(sentinelId)
    if (!sentinel) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        const scrolledPast = !entry.isIntersecting
        setPastSentinel(scrolledPast)
        if (!scrolledPast) {
          // Scrolled back to top — hide bar and close dropdown
          setVisible(false)
          setOpen(false)
        }
      },
      { threshold: 0 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [sentinelId])

  // Hide on scroll-down, show on scroll-up (only when past sentinel)
  useEffect(() => {
    if (!pastSentinel) return

    function handleScroll() {
      const currentY = window.scrollY
      const delta = currentY - lastScrollY.current
      if (Math.abs(delta) < SCROLL_HIDE_THRESHOLD) return
      if (delta > 0) {
        // Scrolling down — hide bar and close dropdown
        setVisible(false)
        setOpen(false)
      } else {
        // Scrolling up — show bar
        setVisible(true)
      }
      lastScrollY.current = currentY
    }

    lastScrollY.current = window.scrollY
    // Show bar immediately when we first scroll past sentinel
    setVisible(true)

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [pastSentinel])

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

      {/* Dropdown TOC panel — 3-column grid for compact display on mobile */}
      {open && (
        <div className="bg-white border-b border-slate-200 shadow-md px-4 py-3 max-h-[50vh] overflow-y-auto">
          <div className="grid grid-cols-3 gap-x-3 gap-y-0.5">
            {children}
          </div>
        </div>
      )}
    </div>
  )
}
