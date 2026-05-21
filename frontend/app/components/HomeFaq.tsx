'use client'

import { useState } from 'react'

interface FaqItem {
  question: string
  answer: string
}

export default function HomeFaq({ items }: { items: readonly FaqItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  return (
    <div className="space-y-3">
      {items.map((item, index) => {
        const isOpen = openIndex === index
        return (
          <div key={item.question} className="border border-slate-200 bg-white rounded-xl overflow-hidden">
            <button
              type="button"
              className="w-full px-4 py-3 text-left flex items-center justify-between gap-3"
              onClick={() => setOpenIndex(isOpen ? null : index)}
              aria-expanded={isOpen}
            >
              <span className="font-medium text-slate-900">{item.question}</span>
              <span className="text-emerald-700 font-semibold" aria-hidden="true">
                {isOpen ? '−' : '+'}
              </span>
            </button>
            {isOpen && (
              <div className="px-4 pb-4 text-slate-600 text-sm leading-relaxed">
                {item.answer}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
