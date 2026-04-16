import Link from 'next/link'

export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="bg-white border-t border-slate-200 mt-12">
      {/* Medical Disclaimer */}
      <div className="bg-amber-50 border-b border-amber-200 py-4 px-4">
        <p className="max-w-4xl mx-auto text-amber-800 text-sm text-center leading-relaxed">
          <strong>⚠️ Medical Disclaimer:</strong> IDMyPills is intended for educational and
          informational purposes only. This tool is not a substitute for professional medical
          advice, diagnosis, or treatment. Always consult a qualified healthcare professional
          before making any medication decisions.
        </p>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          {/* Branding */}
          <div className="flex items-center gap-2 text-sky-700 font-bold text-lg">
            <span role="img" aria-label="Pill">💊</span>
            <span>IDMyPills</span>
          </div>

          {/* Links */}
          <nav className="flex flex-wrap justify-center gap-x-6 gap-y-2" aria-label="Footer navigation">
            <Link href="/" className="text-slate-500 hover:text-sky-700 text-sm transition-colors">
              Home
            </Link>
            <Link href="/search" className="text-slate-500 hover:text-sky-700 text-sm transition-colors">
              Search
            </Link>
          </nav>

          {/* Copyright */}
          <p className="text-slate-400 text-sm">
            © {year} IDMyPills. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}
