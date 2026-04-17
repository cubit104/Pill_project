import type { Metadata } from 'next'
import HomeSearch from './components/HomeSearch'

export const metadata: Metadata = {
  alternates: { canonical: '/' },
}

export default function HomePage() {
  return (
    <>
      {/* Hero Section */}
      <section className="bg-gradient-to-br from-sky-700 to-sky-900 text-white py-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="text-6xl mb-4" role="img" aria-label="Pill emoji">
            💊
          </div>
          <h1 className="text-5xl font-bold mb-4 tracking-tight">IDMyPills</h1>
          <p className="text-xl text-sky-100 mb-2 font-medium">
            Identify Any Medication by Imprint, Color, or Shape
          </p>
          <p className="text-sky-200 text-sm mb-10">
            Search our database of thousands of FDA-approved medications instantly
          </p>
          <HomeSearch />
        </div>
      </section>

      {/* Stats / Trust Indicators */}
      <section className="bg-white border-b border-slate-200 py-10 px-4">
        <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          {[
            { value: '10,000+', label: 'Medications' },
            { value: 'Free', label: 'Always Free' },
            { value: 'FDA', label: 'Data Source' },
            { value: '24/7', label: 'Available' },
          ].map((stat) => (
            <div key={stat.label}>
              <p className="text-3xl font-bold text-sky-700">{stat.value}</p>
              <p className="text-slate-600 text-sm mt-1">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-center text-slate-900 mb-10">
            How It Works
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: '1',
                icon: '🔍',
                title: 'Search by Imprint',
                desc: 'Enter the letters or numbers stamped on your pill to find an exact match.',
              },
              {
                step: '2',
                icon: '🎨',
                title: 'Filter by Color & Shape',
                desc: 'Narrow results using the pill\'s color and shape for faster identification.',
              },
              {
                step: '3',
                icon: '📋',
                title: 'View Full Details',
                desc: 'See drug name, dosage, ingredients, manufacturer, and safety information.',
              },
            ].map((item) => (
              <div
                key={item.step}
                className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm text-center"
              >
                <div className="text-4xl mb-3" role="img" aria-label={item.title}>
                  {item.icon}
                </div>
                <h3 className="font-semibold text-slate-900 mb-2">{item.title}</h3>
                <p className="text-slate-600 text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Disclaimer */}
      <section className="py-8 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
            <p className="text-amber-800 text-sm text-center leading-relaxed">
              <strong>⚠️ Medical Disclaimer:</strong> IDMyPills is for educational and
              informational purposes only. It is not a substitute for professional medical
              advice, diagnosis, or treatment. Always consult a qualified healthcare
              professional before making any medical decisions.
            </p>
          </div>
        </div>
      </section>
    </>
  )
}
