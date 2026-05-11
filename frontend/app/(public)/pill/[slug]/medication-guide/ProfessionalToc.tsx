'use client'

import { useEffect, useState } from 'react'
import { MIN_PROFESSIONAL_TOC_SECTIONS } from './professionalTocConfig'

type Section = { slug: string; label: string }
const PRO_TOC_ROOT_MARGIN = '-100px 0px -60% 0px'

export default function ProfessionalToc({ sections }: { sections: Section[] }) {
  const [activeId, setActiveId] = useState<string | null>(sections[0]?.slug ?? null)

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    if (sections.length > 0) return
    console.warn('ProfessionalToc: sections is empty; TOC will not render.')
  }, [sections])

  useEffect(() => {
    setActiveId(sections[0]?.slug ?? null)
  }, [sections])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const article = document.getElementById('pro-content')
    if (!article) return

    const headings = sections
      .map((section) => article.querySelector(`#${CSS.escape(section.slug)}`))
      .filter((element): element is Element => !!element)

    if (!headings.length) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) {
          setActiveId(visible[0].target.id)
        }
      },
      // Match the consumer TOC feel: activate slightly before the heading reaches the top,
      // then keep it active until it has mostly scrolled past the viewport.
      { rootMargin: PRO_TOC_ROOT_MARGIN, threshold: 0 }
    )

    headings.forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [sections])

  if (sections.length < MIN_PROFESSIONAL_TOC_SECTIONS) return null

  return (
    <nav aria-label="On this page" className="w-full max-w-[16rem]">
      <div className="text-xs uppercase tracking-wide text-slate-500 mb-3">On this page</div>
      <ul className="space-y-1.5">
        {sections.map((section) => (
          <li key={section.slug}>
            <a
              href={`#${section.slug}`}
              title={section.label}
              className={
                'block text-sm transition-colors ' +
                (activeId === section.slug
                  ? 'text-emerald-800 font-semibold'
                  : 'text-emerald-600 hover:text-emerald-800')
              }
              onClick={(event) => {
                event.preventDefault()
                const element = document.getElementById(section.slug)
                if (element) {
                  element.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  history.replaceState(null, '', `#${section.slug}`)
                  setActiveId(section.slug)
                }
              }}
            >
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
