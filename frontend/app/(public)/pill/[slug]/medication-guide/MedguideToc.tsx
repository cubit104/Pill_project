'use client'

import { useEffect, useRef, useState } from 'react'
import { shortenTocLabel } from './shortenTocLabel.mjs'

interface TocEntry {
  id: string
  text: string
  level: 2 | 3
}
const TOC_LINK_BASE_CLASSES = 'block break-words py-1 text-xs leading-5'

function extractHeadings(html: string): TocEntry[] {
  if (typeof window === 'undefined' || !html) return []
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const headings = doc.querySelectorAll<HTMLElement>('h2[id], h3[id]')
    const entries: TocEntry[] = []
    headings.forEach((el) => {
      const id = el.getAttribute('id')
      const text = el.textContent?.trim()
      if (id && text) {
        entries.push({ id, text, level: el.tagName === 'H2' ? 2 : 3 })
      }
    })
    return entries
  } catch {
    return []
  }
}

export default function MedguideToc({ html, drugName }: { html: string; drugName: string }) {
  const [entries, setEntries] = useState<TocEntry[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)

  // Parse headings on mount (DOMParser is browser-only)
  useEffect(() => {
    setEntries(extractHeadings(html))
  }, [html])

  // IntersectionObserver: track the currently visible heading
  useEffect(() => {
    if (entries.length === 0) return

    observerRef.current?.disconnect()

    const contentEl = document.getElementById('medguide-content')
    if (!contentEl) return

    const headingEls: Element[] = []
    entries.forEach(({ id }) => {
      // CSS.escape is defensive — the backend _slugify already produces safe ids,
      // but we guard here in case the HTML comes from an unexpected source.
      const el = contentEl.querySelector(`#${CSS.escape(id)}`)
      if (el) headingEls.push(el)
    })

    if (headingEls.length === 0) return

    // Track which headings are currently intersecting
    const visibleSet = new Set<string>()

    const observer = new IntersectionObserver(
      (obs) => {
        obs.forEach((entry) => {
          const id = entry.target.getAttribute('id')
          if (!id) return
          if (entry.isIntersecting) {
            visibleSet.add(id)
          } else {
            visibleSet.delete(id)
          }
        })
        // Pick the first entry (in DOM order) that is currently visible
        const first = entries.find(({ id }) => visibleSet.has(id))
        if (first) setActiveId(first.id)
      },
      { rootMargin: '0px 0px -60% 0px', threshold: 0 }
    )

    headingEls.forEach((el) => observer.observe(el))
    observerRef.current = observer

    return () => observer.disconnect()
  }, [entries])

  if (entries.length < 3) return null

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>, id: string) {
    e.preventDefault()
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      history.replaceState(null, '', `#${id}`)
      setActiveId(id)
    }
  }

  return (
    <nav aria-label="On this page" className="w-full max-w-[16rem]">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
        On this page
      </p>
      <ul className="space-y-1.5">
        {entries.map(({ id, text, level }) => (
          <li key={id} className={level === 3 ? 'pl-4' : ''}>
            <a
              href={`#${id}`}
              onClick={(e) => handleClick(e, id)}
              className={
                activeId === id
                  ? `${TOC_LINK_BASE_CLASSES} font-semibold text-emerald-800`
                  : `${TOC_LINK_BASE_CLASSES} font-medium text-emerald-600 hover:text-emerald-800`
              }
              title={text}
              aria-label={text}
            >
              {shortenTocLabel(text, drugName)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
