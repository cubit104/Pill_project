import type { Metadata } from 'next'
import Link from 'next/link'
import { breadcrumbSchema, faqSchema } from '../lib/structured-data'

export const metadata: Metadata = {
  title: 'Medical Disclaimer — IDMyPills',
  description:
    'IDMyPills is for educational and identification purposes only. Not a substitute for professional medical advice. Always consult a licensed pharmacist or physician.',
  alternates: { canonical: '/medical-disclaimer' },
}

const faqs = [
  {
    question: 'Can I use IDMyPills to identify a medication and take it?',
    answer:
      'No. Pill identification is only the first step. Even after identifying a medication, you should consult a licensed pharmacist or physician before taking any medication, especially if you are unsure whether it is appropriate for you.',
  },
  {
    question: 'What should I do if I find an unknown pill?',
    answer:
      'If you find an unknown pill, you can use IDMyPills to help identify it visually. However, always confirm with a licensed pharmacist. If someone may have ingested an unknown substance, contact Poison Control (1-800-222-1222 in the US) or emergency services immediately.',
  },
  {
    question: 'Is IDMyPills data accurate?',
    answer:
      'IDMyPills sources data directly from the FDA NDC Directory and DailyMed. While we strive for accuracy, drug databases can contain errors. Always confirm medication identification with a licensed pharmacist before relying on it for any medical decision.',
  },
  {
    question: 'Does IDMyPills provide dosing information?',
    answer:
      'No. IDMyPills displays basic drug information as filed with the FDA (strength, ingredients, form) but does not provide dosing instructions, treatment recommendations, or medical advice of any kind.',
  },
]

export default function MedicalDisclaimerPage() {
  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: 'Medical Disclaimer', url: '/medical-disclaimer' },
  ])
  const faqJsonLd = faqSchema(faqs)

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      <div className="max-w-3xl mx-auto px-4 py-12">
        <nav aria-label="Breadcrumb" className="mb-6">
          <ol className="flex items-center gap-1 text-sm text-slate-500">
            <li><Link href="/" className="hover:text-sky-700">Home</Link></li>
            <li aria-hidden="true" className="select-none">›</li>
            <li className="text-slate-700 font-medium">Medical Disclaimer</li>
          </ol>
        </nav>

        {/* Critical disclaimer banner */}
        <div className="bg-red-50 border-2 border-red-300 rounded-xl p-6 mb-8">
          <div className="flex gap-3">
            <span className="text-2xl" aria-hidden="true">⚠️</span>
            <div>
              <h1 className="text-xl font-bold text-red-800 mb-2">Medical Disclaimer</h1>
              <p className="text-red-700 leading-relaxed font-medium">
                IDMyPills is for <strong>educational and identification purposes only</strong>.
                It is <strong>not medical advice</strong> and must not be used as a substitute
                for professional medical advice, diagnosis, or treatment. Always consult a
                licensed pharmacist or physician before making any medication decision.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800 mb-3">
              Purpose of IDMyPills
            </h2>
            <p className="text-slate-700 text-sm leading-relaxed mb-3">
              IDMyPills is a pill identification reference tool. It is designed to help patients,
              caregivers, and healthcare professionals visually identify medications by their
              physical characteristics (color, shape, imprint code).
            </p>
            <p className="text-slate-700 text-sm leading-relaxed">
              IDMyPills does <strong>not</strong>:
            </p>
            <ul className="mt-2 space-y-1 text-slate-700 text-sm">
              <li className="flex gap-2"><span className="text-red-500">✗</span> Provide dosing recommendations</li>
              <li className="flex gap-2"><span className="text-red-500">✗</span> Provide medical advice or treatment plans</li>
              <li className="flex gap-2"><span className="text-red-500">✗</span> Diagnose any medical condition</li>
              <li className="flex gap-2"><span className="text-red-500">✗</span> Replace a licensed healthcare provider</li>
            </ul>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800 mb-3">
              Emergency Situations
            </h2>
            <p className="text-slate-700 text-sm leading-relaxed mb-3">
              <strong>If you believe someone has taken an unknown medication or overdosed:</strong>
            </p>
            <ul className="space-y-2 text-slate-700 text-sm">
              <li className="flex gap-2">
                <span className="text-red-600 font-bold shrink-0">→</span>
                Call <strong>911</strong> (or your local emergency services) immediately
              </li>
              <li className="flex gap-2">
                <span className="text-red-600 font-bold shrink-0">→</span>
                Contact <strong>Poison Control</strong> at <a href="tel:18002221222" className="text-sky-600 font-bold hover:underline">1-800-222-1222</a> (US)
              </li>
            </ul>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800 mb-3">
              Always Consult a Professional
            </h2>
            <p className="text-slate-700 text-sm leading-relaxed">
              Even after identifying a medication using IDMyPills, always confirm the identification
              with a licensed pharmacist. Pill appearances can be similar across different
              medications, and database errors can occur. A pharmacist can verify the medication
              and advise whether it is safe and appropriate for you.
            </p>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800 mb-3">
              Data Sources and Accuracy
            </h2>
            <p className="text-slate-700 text-sm leading-relaxed">
              IDMyPills data is sourced from the FDA National Drug Code (NDC) Directory and
              DailyMed. While these are authoritative sources, IDMyPills makes no warranty
              regarding the accuracy, completeness, or currency of the information displayed.
              Medication formulations can change, and some older entries may be outdated.
            </p>
            <p className="text-slate-600 text-sm mt-3">
              <Link href="/sources" className="text-sky-600 hover:underline">
                View our data sources →
              </Link>
            </p>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">
              Frequently Asked Questions
            </h2>
            <div className="space-y-5">
              {faqs.map((faq) => (
                <div key={faq.question}>
                  <h3 className="font-medium text-slate-800 mb-1">{faq.question}</h3>
                  <p className="text-slate-600 text-sm leading-relaxed">{faq.answer}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  )
}
