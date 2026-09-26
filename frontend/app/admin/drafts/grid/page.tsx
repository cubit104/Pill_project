'use client'

export const dynamic = 'force-dynamic'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ChevronLeft, ChevronRight, ListChecks, RefreshCw, Upload } from 'lucide-react'
import { adminApi } from '../../lib/api'
import ZoomImage from '../../components/ZoomImage'
import { useUserRole } from '../../lib/useUserRole'
import {
  isReady,
  pronunciationCheck,
  READY_SCORE,
  scoreCheck,
  tickBlocker,
  type Card,
  type QueueItem,
  type Tone,
} from '../../lib/draftReview'

const PAGE_SIZE = 24
// Pills published side by side; each is its own "Save & publish", so a failure stops only that one.
const PUBLISH_AT_ONCE = 3

type Filter = 'ready' | 'rest' | 'all'

const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-emerald-700',
  warn: 'text-amber-700',
  bad: 'text-red-700',
  none: 'text-gray-500',
}
const MARK: Record<Tone, string> = { ok: '✓', warn: '!', bad: '✗', none: '·' }

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function PillCard({
  item,
  card,
  picked,
  outcome,
  onToggle,
}: {
  item: QueueItem
  card: Card | undefined
  picked: boolean
  outcome: string | undefined
  onToggle: () => void
}) {
  const label = [item.medicine_name, item.strength].filter(Boolean).join(' ') || 'Unnamed pill'
  const blocker = card ? tickBlocker(card) : 'Loading…'
  const score = scoreCheck(item.score)
  const said = card ? pronunciationCheck(card.pronunciation) : null
  const published = outcome === 'published'
  return (
    <div className={`flex flex-col rounded-lg border bg-white p-2 ${picked ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-gray-200'}`}>
      {card?.photo ? (
        <ZoomImage src={card.photo} alt={`${label}, imprint ${item.imprint ?? ''}`} className="h-40" />
      ) : (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-red-300 bg-red-50 text-sm text-red-700">
          {card ? 'No photo' : ''}
        </div>
      )}
      <div className="mt-2 font-mono text-lg font-bold tracking-wider text-gray-900">{item.imprint || '—'}</div>
      <div className="text-xs text-gray-600">{card ? [card.color, card.shape].filter(Boolean).join(' · ') : ' '}</div>
      <div className="mt-1 truncate text-sm font-medium text-gray-900" title={label}>
        {label}
      </div>
      <div className="mt-1 space-y-0.5 text-xs">
        <div className="flex gap-3">
          <span className={TONE_TEXT[score.tone]}>Score {score.text}</span>
          <span className={item.used_for ? TONE_TEXT.ok : TONE_TEXT.bad}>{item.used_for ? '✓' : '✗'} Used for</span>
        </div>
        {said && card && (
          <div className={`truncate ${TONE_TEXT[said.tone]}`} title={said.text}>
            {MARK[said.tone]} {card.pronunciation.text ?? 'No pronunciation'}
          </div>
        )}
      </div>
      {outcome && !published && <p className="mt-1 text-xs text-red-700">{outcome}</p>}
      <div className="mt-auto flex items-center justify-between pt-2">
        {published ? (
          <span className="text-sm font-semibold text-emerald-700">✓ Published</span>
        ) : (
          <label className={`flex items-center gap-2 text-sm ${blocker ? 'text-gray-400' : 'cursor-pointer text-gray-800'}`} title={blocker ?? undefined}>
            <input type="checkbox" checked={picked} disabled={!!blocker} onChange={onToggle} />
            Publish
          </label>
        )}
        <Link href={`/admin/drafts/review?id=${item.id}`} target="_blank" className="text-xs text-indigo-700 hover:underline">
          Open
        </Link>
      </div>
    </div>
  )
}

export default function DraftGridPage() {
  const { can } = useUserRole()
  const canPublish = can('approve_drafts')

  const [queue, setQueue] = useState<QueueItem[] | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('ready')
  const [page, setPage] = useState(0)
  const [cards, setCards] = useState<Map<string, Card>>(() => new Map())
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  // what happened to each pill this visit: "published", or why it was not
  const [outcomes, setOutcomes] = useState<Map<string, string>>(() => new Map())
  // published pills leave the list once a publishing run is over, and the page fills up again
  const [gone, setGone] = useState<Set<string>>(() => new Set())
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [reloads, setReloads] = useState(0)

  useEffect(() => {
    let alive = true
    adminApi
      .getReviewQueue()
      .then((data: { items: QueueItem[] }) => {
        if (!alive) return
        setQueue(data.items)
        setCards(new Map())
      })
      .catch((e) => alive && setError(message(e)))
    return () => {
      alive = false
    }
  }, [reloads])

  const lists = useMemo(() => {
    const left = (queue ?? []).filter((q) => !gone.has(q.id))
    const ready = left.filter(isReady)
    return { ready, rest: left.filter((q) => !isReady(q)), all: left }
  }, [queue, gone])
  const shown = lists[filter]
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE))
  const at = Math.min(page, pages - 1)
  const pageItems = shown.slice(at * PAGE_SIZE, at * PAGE_SIZE + PAGE_SIZE)
  const pageKey = pageItems.map((q) => q.id).join(',')

  // the cards of the page on screen, fetched once each
  useEffect(() => {
    const wanted = pageKey ? pageKey.split(',').filter((id) => !cards.has(id)) : []
    if (!wanted.length) return
    let alive = true
    adminApi
      .getReviewCards(wanted)
      .then((data: { cards: Card[] }) => {
        if (!alive) return
        setCards((known) => {
          const next = new Map(known)
          data.cards.forEach((c) => next.set(c.id, c))
          return next
        })
      })
      .catch((e) => alive && setError(message(e)))
    return () => {
      alive = false
    }
    // a card already fetched is not fetched again (a reload of the queue starts afresh)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey, queue])

  const tickable = (id: string) => {
    const card = cards.get(id)
    return !!card && !tickBlocker(card) && outcomes.get(id) !== 'published'
  }
  const toggle = (id: string) =>
    setPicked((known) => {
      const next = new Set(known)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const pickReadyOnPage = () =>
    setPicked((known) => {
      const next = new Set(known)
      pageItems.forEach((q) => {
        if (isReady(q) && tickable(q.id)) next.add(q.id)
      })
      return next
    })

  const publishPicked = async () => {
    const ids = [...picked].filter(tickable)
    if (!ids.length || progress) return
    setError('')
    setProgress({ done: 0, total: ids.length })
    const published: string[] = []
    let next = 0
    const worker = async () => {
      while (next < ids.length) {
        const id = ids[next++]
        let outcome = 'published'
        try {
          await adminApi.publishReviewed(id, cards.get(id)?.updated_at ?? null)
          published.push(id)
        } catch (e) {
          outcome = message(e)
        }
        setOutcomes((known) => new Map(known).set(id, outcome))
        setProgress((p) => p && { ...p, done: p.done + 1 })
      }
    }
    await Promise.all(Array.from({ length: Math.min(PUBLISH_AT_ONCE, ids.length) }, worker))
    setPicked(new Set())
    setGone((known) => new Set([...known, ...published]))
    setProgress(null)
    window.dispatchEvent(new Event('draft-count-changed'))
  }

  const publishedCount = [...outcomes.values()].filter((o) => o === 'published').length
  const failedCount = outcomes.size - publishedCount
  const pickedCount = [...picked].filter(tickable).length

  if (error && !queue) return <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
  if (!queue) return <div className="p-4 text-gray-500">Loading the drafts…</div>

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'ready', label: `Ready (${lists.ready.length})` },
    { key: 'rest', label: `Needs work (${lists.rest.length})` },
    { key: 'all', label: `All (${lists.all.length})` },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/drafts" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="h-4 w-4" /> Drafts
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Drafts grid</h1>
        <Link href="/admin/drafts/review" className="inline-flex items-center gap-1 text-sm text-indigo-700 hover:underline">
          <ListChecks className="h-4 w-4" /> One by one
        </Link>
        <button type="button" onClick={() => setReloads((n) => n + 1)} className="ml-auto inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700" title="Load new drafts">
          <RefreshCw className="h-4 w-4" /> Reload
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => {
              setFilter(f.key)
              setPage(0)
            }}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${filter === f.key ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            {f.label}
          </button>
        ))}
        <span className="text-xs text-gray-500">Ready: editor score {READY_SCORE}%+, &quot;used for&quot; filled, not flagged. Hover a photo to zoom.</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3">
        <button type="button" onClick={pickReadyOnPage} disabled={!!progress} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          Tick the ready ones on this page
        </button>
        <button type="button" onClick={() => setPicked(new Set())} disabled={!!progress || picked.size === 0} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50">
          Clear
        </button>
        <button
          type="button"
          onClick={() => void publishPicked()}
          disabled={!canPublish || pickedCount === 0 || !!progress}
          title={canPublish ? undefined : 'Only an editor or superuser can publish'}
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          <Upload className="h-4 w-4" />
          {progress ? `Publishing ${progress.done} of ${progress.total}…` : `Publish ticked (${pickedCount})`}
        </button>
        {outcomes.size > 0 && (
          <span className="text-sm text-gray-600">
            {publishedCount} published{failedCount > 0 && <span className="text-red-700">, {failedCount} not (see the red lines)</span>}
          </span>
        )}
      </div>

      {error && <div className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {shown.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-600">Nothing here.</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {pageItems.map((q) => (
            <PillCard key={q.id} item={q} card={cards.get(q.id)} picked={picked.has(q.id)} outcome={outcomes.get(q.id)} onToggle={() => toggle(q.id)} />
          ))}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 text-sm">
        <button type="button" onClick={() => setPage(Math.max(0, at - 1))} disabled={at === 0} className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-50 disabled:opacity-40">
          <ChevronLeft className="h-4 w-4" /> Previous
        </button>
        <span className="text-gray-700">
          Page {at + 1} of {pages}
        </span>
        <button type="button" onClick={() => setPage(Math.min(pages - 1, at + 1))} disabled={at >= pages - 1} className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-50 disabled:opacity-40">
          Next <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
