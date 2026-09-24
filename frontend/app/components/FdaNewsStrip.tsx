import Link from 'next/link'
import { fdaHighlights } from '../lib/fda-news'
import { fdaNewsSwitches } from '../lib/fda-news-switches'
import { FdaNewsCard } from './FdaNews'

// literal class names so Tailwind keeps them
const COLUMNS = ['', 'md:grid-cols-1', 'md:grid-cols-2', 'md:grid-cols-3']

/**
 * Home page, under the search box: the newest FDA recall, new drug and shortage. Rendered on the server so
 * the text is in the page; each card can be switched off in Admin → Settings, and the strip hides when no
 * card is left. On phones the cards swipe sideways.
 */
export default async function FdaNewsStrip() {
  const items = await fdaHighlights(new Date(), await fdaNewsSwitches())
  if (items.length === 0) return null
  return (
    <section aria-labelledby="fda-news-heading" className="mt-7 text-left">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="fda-news-heading" className="text-xl font-bold text-slate-900">
          Latest from the FDA
        </h2>
        <Link href="/fda-news" className="text-sm font-semibold text-emerald-700 hover:text-emerald-800">
          More FDA updates →
        </Link>
      </div>
      <div className={`mt-3 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-1.5 md:grid md:overflow-visible md:pb-0 ${COLUMNS[items.length]}`}>
        {items.map((item) => (
          <FdaNewsCard key={item.href} item={item} className="w-[84%] shrink-0 snap-start md:w-auto" />
        ))}
      </div>
    </section>
  )
}
