import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import Card from '../components/Card'
import EmptyState from '../components/EmptyState'
import { CameraIcon, SearchIcon, TrashIcon } from '../components/Icons'
import { PillThumb } from '../components/PillRow'
import ScreenHeader from '../components/ScreenHeader'
import Sheet from '../components/Sheet'
import { ListSkeleton } from '../components/Skeleton'
import { useToast } from '../components/Toast'
import { useLocale, useT } from '../lib/i18n'
import { hapticImpact } from '../lib/native'
import { clearRecent, loadRecent, removeRecent, type RecentItem } from '../lib/storage'

const DELETE_W = 88
const LONG_PRESS_MS = 480

type T = ReturnType<typeof useT>

function timeAgo(ts: number, t: T, locale: string): string {
  const diff = Math.max(0, Date.now() - ts)
  const m = Math.floor(diff / 60_000)
  if (m < 1) return t('Just now')
  if (m < 60) return t('{n} min ago', { n: m })
  const h = Math.floor(m / 60)
  if (h < 24) return t('{n} hr ago', { n: h })
  const d = Math.floor(h / 24)
  if (d < 7) return d === 1 ? t('1 day ago') : t('{n} days ago', { n: d })
  return new Date(ts).toLocaleDateString(locale, { month: 'short', day: 'numeric' })
}

const TYPE_LABEL = { imprint: 'Imprint', drug: 'Drug name', ndc: 'NDC' } as const

interface RowProps {
  item: RecentItem
  onOpen: (item: RecentItem) => void
  onDelete: (item: RecentItem) => void
  onLongPress: (item: RecentItem) => void
}

/** Swipe left to reveal Delete; long-press for the action sheet. */
function SwipeRow({ item, onOpen, onDelete, onLongPress }: RowProps) {
  const t = useT()
  const locale = useLocale()
  const [dx, setDx] = useState(0)
  const [open, setOpen] = useState(false)
  const start = useRef<{ x: number; y: number; t: number } | null>(null)
  const moved = useRef(false)
  const longTimer = useRef<number | null>(null)
  const dragging = useRef(false)
  const longFired = useRef(false)

  const clearLong = () => {
    if (longTimer.current) window.clearTimeout(longTimer.current)
    longTimer.current = null
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    start.current = { x: e.clientX, y: e.clientY, t: Date.now() }
    moved.current = false
    dragging.current = false
    longFired.current = false
    clearLong()
    longTimer.current = window.setTimeout(() => {
      if (!moved.current) {
        longFired.current = true // the pointer-up that follows must not also open the row
        void hapticImpact('medium')
        onLongPress(item)
      }
    }, LONG_PRESS_MS)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current) return
    const ddx = e.clientX - start.current.x
    const ddy = e.clientY - start.current.y
    if (!dragging.current) {
      if (Math.abs(ddx) > 8 && Math.abs(ddx) > Math.abs(ddy)) {
        dragging.current = true
        moved.current = true
        clearLong()
        e.currentTarget.setPointerCapture(e.pointerId)
      } else if (Math.abs(ddy) > 8) {
        moved.current = true
        clearLong()
        return
      } else return
    }
    const base = open ? -DELETE_W : 0
    setDx(Math.max(-DELETE_W - 20, Math.min(0, base + ddx)))
  }

  const onPointerUp = () => {
    clearLong()
    if (!start.current) return
    const wasDragging = dragging.current
    const wasMoved = moved.current
    start.current = null
    if (longFired.current) {
      longFired.current = false
      return
    }
    if (wasDragging) {
      const shouldOpen = dx < -DELETE_W / 2
      setOpen(shouldOpen)
      setDx(shouldOpen ? -DELETE_W : 0)
      return
    }
    if (!wasMoved) {
      if (open) {
        setOpen(false)
        setDx(0)
      } else onOpen(item)
    }
  }

  const isPhoto = item.kind === 'photo'
  const title = isPhoto
    ? item.topName ?? (item.imprintRead ? t('Read “{imprint}”', { imprint: item.imprintRead }) : t('No match found'))
    : item.query || [item.color, item.shape].filter(Boolean).join(' · ') || t('Filtered search')
  const subtitle = isPhoto
    ? item.topScore !== null
      ? `${t('{pct}% match', { pct: Math.round(item.topScore * 100) })} · ${item.matchCount === 1 ? t('1 candidate') : t('{n} candidates', { n: item.matchCount })}`
      : t('Photo identification')
    : `${t('{type} search', { type: t(TYPE_LABEL[item.type]) })}${item.color || item.shape ? ` · ${[item.color, item.shape].filter(Boolean).join(', ')}` : ''} · ${
        item.total === 1 ? t('1 result') : t('{n} results', { n: item.total.toLocaleString(locale) })
      }`
  const thumb = isPhoto ? item.thumb : item.topImage

  return (
    <div className="relative overflow-hidden bg-surface">
      <button
        type="button"
        aria-label={t('Delete {title}', { title })}
        tabIndex={open ? 0 : -1}
        onClick={() => onDelete(item)}
        className="absolute inset-y-0 right-0 flex items-center justify-center bg-danger text-white"
        style={{ width: DELETE_W }}
      >
        <span className="flex flex-col items-center gap-1 text-[12px] font-semibold">
          <TrashIcon size={22} /> {t('Delete')}
        </span>
      </button>
      <div
        role="button"
        tabIndex={0}
        aria-label={t('{title}, {subtitle}. Open', { title, subtitle })}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen(item)
          }
          if (e.key === 'Delete' || e.key === 'Backspace') onDelete(item)
        }}
        className="relative flex select-none items-center gap-3 bg-surface px-4 py-3 active:bg-brand-tint"
        style={{
          transform: `translateX(${dx}px)`,
          transition: dragging.current ? 'none' : 'transform 220ms ease-out',
          touchAction: 'pan-y',
        }}
      >
        <div className="relative flex-none">
          <PillThumb src={thumb} alt="" size={56} />
          <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-surface bg-brand text-brand-fg">
            {isPhoto ? <CameraIcon size={13} strokeWidth={2.4} /> : <SearchIcon size={13} strokeWidth={2.4} />}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-semibold text-ink">{title}</p>
          <p className="mt-0.5 truncate text-[14px] text-muted">{subtitle}</p>
        </div>
        <span className="tabular flex-none text-[13px] text-muted">{timeAgo(item.at, t, locale)}</span>
      </div>
    </div>
  )
}

export default function RecentScreen({ active = true }: { active?: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const toast = useToast()
  const t = useT()
  const [items, setItems] = useState<RecentItem[] | null>(null)
  const [selected, setSelected] = useState<RecentItem | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)

  // Reload whenever the tab is shown (the screen stays mounted between tabs).
  useEffect(() => {
    if (!active) return
    let cancelled = false
    loadRecent().then((list) => {
      if (!cancelled) setItems(list)
    })
    return () => {
      cancelled = true
    }
  }, [active])

  const rerunSearch = useCallback(
    (item: Extract<RecentItem, { kind: 'search' }>) => {
      const p = new URLSearchParams()
      if (item.query) p.set('q', item.query)
      p.set('type', item.type)
      if (item.color) p.set('color', item.color)
      if (item.shape) p.set('shape', item.shape)
      navigate(`/search?${p.toString()}`)
    },
    [navigate],
  )

  const open = useCallback(
    (item: RecentItem) => {
      // A search entry re-runs the search (the pill page is one tap away there);
      // a photo entry opens its top match.
      if (item.kind === 'search') {
        rerunSearch(item)
        return
      }
      if (item.topSlug) navigate(`/pill/${encodeURIComponent(item.topSlug)}`)
      else navigate('/identify')
    },
    [navigate, rerunSearch],
  )

  const remove = useCallback(
    async (item: RecentItem) => {
      setSelected(null)
      setItems(await removeRecent(item.id))
      toast.show(t('Removed'))
    },
    [toast, t],
  )

  const clearAll = async () => {
    await clearRecent()
    setItems([])
    setConfirmClear(false)
    toast.show(t('History cleared'))
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto">
      <ScreenHeader
        title={t('Recent')}
        subtitle={t('Your last 20 identifications and searches')}
        scrollRef={scrollRef}
        onBack={() => (window.history.length > 1 ? navigate(-1) : navigate('/cabinet', { replace: true }))}
        trailing={
          items && items.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => setConfirmClear(true)}>
              {t('Clear all')}
            </Button>
          ) : null
        }
      />
      <main className="screen mx-auto max-w-lg px-4 pt-2" style={{ paddingLeft: 'max(16px, var(--safe-left))', paddingRight: 'max(16px, var(--safe-right))' }}>
        {items === null ? (
          <ListSkeleton rows={4} />
        ) : items.length === 0 ? (
          <Card padded={false}>
            <EmptyState
              art="clock"
              title={t('Nothing here yet')}
              body={t('Pills you identify or search for will show up here, stored only on this device.')}
              action={<Button onClick={() => navigate('/identify')}>{t('Identify a pill')}</Button>}
            />
          </Card>
        ) : (
          <>
            <div className="card divide-y divide-line overflow-hidden">
              {items.map((item) => (
                <SwipeRow key={item.id} item={item} onOpen={open} onDelete={(i) => void remove(i)} onLongPress={setSelected} />
              ))}
            </div>
            <p className="mt-3 px-1 text-center text-[13px] text-muted">{t('Swipe left or press and hold an item to delete it.')}</p>
          </>
        )}
      </main>

      <Sheet open={selected !== null} onClose={() => setSelected(null)} title={selected?.kind === 'photo' ? t('Identification') : t('Search')}>
        {selected && (
          <div className="space-y-2">
            {selected.kind === 'search' && (
              <Button full variant="secondary" onClick={() => { rerunSearch(selected); setSelected(null) }}>
                {t('Run search again')}
              </Button>
            )}
            {selected.topSlug ? (
              <Button full variant="secondary" onClick={() => { navigate(`/pill/${encodeURIComponent(selected.topSlug as string)}`); setSelected(null) }}>
                {t('Open {name}', { name: selected.topName ?? t('pill page') })}
              </Button>
            ) : selected.kind === 'photo' ? (
              <Button full variant="secondary" onClick={() => { open(selected); setSelected(null) }}>
                {t('Identify again')}
              </Button>
            ) : null}
            <Button full variant="danger" icon={<TrashIcon size={20} />} onClick={() => void remove(selected)}>
              {t('Delete')}
            </Button>
          </div>
        )}
      </Sheet>

      <Sheet open={confirmClear} onClose={() => setConfirmClear(false)} title={t('Clear history?')}>
        <p className="text-[15px] text-muted">{t('This removes all recent identifications and searches from this device.')}</p>
        <div className="mt-4 space-y-2">
          <Button full variant="danger" className="hairline" icon={<TrashIcon size={20} />} onClick={() => void clearAll()}>
            {t('Clear all')}
          </Button>
          <Button full variant="secondary" onClick={() => setConfirmClear(false)}>
            {t('Keep')}
          </Button>
        </div>
      </Sheet>
    </div>
  )
}
