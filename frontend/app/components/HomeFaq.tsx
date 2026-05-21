'use client'

import { useState } from 'react'
import { HOME_FAQS } from './homeFaqItems'

export default function HomeFaq() {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  return (
    <section className="py-12 px-4 bg-slate-50 border-t border-slate-200">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-2xl sm:text-3xl font-bold text-center text-slate-900 mb-2">
          Frequently Asked Questions
        </h2>
        <p className="text-center text-slate-600 mb-8 max-w-2xl mx-auto">
          Quick answers about pill identification, pricing, guides, and data sources.
        </p>
        <div className="space-y-4">
          {HOME_FAQS.map((item, index) => (
            <div
              key={item.question}
              className="rounded-xl border border-slate-200 bg-white shadow-sm"
            >
              <button
                type="button"
                aria-expanded={openIndex === index}
                onClick={() => setOpenIndex(openIndex === index ? null : index)}
                className="w-full rounded-xl px-5 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
              >
                <span className="flex items-center justify-between gap-4">
                  <h3 className="text-base font-semibold text-slate-900">{item.question}</h3>
                  <span className="text-2xl leading-none text-emerald-700" aria-hidden="true">
                    {openIndex === index ? '−' : '+'}
                  </span>
                </span>
              </button>
              {openIndex === index ? (
                <p className="px-5 pb-5 text-sm leading-relaxed text-slate-600">{item.answer}</p>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
