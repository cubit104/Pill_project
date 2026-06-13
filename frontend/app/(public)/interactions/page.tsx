import type { Metadata } from 'next'
import InteractionsCheckerClient from './InteractionsCheckerClient'
import { breadcrumbSchema, faqSchema, safeJsonLd } from '../../lib/structured-data'

export const metadata: Metadata = {
  title: 'Drug Interaction Checker — Check Multiple Medications | PillSeek',
  description:
    'Free drug interaction checker for drug-drug, drug-food, and drug-disease interactions. Add multiple medications to see severity, management guidance, and references from curated clinical sources.',
  alternates: { canonical: '/interactions' },
}

const faqs = [
  {
    question: 'What is a drug interaction?',
    answer:
      'A drug interaction occurs when one medication affects how another medication works. This can increase side effects, reduce effectiveness, or cause unexpected reactions. Interactions can happen between prescription drugs, over-the-counter medications, and even supplements.',
  },
  {
    question: 'How does PillSeek check drug interactions?',
    answer:
      'PillSeek cross-references your medications across drug-drug, drug-food, and drug-disease interaction datasets. Results combine DDInter-curated guidance with additional clinically curated data and FDA label text where available.',
  },
  {
    question: 'What do major, moderate, and minor interactions mean?',
    answer:
      'Major interactions may be life-threatening or require immediate medical attention. Moderate interactions may require a change in therapy or close monitoring. Minor interactions have limited clinical significance but should still be discussed with your healthcare provider.',
  },
  {
    question: 'Can I check more than two drugs at once?',
    answer:
      'Yes. Add up to 10 medications and click Check Interactions. PillSeek checks all drug pairs in one run and also returns related food and condition warnings for those medications.',
  },
  {
    question: 'Where does PillSeek get its drug interaction data?',
    answer:
      'Our interaction data comes from DDInter-curated interaction datasets, existing pairwise interaction records, and FDA-backed label text. Source badges on each card indicate whether details came from DDInter, pairwise database records, or OpenFDA-backed references.',
  },
  {
    question: 'Should I stop taking my medication if an interaction is found?',
    answer:
      'No — do not stop or change any medication without consulting your doctor or pharmacist first. Many drug interactions are manageable with proper monitoring or dosage adjustments. This tool is for informational purposes only and is not a substitute for professional medical advice.',
  },
]

export default function InteractionsPage() {
  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: 'Drug Interaction Checker', url: '/interactions' },
  ])
  const faqJsonLd = faqSchema(faqs)

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(faqJsonLd) }} />
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Drug Interaction Checker</h1>
          <p className="text-slate-600">
            Add multiple medications to check drug-drug, drug-food, and drug-disease interactions at once.
            Results include severity, source badges, management guidance, and reference text where available.
            Enter each drug name and click <strong>Check Interactions</strong>.
          </p>
        </div>
        <InteractionsCheckerClient />
        <section className="mt-10">
          <h2 className="text-2xl font-semibold text-slate-900 mb-4">Frequently Asked Questions</h2>
          <div className="space-y-3">
            {faqs.map((item) => (
              <details key={item.question} className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                <summary className="font-semibold text-slate-900 cursor-pointer">{item.question}</summary>
                <p className="mt-2 leading-relaxed">{item.answer}</p>
              </details>
            ))}
          </div>
        </section>
      </div>
    </>
  )
}
