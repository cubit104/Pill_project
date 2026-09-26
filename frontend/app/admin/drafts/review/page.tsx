'use client'

export const dynamic = 'force-dynamic'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, Flag, Loader2, Pencil, RefreshCw, Upload, Volume2 } from 'lucide-react'
import { adminApi } from '../../lib/api'
import { MISSING_OPTIONS, missingLabel } from '../../lib/reviewFlags'
import { useUserRole } from '../../lib/useUserRole'
import {
  nextIndex,
  photoCheck,
  pronunciationCheck,
  publishBlockers,
  publishWarnings,
  reviewKey,
  sourceLabel,
  suggestedFlags,
  type Check,
  type Indication,
  type PhotoRead,
  type Pronunciation,
  type QueueItem,
  type ReviewItem,
  type Tone,
} from '../../lib/draftReview'

const TONE: Record<Tone, string> = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warn: 'border-amber-200 bg-amber-50 text-amber-800',
  bad: 'border-red-200 bg-red-50 text-red-700',
  none: 'border-gray-200 bg-gray-50 text-gray-600',
}
const MARK: Record<Tone, string> = { ok: '✓', warn: '!', bad: '✗', none: '·' }

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function pillLabel(q: { medicine_name: string | null; strength?: string | null; spl_strength?: string | null }): string {
  return [q.medicine_name, q.strength ?? q.spl_strength].filter(Boolean).join(' ') || 'Unnamed pill'
}

function Badge({ check, busy }: { check: Check; busy?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm font-medium ${TONE[check.tone]}`}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span aria-hidden="true">{MARK[check.tone]}</span>}
      {check.text}
    </span>
  )
}

/** The photo, big, zooming 2.5x under the mouse so an imprint can be read off it. */
function PhotoPanel({ photos, alt }: { photos: string[]; alt: string }) {
  const [active, setActive] = useState(0)
  const [lens, setLens] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => setActive(0), [photos])
  const src = photos[active]
  if (!src) {
    return <div className="flex h-[50vh] items-center justify-center rounded-lg border border-dashed border-red-300 bg-red-50 text-red-700">No photo</div>
  }
  return (
    <div className="space-y-2">
      <div
        className="relative cursor-zoom-in overflow-hidden rounded-lg border border-gray-200 bg-gray-100"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setLens({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 })
        }}
        onMouseLeave={() => setLens(null)}
      >
        <img
          src={src}
          alt={alt}
          className="h-[50vh] w-full object-contain lg:h-[62vh]"
          style={lens ? { transform: 'scale(2.5)', transformOrigin: `${lens.x}% ${lens.y}%` } : undefined}
        />
      </div>
      <div className="flex items-center gap-3 text-xs text-gray-500">
        <span>Hover to zoom</span>
        <a href={src} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-600 hover:underline">
          Open full size <ExternalLink className="h-3 w-3" />
        </a>
        {photos.length > 1 &&
          photos.map((url, i) => (
            <button key={url} type="button" onClick={() => setActive(i)} className={`h-10 w-10 overflow-hidden rounded border ${i === active ? 'border-indigo-500' : 'border-gray-200'}`}>
              <img src={url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
            </button>
          ))}
      </div>
    </div>
  )
}

/** "What it's used for": publishing waits for it. Filled here from MedlinePlus, the FDA label, or by hand. */
function IndicationPanel({ pillId, rxcui, indication, onSaved }: { pillId: string; rxcui: string | null; indication: Indication | null; onSaved: (i: Indication) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(indication?.text ?? '')
  const [busy, setBusy] = useState<'' | 'save' | 'medlineplus' | 'label'>('')
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  useEffect(() => {
    setValue(indication?.text ?? '')
    setEditing(false)
    setError('')
  }, [pillId, indication?.text])

  const run = async (kind: 'save' | 'medlineplus' | 'label') => {
    setBusy(kind)
    setError('')
    try {
      if (kind === 'save') {
        await adminApi.saveIndication(pillId, value.trim())
        onSaved({ text: value.trim(), source: 'manual', source_url: null })
      } else if (kind === 'medlineplus') {
        const res = await adminApi.indicationFromMedlinePlus(pillId)
        onSaved(res.indication)
      } else {
        const res = await adminApi.indicationFromLabel(pillId)
        setValue(res.text)
        setEditing(true)
      }
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy('')
    }
  }

  if (!rxcui) {
    return (
      <section className={`rounded-lg border p-3 text-sm ${TONE.bad}`}>
        <h3 className="font-semibold">What it&apos;s used for</h3>
        <p>This pill has no RxCUI, so it cannot have a &quot;used for&quot; text. Fix it in the editor (E).</p>
      </section>
    )
  }
  if (indication && !editing) {
    return (
      <section className={`rounded-lg border p-3 text-sm ${TONE.ok}`}>
        <div className="mb-1 flex items-center gap-2">
          <h3 className="font-semibold">What it&apos;s used for</h3>
          <span className="text-xs opacity-80">{sourceLabel(indication.source)}</span>
          <button type="button" onClick={() => setEditing(true)} className="ml-auto text-xs font-medium text-indigo-700 hover:underline">
            Edit
          </button>
        </div>
        <p className={`text-gray-800 ${open ? '' : 'line-clamp-3'}`}>{indication.text}</p>
        {indication.text.length > 220 && (
          <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1 text-xs text-indigo-700 hover:underline">
            {open ? 'Less' : 'More'}
          </button>
        )}
      </section>
    )
  }
  return (
    <section className={`space-y-2 rounded-lg border p-3 text-sm ${indication ? TONE.none : TONE.bad}`}>
      <h3 className="font-semibold">{indication ? "Edit what it's used for" : "What it's used for is empty: fill it to publish"}</h3>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={4}
        placeholder="In plain words: what this medicine treats."
        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={!value.trim() || !!busy} onClick={() => void run('save')} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
          {busy === 'save' ? 'Saving…' : 'Save'}
        </button>
        <button type="button" disabled={!!busy} onClick={() => void run('medlineplus')} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50" title="Saves MedlinePlus's text, credited to MedlinePlus">
          {busy === 'medlineplus' ? 'Asking MedlinePlus…' : 'Use MedlinePlus text'}
        </button>
        <button type="button" disabled={!!busy} onClick={() => void run('label')} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50" title="Puts the FDA label's text in the box to edit">
          {busy === 'label' ? 'Reading the label…' : 'Start from FDA label'}
        </button>
        {indication && (
          <button type="button" onClick={() => setEditing(false)} className="text-xs text-gray-600 hover:underline">
            Cancel
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </section>
  )
}

/** "Pronounced as": confirm it once per drug, or fix it. It never blocks publishing. */
function PronunciationPanel({ pillId, p, onSaved }: { pillId: string; p: Pronunciation; onSaved: (p: Pronunciation) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(p.text ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const audio = useRef<HTMLAudioElement | null>(null)
  useEffect(() => {
    setValue(p.text ?? '')
    setEditing(false)
    setError('')
  }, [pillId, p.text])

  const save = async (said: string) => {
    setBusy(true)
    setError('')
    try {
      const res = await adminApi.reviewPronunciation(pillId, said)
      onSaved(res.pronunciation)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  const check = pronunciationCheck(p)
  const typing = editing || !p.text
  return (
    <section className="space-y-2 rounded-lg border border-gray-200 bg-white p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-gray-800">Pronounced as</h3>
        {p.text && <span className="text-lg font-semibold text-gray-900">{p.text}</span>}
        {p.audio_url && (
          <button
            type="button"
            aria-label="Play the name"
            onClick={() => {
              audio.current?.pause()
              audio.current = new Audio(p.audio_url as string)
              void audio.current.play().catch(() => undefined)
            }}
            className="rounded p-1 text-gray-500 hover:bg-gray-100"
          >
            <Volume2 className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge check={check} />
        {p.key && <span className="text-xs text-gray-500">saved under &quot;{p.key}&quot;, shared by every pill of it</span>}
      </div>
      {typing ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (value.trim()) void save(value.trim())
          }}
        >
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={200}
            placeholder="e.g. lye-SIN-oh-pril"
            className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
          <button type="submit" disabled={busy || !value.trim()} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
            {busy ? 'Saving…' : 'Save'}
          </button>
          {p.text && (
            <button type="button" onClick={() => setEditing(false)} className="text-xs text-gray-600 hover:underline">
              Cancel
            </button>
          )}
        </form>
      ) : (
        <div className="flex items-center gap-2">
          {!p.checked_by && (
            <button type="button" disabled={busy} onClick={() => void save(p.text as string)} className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50">
              {busy ? 'Saving…' : 'Looks right'}
            </button>
          )}
          <button type="button" onClick={() => setEditing(true)} className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
            Fix
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </section>
  )
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="truncate text-sm text-gray-900" title={value ?? ''}>
        {value || <span className="text-gray-400">—</span>}
      </dd>
    </div>
  )
}

function ReviewInner() {
  const params = useSearchParams()
  const { can } = useUserRole()
  const canPublish = can('approve_drafts')

  const [queue, setQueue] = useState<QueueItem[] | null>(null)
  const [queueError, setQueueError] = useState('')
  const [index, setIndex] = useState(-1)
  const [skipFlagged, setSkipFlagged] = useState(true)
  const [done, setDone] = useState<Map<string, 'published' | 'flagged'>>(() => new Map())
  const [item, setItem] = useState<ReviewItem | null>(null)
  const [itemError, setItemError] = useState('')
  const [read, setRead] = useState<PhotoRead | null>(null)
  const [reading, setReading] = useState(false)
  const [readError, setReadError] = useState('')
  const [armed, setArmed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<(Check & { pillId?: string }) | null>(null)
  const [flagOpen, setFlagOpen] = useState(false)
  const [flagSel, setFlagSel] = useState<string[]>([])
  const [flagNote, setFlagNote] = useState('')
  const [reloads, setReloads] = useState(0)

  // One request per pill and per photo read, shared by the pill on screen and the next one being fetched ahead.
  const details = useRef(new Map<string, Promise<ReviewItem>>())
  const reads = useRef(new Map<string, Promise<PhotoRead | null>>())

  const doneIds = useMemo(() => new Set(done.keys()), [done])
  const current = queue && index >= 0 ? queue[index] : null
  const currentId = current?.id ?? null
  // the loaded details are those of the pill in the counter (not the last one, still on its way out)
  const shown = item && item.pill.id === currentId ? item : null

  const loadItem = useCallback((id: string): Promise<ReviewItem> => {
    let p = details.current.get(id)
    if (!p) {
      p = adminApi.getReviewItem(id) as Promise<ReviewItem>
      details.current.set(id, p)
      p.catch(() => details.current.delete(id))
    }
    return p
  }, [])

  const readPhoto = useCallback((id: string, it: ReviewItem): Promise<PhotoRead | null> => {
    if (it.photo_read) return Promise.resolve(it.photo_read)
    if (it.photos.length === 0) return Promise.resolve(null)
    let p = reads.current.get(id)
    if (!p) {
      p = adminApi.readReviewPhoto(id) as Promise<PhotoRead>
      reads.current.set(id, p)
      p.catch(() => reads.current.delete(id))
    }
    return p
  }, [])

  useEffect(() => {
    let alive = true
    adminApi
      .getReviewQueue()
      .then((data: { items: QueueItem[] }) => {
        if (!alive) return
        setQueue(data.items)
        const wanted = params.get('id')
        const at = wanted ? data.items.findIndex((q) => q.id === wanted) : -1
        setIndex(at >= 0 ? at : nextIndex(data.items, -1, 1, true, new Set()))
      })
      .catch((e) => alive && setQueueError(message(e)))
    return () => {
      alive = false
    }
    // the starting pill is read from the URL once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // the pill on screen: its details, then its photo read (free when already read)
  useEffect(() => {
    if (!currentId) {
      setItem(null)
      return
    }
    let alive = true
    setItemError('')
    setReadError('')
    loadItem(currentId)
      .then((it) => {
        if (!alive) return
        setItem(it)
        setRead(it.photo_read)
        setReading(!it.photo_read && it.photos.length > 0)
        readPhoto(currentId, it)
          .then((r) => alive && setRead(r))
          .catch((e) => alive && setReadError(message(e)))
          .finally(() => alive && setReading(false))
      })
      .catch((e) => alive && setItemError(message(e)))
    return () => {
      alive = false
    }
  }, [currentId, reloads, loadItem, readPhoto])

  // a new pill: nothing of the last one may stay on screen (or be published by a quick P)
  useEffect(() => {
    setItem(null)
    setRead(null)
    setReading(false)
    setArmed(null)
    setFlagOpen(false)
  }, [currentId])

  // fetch (and read) the next pill while this one is looked at
  useEffect(() => {
    if (!queue || index < 0 || !item) return
    const n = nextIndex(queue, index, 1, skipFlagged, doneIds)
    if (n < 0) return
    const id = queue[n].id
    loadItem(id)
      .then((it) => readPhoto(id, it))
      .catch(() => undefined)
  }, [item, queue, index, skipFlagged, doneIds, loadItem, readPhoto])

  // back from the editor tab: show what was changed there
  useEffect(() => {
    const onFocus = () => {
      if (!currentId) return
      details.current.delete(currentId)
      setReloads((n) => n + 1)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [currentId])

  const move = (step: 1 | -1, doneNow: ReadonlySet<string> = doneIds) => {
    if (!queue) return
    let n = nextIndex(queue, index, step, skipFlagged, doneNow)
    if (n < 0 && step === 1) n = nextIndex(queue, -1, 1, skipFlagged, doneNow) // pills skipped earlier
    if (n >= 0) setIndex(n)
    else if (step === -1) setNotice({ tone: 'none', text: 'This is the first one' })
    else setIndex(-1)
  }

  const finish = (id: string, how: 'published' | 'flagged', text: string) => {
    const next = new Map(done)
    next.set(id, how)
    setDone(next)
    setNotice({ tone: how === 'published' ? 'ok' : 'warn', text })
    window.dispatchEvent(new Event('draft-count-changed'))
    move(1, new Set(next.keys()))
  }

  // "used for" and "pronounced as" belong to the drug, so pills fetched ahead may now be out of date
  const sharedChanged = (patch: Partial<ReviewItem>) => {
    if (!item || !currentId) return
    const updated = { ...item, ...patch }
    details.current.clear()
    details.current.set(currentId, Promise.resolve(updated))
    setItem(updated)
  }

  const publish = async () => {
    const item = shown
    if (!item || !current || busy) return
    if (!canPublish) {
      setNotice({ tone: 'bad', text: 'Only an editor or superuser can publish' })
      return
    }
    const blockers = publishBlockers(item)
    if (blockers.length) {
      setNotice({ tone: 'bad', text: `Cannot publish: ${blockers.join('; ')}` })
      return
    }
    const warnings = publishWarnings(item, read)
    if (warnings.length && armed !== current.id) {
      setArmed(current.id)
      setNotice({ tone: 'warn', text: `${warnings.join('; ')}. Press P again to publish anyway.`, pillId: current.id })
      return
    }
    setBusy(true)
    try {
      await adminApi.publishReviewed(current.id, item.pill.updated_at)
      finish(current.id, 'published', `Published ${pillLabel(current)}`)
    } catch (e) {
      setNotice({ tone: 'bad', text: message(e) })
    } finally {
      setBusy(false)
    }
  }

  const openFlag = () => {
    const item = shown
    if (!item) return
    setFlagSel(suggestedFlags(item, read))
    setFlagNote(item.flags?.note ?? '')
    setFlagOpen(true)
  }

  const saveFlag = async () => {
    if (!current || busy) return
    setBusy(true)
    try {
      await adminApi.setReviewFlags(current.id, flagSel, flagNote.trim() || null)
      setQueue((q) => q && q.map((x) => (x.id === current.id ? { ...x, flagged: true, missing: flagSel } : x)))
      setFlagOpen(false)
      finish(current.id, 'flagged', `Flagged ${pillLabel(current)} back to the team`)
    } catch (e) {
      setNotice({ tone: 'bad', text: message(e) })
    } finally {
      setBusy(false)
    }
  }

  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null
    if (flagOpen) {
      const typing = target?.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'checkbox'
      if (e.key === 'Escape') setFlagOpen(false)
      else if (e.key === 'Enter') {
        e.preventDefault()
        void saveFlag()
      } else if (!typing && ['1', '2', '3', '4'].includes(e.key)) {
        const key = MISSING_OPTIONS[Number(e.key) - 1].key
        setFlagSel((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]))
      }
      return
    }
    const action = reviewKey({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, target })
    if (!action) return
    e.preventDefault()
    if (action === 'publish') void publish()
    else if (action === 'flag') openFlag()
    else if (action === 'next') move(1)
    else if (action === 'prev') move(-1)
    else if (action === 'edit' && currentId) window.open(`/admin/pills/${currentId}`, '_blank', 'noopener')
  }
  const keyHandler = useRef(onKey)
  useEffect(() => {
    keyHandler.current = onKey
  })
  useEffect(() => {
    const listener = (e: KeyboardEvent) => keyHandler.current(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  const left = queue ? queue.filter((q) => !done.has(q.id)).length : 0
  const published = [...done.values()].filter((d) => d === 'published').length
  const flagged = done.size - published

  if (queueError) return <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{queueError}</div>
  if (!queue) return <div className="p-4 text-gray-500">Loading the drafts…</div>

  const pill = shown?.pill
  const photo = shown ? photoCheck(read, shown.pill.splimprint) : null
  const blockers = shown ? publishBlockers(shown) : []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/drafts" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="h-4 w-4" /> Drafts
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Review drafts</h1>
        <span className="text-sm text-gray-600">
          {current ? `${index + 1} of ${queue.length}` : `${queue.length} drafts`} · {left} left
          {done.size > 0 && ` · ${published} published, ${flagged} flagged`}
        </span>
        <label className="ml-auto flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={skipFlagged} onChange={(e) => setSkipFlagged(e.target.checked)} />
          Skip pills flagged back to the team
        </label>
      </div>
      <p className="text-xs text-gray-500">
        Keys: <kbd className="rounded border px-1">P</kbd> publish and next · <kbd className="rounded border px-1">F</kbd> flag and next ·{' '}
        <kbd className="rounded border px-1">→</kbd> skip · <kbd className="rounded border px-1">←</kbd> back · <kbd className="rounded border px-1">E</kbd> open in the editor
      </p>

      {notice && (!notice.pillId || notice.pillId === currentId) && (
        <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${TONE[notice.tone]}`} role="status">
          <span className="flex-1">{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-xs opacity-70 hover:opacity-100">
            Dismiss
          </button>
        </div>
      )}

      {!current && (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <p className="text-lg font-semibold text-gray-900">Nothing left to review</p>
          <p className="mt-1 text-sm text-gray-600">
            {done.size > 0 ? `${published} published and ${flagged} flagged this time.` : 'Every draft is flagged back to the team, or there are none.'}
            {skipFlagged && queue.some((q) => q.flagged && !done.has(q.id)) && ' Untick "Skip pills flagged back to the team" to see the flagged ones.'}
          </p>
        </div>
      )}

      {current && itemError && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          {itemError}{' '}
          <button type="button" className="underline" onClick={() => setReloads((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}

      {current && !shown && !itemError && <div className="p-4 text-gray-500">Loading {pillLabel(current)}…</div>}

      {shown && pill && current && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <PhotoPanel photos={shown.photos} alt={`${pillLabel(pill)}, imprint ${pill.splimprint ?? ''}`} />

          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-bold text-gray-900">{pillLabel(pill)}</h2>
              {pill.brand_names && <p className="text-sm text-gray-600">Brand: {pill.brand_names}</p>}
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Imprint typed for this pill</div>
              <div className="font-mono text-3xl font-bold tracking-wider text-gray-900">{pill.splimprint || '—'}</div>
              <div className="mt-1 text-sm text-gray-600">
                {[pill.splcolor_text, pill.splshape_text, pill.splsize && `${pill.splsize} mm`].filter(Boolean).join(' · ')}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {photo && <Badge check={reading && !read ? { tone: 'none', text: 'Reading the photo…' } : photo} busy={reading && !read} />}
                {readError && (
                  <span className="text-xs text-red-700">
                    {readError}{' '}
                    <button type="button" className="underline" onClick={() => setReloads((n) => n + 1)}>
                      Retry
                    </button>
                  </span>
                )}
              </div>
            </div>

            {shown.flags && (
              <div className={`rounded-lg border p-3 text-sm ${TONE.warn}`}>
                Flagged by {shown.flags.flagged_by ?? 'someone'}:{' '}
                {shown.flags.missing.length ? shown.flags.missing.map(missingLabel).join(', ') : 'opened, not published'}
                {shown.flags.note && ` — ${shown.flags.note}`}
              </div>
            )}

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-gray-200 bg-white p-3 sm:grid-cols-3">
              <Fact label="Strength" value={pill.spl_strength} />
              <Fact label="Form" value={pill.dosage_form} />
              <Fact label="Rx / OTC" value={pill.status_rx_otc} />
              <Fact label="NDC" value={pill.ndc11 || pill.ndc9} />
              <Fact label="Maker" value={pill.author} />
              <Fact label="DEA schedule" value={pill.dea_schedule_name} />
            </dl>

            <IndicationPanel pillId={pill.id} rxcui={pill.rxcui} indication={shown.indication} onSaved={(indication) => sharedChanged({ indication })} />
            <PronunciationPanel pillId={pill.id} p={shown.pronunciation} onSaved={(pronunciation) => sharedChanged({ pronunciation })} />

            {shown.warnings.length > 0 && (
              <details className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-700">
                <summary className="cursor-pointer">{shown.warnings.length} field(s) the editor would warn about</summary>
                <ul className="mt-2 list-disc pl-5 text-xs">
                  {shown.warnings.map((w) => (
                    <li key={w.field}>{w.message}</li>
                  ))}
                </ul>
              </details>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 pt-3">
              <button
                type="button"
                onClick={() => void publish()}
                disabled={busy || blockers.length > 0 || !canPublish}
                title={blockers.join('; ') || (!canPublish ? 'Only an editor or superuser can publish' : undefined)}
                className={`inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${armed === current.id ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
              >
                <Upload className="h-4 w-4" /> {armed === current.id ? 'Publish anyway (P)' : 'Publish (P)'}
              </button>
              <button type="button" onClick={openFlag} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50">
                <Flag className="h-4 w-4" /> Flag (F)
              </button>
              <button type="button" onClick={() => move(-1)} className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                <ChevronLeft className="h-4 w-4" /> Back
              </button>
              <button type="button" onClick={() => move(1)} className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                Skip <ChevronRight className="h-4 w-4" />
              </button>
              <a href={`/admin/pills/${pill.id}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm text-indigo-700 hover:underline">
                <Pencil className="h-4 w-4" /> Editor (E)
              </a>
              <button type="button" onClick={() => { details.current.delete(pill.id); setReloads((n) => n + 1) }} className="inline-flex items-center gap-1 rounded-md px-2 py-2 text-sm text-gray-500 hover:text-gray-700" title="Reload this pill">
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
            {blockers.length > 0 && <p className="text-xs text-red-700">Cannot publish yet: {blockers.join('; ')}</p>}
          </div>
        </div>
      )}

      {flagOpen && current && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Flag back to the team">
          <div className="w-full max-w-md space-y-4 rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-lg font-bold text-gray-900">What does the team need to fix?</h2>
            <p className="text-sm text-gray-500">
              {pillLabel(current)} turns amber in the Drafts list with these tags. Keys 1 to 4 tick, Enter saves, Esc cancels.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {MISSING_OPTIONS.map((o, i) => (
                <label key={o.key} className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${flagSel.includes(o.key) ? 'border-amber-400 bg-amber-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                  <input
                    type="checkbox"
                    checked={flagSel.includes(o.key)}
                    onChange={(e) => setFlagSel((s) => (e.target.checked ? [...s, o.key] : s.filter((k) => k !== o.key)))}
                  />
                  <span className="text-xs text-gray-400">{i + 1}</span> {o.label}
                </label>
              ))}
            </div>
            <input
              value={flagNote}
              onChange={(e) => setFlagNote(e.target.value)}
              maxLength={200}
              placeholder="Note for the team (optional)"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setFlagOpen(false)} className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900">
                Cancel
              </button>
              <button type="button" onClick={() => void saveFlag()} disabled={busy} className="rounded-md bg-amber-600 px-4 py-2 text-sm text-white hover:bg-amber-700 disabled:opacity-50">
                {busy ? 'Saving…' : 'Flag and next'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function DraftReviewPage() {
  return (
    <Suspense fallback={<div className="p-4 text-gray-500">Loading…</div>}>
      <ReviewInner />
    </Suspense>
  )
}
