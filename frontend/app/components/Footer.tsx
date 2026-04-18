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
          before making any medication decisions.{' '}
          <Link href="/medical-disclaimer" className="underline hover:text-amber-900">
            Read full disclaimer
          </Link>
          .
        </p>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-10">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          {/* Branding */}
          <div>
            <Link
              href="/"
              className="flex items-center gap-2 text-sky-700 font-bold text-lg mb-3"
              aria-label="IDMyPills home"
            >
              <span role="img" aria-hidden="true">💊</span>
              <span>IDMyPills</span>
            </Link>
            <p className="text-slate-500 text-xs leading-relaxed">
              Free pill identification powered by FDA &amp; DailyMed data. For educational
              purposes only.
            </p>
          </div>

          {/* Browse */}
          <nav aria-label="Browse categories">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Browse Pills</h3>
            <ul className="space-y-2">
              <li>
                <Link href="/search" className="text-slate-500 hover:text-sky-700 text-sm transition-colors">
                  Search All Pills
                </Link>
              </li>
              <li>
                <Link href="/color/white" className="text-slate-500 hover:text-sky-700 text-sm transition-colors">
                  White Pills
                </Link>
              </li>
              <li>
                <Link href="/shape/round" className="text-slate-500 hover:text-sky-700 text-sm transition-colors">
                  Round Pills
                </Link>
              </li>
              <li>
                <Link href="/shape/oval" className="text-slate-500 hover:text-sky-700 text-sm transition-colors">
                  Oval Pills
                </Link>
              </li>
            </ul>
          </nav>

          {/* Company */}
          <nav aria-label="Company links">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Company</h3>
            <ul className="space-y-2">
              <li>
                <Link href="/about" className="text-slate-500 hover:text-sky-700 text-sm transition-colors">
                  About
                </Link>
              </li>
              <li>
                <Link href="/sources" className="text-slate-500 hover:text-sky-700 text-sm transition-colors">
                  Data Sources
                </Link>
              </li>
              <li>
                <Link href="/contact" className="text-slate-500 hover:text-sky-700 text-sm transition-colors">
                  Contact
                </Link>
              </li>
            </ul>
          </nav>

          {/* Legal */}
          <nav aria-label="Legal links">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Legal &amp; Safety</h3>
            <ul className="space-y-2">
              <li>
                <Link href="/medical-disclaimer" className="text-slate-500 hover:text-sky-700 text-sm transition-colors">
                  Medical Disclaimer
                </Link>
              </li>
              <li>
                <Link href="/privacy" className="text-slate-500 hover:text-sky-700 text-sm transition-colors">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="/terms" className="text-slate-500 hover:text-sky-700 text-sm transition-colors">
                  Terms of Use
                </Link>
              </li>
            </ul>
          </nav>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-slate-100 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-slate-400 text-xs">
            © {year} IDMyPills. All rights reserved. Data sourced from FDA NDC &amp; DailyMed.
          </p>
          <p className="text-slate-400 text-xs">
            Not a medical device. For identification purposes only.
          </p>
        </div>
      </div>
    </footer>
  )
}
