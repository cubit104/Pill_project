'use client'

import { useEffect, useState } from 'react'

type Section = { slug: string; label: string }

export default function ProfessionalToc({ sections }: { sections: Section[] }) {
  const [activeId, setActiveId] = useState<string | null>(sections[0]?.slug ?? null)

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
      { rootMargin: '-100px 0px -60% 0px', threshold: 0 }
    )

    headings.forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [sections])

  return (
    <nav aria-label="On this page">
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
                  ? 'text-sky-700 font-semibold'
                  : 'text-slate-600 hover:text-slate-900')
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
