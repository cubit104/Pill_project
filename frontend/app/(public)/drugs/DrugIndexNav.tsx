import Link from 'next/link'
import { INDEX_LETTERS } from '../../lib/iv'

/** The A to Z bar shared by /drugs and /drugs/<letter>. Letters with no drugs are shown but not linked. */
export default function DrugIndexNav({ letters, active }: { letters: Record<string, number>; active?: string }) {
  return (
    <nav aria-label="Drugs by first letter" className="no-print flex flex-wrap gap-1.5">
      {INDEX_LETTERS.map((letter) => {
        const label = letter.toUpperCase()
        const base = 'min-w-9 rounded-lg border px-2.5 py-1.5 text-center text-sm font-semibold'
        if (letter === active) {
          return (
            <span key={letter} aria-current="page" className={`${base} border-emerald-600 bg-emerald-600 text-white`}>
              {label}
            </span>
          )
        }
        if (!letters[letter]) {
          return (
            <span key={letter} className={`${base} border-slate-100 bg-slate-50 text-slate-300`}>
              {label}
            </span>
          )
        }
        return (
          <Link
            key={letter}
            href={`/drugs/${letter}`}
            className={`${base} border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800`}
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
