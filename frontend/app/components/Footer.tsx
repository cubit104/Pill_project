import Link from 'next/link'

export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="bg-white border-t border-slate-200 mt-12">
      <div className="bg-amber-50 border-b border-amber-200 py-4 px-4">
        <p className="max-w-4xl mx-auto text-amber-800 text-sm text-center leading-relaxed">
          <strong>⚠️ Medical Disclaimer:</strong> PillSeek is intended for educational and
          informational purposes only. This tool is not a substitute for professional medical
          advice, diagnosis, or treatment. Always consult a qualified healthcare professional
          before making any medication decisions.{' '}
          <Link href="/medical-disclaimer" className="underline hover:text-amber-900">Read full disclaimer</Link>.
        </p>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-10">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-8 mb-8">
          <div>
            <Link href="/" className="flex items-center gap-2 mb-3" aria-label="PillSeek home">
              <img src="/logo-mark.svg" alt="" width={32} height={32} className="h-8 w-8 object-contain" />
              <span className="font-bold text-lg">
                <span className="text-slate-900">Pill</span><span className="text-emerald-700">Seek</span>
              </span>
            </Link>
            <p className="text-slate-500 text-xs leading-relaxed">
              Free pill identification powered by FDA &amp; DailyMed data. For educational purposes only.
            </p>
          </div>

          <nav aria-label="Browse categories">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Browse Pills</h3>
            <ul className="space-y-2">
              <li><Link href="/search" className="text-slate-500 hover:text-emerald-700 text-sm transition-colors">Search All Pills</Link></li>
              <li><Link href="/color/white" className="text-slate-500 hover:text-emerald-700 text-sm transition-colors">White Pills</Link></li>
              <li><Link href="/shape/round" className="text-slate-500 hover:text-emerald-700 text-sm transition-colors">Round Pills</Link></li>
              <li><Link href="/shape/oval" className="text-slate-500 hover:text-emerald-700 text-sm transition-colors">Oval Pills</Link></li>
            </ul>
          </nav>

          <nav aria-label="Company links">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Company</h3>
            <ul className="space-y-2">
              <li><Link href="/about" className="text-slate-500 hover:text-emerald-700 text-sm transition-colors">About</Link></li>
              <li><Link href="/sources" className="text-slate-500 hover:text-emerald-700 text-sm transition-colors">Data Sources</Link></li>
              <li><Link href="/contact" className="text-slate-500 hover:text-emerald-700 text-sm transition-colors">Contact</Link></li>
            </ul>
          </nav>

          <nav aria-label="Legal links">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Legal &amp; Safety</h3>
            <ul className="space-y-2">
              <li><Link href="/medical-disclaimer" className="text-slate-500 hover:text-emerald-700 text-sm transition-colors">Medical Disclaimer</Link></li>
              <li><Link href="/privacy" className="text-slate-500 hover:text-emerald-700 text-sm transition-colors">Privacy Policy</Link></li>
              <li><Link href="/terms" className="text-slate-500 hover:text-emerald-700 text-sm transition-colors">Terms of Use</Link></li>
            </ul>
          </nav>

          <nav aria-label="Social media links">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Follow Us</h3>
            <div className="flex gap-3">
              <a
                href="https://x.com/pillseek"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Follow PillSeek on Twitter"
                className="text-slate-400 hover:text-emerald-700 transition-colors"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="w-5 h-5"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.91-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              </a>
              <a
                href="https://www.facebook.com/people/Pill-Seek/61589335527401/"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Follow PillSeek on Facebook"
                className="text-slate-400 hover:text-emerald-700 transition-colors"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="w-5 h-5"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
              </a>
              <a
                href="https://www.youtube.com/@pillseek"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Follow PillSeek on YouTube"
                className="text-slate-400 hover:text-emerald-700 transition-colors"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="w-5 h-5"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
              </a>
              <a
                href="https://www.pinterest.com/pillseek/"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Follow PillSeek on Pinterest"
                className="text-slate-400 hover:text-emerald-700 transition-colors"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="w-5 h-5"><path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/></svg>
              </a>
            </div>
          </nav>
        </div>

        <div className="border-t border-slate-100 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-slate-400 text-xs">© {year} PillSeek. All rights reserved. Data sourced from FDA NDC &amp; DailyMed.</p>
          <p className="text-slate-400 text-xs">Not a medical device. For identification purposes only.</p>
        </div>
      </div>
    </footer>
  )
}
