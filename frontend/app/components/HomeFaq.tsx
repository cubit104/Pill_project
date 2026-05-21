export const HOME_FAQS = [
  {
    question: 'How do I identify a pill on PillSeek?',
    answer:
      'Search by imprint, drug name, NDC, color, or shape to open a pill detail page with FDA-sourced identification data.',
  },
  {
    question: 'Can I check medication prices on PillSeek?',
    answer:
      'Yes. PillSeek links pill detail pages to NADAC-based price checks so you can compare generic and brand pricing trends.',
  },
  {
    question: 'Does PillSeek have patient-friendly medication guides?',
    answer:
      'Yes. When DailyMed provides an official medication guide, PillSeek publishes a patient-friendly version alongside the pill detail page.',
  },
  {
    question: 'Is PillSeek free to use?',
    answer:
      'Yes. PillSeek is free for patients, caregivers, and clinicians, and does not require an account to search pill data.',
  },
  {
    question: 'Where does PillSeek get its data?',
    answer:
      'PillSeek uses authoritative medication data from the FDA NDC Directory, DailyMed, RxNorm, and NADAC pricing files.',
  },
]

export default function HomeFaq() {
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
          {HOME_FAQS.map((item) => (
            <div
              key={item.question}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <h3 className="text-base font-semibold text-slate-900">{item.question}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.answer}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
