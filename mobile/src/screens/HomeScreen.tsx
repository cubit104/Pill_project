import { useEffect, useRef, useState, type ComponentType } from 'react'
import { useNavigate } from 'react-router-dom'
import Disclaimer from '../components/Disclaimer'
import { ChevronRightIcon, SearchIcon } from '../components/Icons'
import { PillThumb } from '../components/PillRow'
import {
  AboutTile,
  CameraTile,
  DosageTile,
  DrugNameTile,
  ImprintTile,
  InteractionsTile,
  MedGuideTile,
  NdcTile,
  PriceTile,
  ProInfoTile,
  CabinetTile,
  SideEffectsTile,
  type TileIconProps,
} from '../components/TileIcons'
import { goalSearchPath } from '../lib/goals'
import { useT } from '../lib/i18n'
import { hapticTick } from '../lib/native'
import { loadRecent, type RecentItem } from '../lib/storage'

interface Tile {
  label: string
  Icon: ComponentType<TileIconProps>
  /** In-app route, or a function for anything else (in-app browser). */
  go: string | (() => void)
  /** Opens in the in-app browser rather than a native screen. */
  external?: boolean
}

const TILES: Tile[] = [
  { label: 'Photo ID', Icon: CameraTile, go: '/identify' },
  { label: 'Imprint search', Icon: ImprintTile, go: '/search?type=imprint' },
  { label: 'Drug name', Icon: DrugNameTile, go: '/search?type=drug' },
  { label: 'NDC lookup', Icon: NdcTile, go: '/search?type=ndc' },
  { label: 'Side effects', Icon: SideEffectsTile, go: goalSearchPath('adverse-reactions') },
  { label: 'Dosage', Icon: DosageTile, go: goalSearchPath('dosage') },
  { label: 'Medication guide', Icon: MedGuideTile, go: goalSearchPath('medication-guide') },
  { label: 'Professional info', Icon: ProInfoTile, go: goalSearchPath('professional-information') },
  { label: 'Price guide', Icon: PriceTile, go: goalSearchPath('price') },
  { label: 'Interactions', Icon: InteractionsTile, go: '/interactions' },
  { label: 'My cabinet', Icon: CabinetTile, go: '/cabinet' },
  { label: 'About', Icon: AboutTile, go: '/about' },
]

interface RecentPill {
  id: string
  slug: string
  name: string
  image: string | null
}

/** Recent items that resolved to a pill, newest first, one card per pill. */
function recentPills(items: RecentItem[]): RecentPill[] {
  const seen = new Set<string>()
  const out: RecentPill[] = []
  for (const it of items) {
    if (!it.topSlug || !it.topName || seen.has(it.topSlug)) continue
    seen.add(it.topSlug)
    out.push({ id: it.id, slug: it.topSlug, name: it.topName, image: it.kind === 'search' ? it.topImage : it.thumb })
    if (out.length === 10) break
  }
  return out
}

/** Drugs.com-style launcher: logo, a search entry point, a grid of every feature, and recent pills. */
export default function HomeScreen({ active = true }: { active?: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const t = useT()
  const [recent, setRecent] = useState<RecentPill[]>([])

  // Refresh the strip each time Home comes back on screen.
  useEffect(() => {
    if (!active) return
    let cancelled = false
    void loadRecent().then((items) => !cancelled && setRecent(recentPills(items)))
    return () => {
      cancelled = true
    }
  }, [active])

  const go = (to: string | (() => void)) => {
    void hapticTick()
    if (typeof to === 'string') navigate(to)
    else to()
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto">
      <header
        className="mx-auto flex max-w-lg flex-col items-center px-4 pb-1"
        style={{ paddingTop: 'calc(var(--safe-top) + 14px)', paddingLeft: 'max(16px, var(--safe-left))', paddingRight: 'max(16px, var(--safe-right))' }}
      >
        <div className="flex items-center gap-2.5">
          <img src="/logo-mark.svg" alt="" width={40} height={40} className="h-10 w-10" />
          <div className="leading-none">
            <p className="text-[26px] font-extrabold tracking-tight">
              <span className="text-ink">Pill</span>
              <span className="text-brand">Seek</span>
            </p>
            <p className="mt-1 text-[12px] font-medium tracking-wide text-muted">{t('Identify. Understand. Be sure.')}</p>
          </div>
        </div>
      </header>

      <main
        className="screen mx-auto max-w-lg space-y-5 px-4 pt-4"
        style={{ paddingLeft: 'max(16px, var(--safe-left))', paddingRight: 'max(16px, var(--safe-right))' }}
      >
        {/* Search entry point: looks like a field, acts like a button */}
        <button
          type="button"
          onClick={() => go('/search')}
          className="pressable flex h-12 w-full items-center gap-3 rounded-2xl border border-line bg-surface px-4 text-left text-[17px] text-muted active:border-brand"
        >
          <SearchIcon size={22} className="flex-none" />
          <span className="truncate">{t('Search by imprint, name or NDC')}</span>
        </button>

        <ul className="grid grid-cols-3 gap-x-2 gap-y-3" aria-label={t('Features')}>
          {TILES.map((tile) => (
            <li key={tile.label}>
              <button
                type="button"
                onClick={() => go(tile.go)}
                className="pressable flex w-full flex-col items-center gap-1.5 rounded-2xl px-1 py-3 text-center active:bg-brand-tint"
              >
                <span className="tile-icon flex h-[64px] w-[64px] items-center justify-center">
                  <tile.Icon size={58} />
                </span>
                <span className="text-[14px] font-medium leading-tight text-ink">
                  {t(tile.label)}
                  {tile.external && <span className="sr-only"> {t('(opens pillseek.com)')}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {recent.length > 0 && (
          <section>
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="section-label">{t('Recently viewed')}</p>
              <button type="button" onClick={() => go('/recent')} className="pressable inline-flex min-h-[32px] items-center gap-0.5 text-[14px] font-semibold text-brand">
                {t('See all')} <ChevronRightIcon size={16} />
              </button>
            </div>
            <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
              {recent.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => go(`/pill/${encodeURIComponent(r.slug)}`)}
                  className="pressable card w-32 flex-none p-3 text-left active:bg-brand-tint"
                >
                  <PillThumb src={r.image} alt="" size={48} />
                  <p className="mt-2 truncate text-[14px] font-semibold text-ink">{r.name}</p>
                </button>
              ))}
            </div>
          </section>
        )}

        <Disclaimer compact />
      </main>
    </div>
  )
}
