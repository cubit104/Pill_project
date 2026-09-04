'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import type { FiltersResponse } from '../../types'

// ---- Types -----------------------------------------------------------------

interface TextCandidate {
  slug: string
  medicine_name: string
  splimprint: string
  color: string
  shape: string
  strength: string
  score: number
  matched_tokens: string[]
  match_quality: 'exact' | 'strong' | 'partial'
  image_urls: string[]
}

interface TextResponse {
  candidates: TextCandidate[]
  query_tokens: string[]
  disclaimer: string
}

interface PhotoMatch {
  slug: string
  similarity: number
  medicine_name: string
  splimprint: string
  strength: string
  image_urls: string[]
  source?: 'imprint' | 'visual'
}

interface PhotoResponse {
  matches: PhotoMatch[]
  imprint_read?: string
  attrs_guess?: { shape?: string; color?: string }
  capture_id?: string | null
  disclaimer: string
}

type SideKey = 'front' | 'back'

const QUALITY_STYLES: Record<TextCandidate['match_quality'], string> = {
  exact: 'bg-emerald-100 text-emerald-800',
  strong: 'bg-amber-100 text-amber-800',
  partial: 'bg-slate-100 text-slate-600',
}

// Typical identification time on the current server; used only for the progress hint.
const EXPECTED_SECONDS = 20

// Backend address for photo uploads. Multipart bodies bypass the Next.js
// rewrite proxy (large-body issues, Vercel size limits). In local dev the API
// runs on the same machine as the dev server, so derive it from the page host.
function apiBase(): string {
  if (process.env.NODE_ENV === 'development') {
    return `${window.location.protocol}//${window.location.hostname}:8000`
  }
  return (process.env.NEXT_PUBLIC_API_BASE_URL || '').replace(/\/$/, '')
}

// Shrink huge camera photos (and convert HEIC/PNG to JPEG) before upload:
// 1600px keeps the imprint sharp while cutting upload size ~10x.
function shrinkForUpload(file: File): Promise<File> {
  return new Promise((resolve) => {
    const img = new window.Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        URL.revokeObjectURL(url)
        return resolve(file)
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      canvas.toBlob(
        (blob) => resolve(blob ? new File([blob], 'photo.jpg', { type: 'image/jpeg' }) : file),
        'image/jpeg',
        0.92
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(file)
    }
    img.src = url
  })
}

// ---- Component -------------------------------------------------------------

export default function IdentifyClient() {
  const [filters, setFilters] = useState<FiltersResponse>({ colors: [], shapes: [] })
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [previews, setPreviews] = useState<Record<SideKey, string | null>>({ front: null, back: null })
  const [tokensText, setTokensText] = useState('')
  const [color, setColor] = useState('')
  const [shape, setShape] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Photo flow
  const [matching, setMatching] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [photoResult, setPhotoResult] = useState<PhotoResponse | null>(null)
  const [consent, setConsent] = useState(false)
  const [feedbackSent, setFeedbackSent] = useState<'up' | 'down' | null>(null)

  // Manual (typed imprint) flow
  const [searching, setSearching] = useState(false)
  const [textResult, setTextResult] = useState<TextResponse | null>(null)

  const previewsRef = useRef(previews)
  previewsRef.current = previews
  const photoFilesRef = useRef<Record<SideKey, File | null>>({ front: null, back: null })

  useEffect(() => {
    fetch('/api/features')
      .then((r) => (r.ok ? r.json() : null))
      .then((f) => setEnabled(Boolean(f?.photo_id_enabled)))
      .catch(() => setEnabled(false))
  }, [])

  useEffect(() => {
    fetch('/filters')
      .then((res) => (res.ok ? res.json() : { colors: [], shapes: [] }))
      .then(setFilters)
      .catch(() => {})
  }, [])

  // Revoke any preview URLs left on unmount.
  useEffect(
    () => () => {
      Object.values(previewsRef.current).forEach((url) => url && URL.revokeObjectURL(url))
    },
    []
  )

  // Progress ticker while a photo identification is running.
  useEffect(() => {
    if (!matching) return
    setElapsed(0)
    const id = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [matching])

  const bothSides = Boolean(previews.front && previews.back)
  const oneSide = Boolean(previews.front || previews.back) && !bothSides

  const resetPhotos = () => {
    Object.values(previewsRef.current).forEach((url) => url && URL.revokeObjectURL(url))
    setPreviews({ front: null, back: null })
    photoFilesRef.current = { front: null, back: null }
    setPhotoResult(null)
    setTokensText('')
    setError(null)
  }

  const handlePhoto = async (side: SideKey, file: File | null) => {
    if (!file) return
    setError(null)
    setPreviews((prev) => {
      if (prev[side]) URL.revokeObjectURL(prev[side] as string)
      return { ...prev, [side]: URL.createObjectURL(file) }
    })
    const files = { ...photoFilesRef.current, [side]: await shrinkForUpload(file) }
    photoFilesRef.current = files
    // Identify only once both sides are captured — imprints are often split across sides.
    if (!files.front || !files.back) {
      setPhotoResult(null)
      return
    }
    setMatching(true)
    setPhotoResult(null)
    try {
      const form = new FormData()
      form.append('photo', files.front)
      form.append('photo2', files.back)
      if (consent) form.append('consent', '1')
      setFeedbackSent(null)
      const res = await fetch(`${apiBase()}/api/identify/photo`, { method: 'POST', body: form })
      if (!res.ok) {
        const detail = await res.json().then((j) => j?.detail).catch(() => null)
        throw new Error(detail || `Server error ${res.status}`)
      }
      const data: PhotoResponse = await res.json()
      setPhotoResult(data)
      if (data.imprint_read) setTokensText(data.imprint_read)
      if (data.matches.length === 0) {
        setError('No matches found. Try a closer, sharper photo, or type the imprint below.')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      setError(`Photo identification failed: ${msg}. You can type the imprint below instead.`)
    } finally {
      setMatching(false)
    }
  }

  const [feedbackError, setFeedbackError] = useState<string | null>(null)

  const sendFeedback = async (verdict: 'up' | 'down', chosenSlug?: string) => {
    if (!photoResult?.capture_id || feedbackSent) return
    setFeedbackError(null)
    try {
      const res = await fetch(`${apiBase()}/api/identify/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capture_id: photoResult.capture_id,
          verdict,
          chosen_slug: chosenSlug ?? null,
          corrected_imprint: tokensText !== (photoResult.imprint_read ?? '') ? tokensText.slice(0, 80) : null,
        }),
      })
      if (!res.ok) throw new Error(`Feedback not saved (${res.status})`)
      setFeedbackSent(verdict)
    } catch {
      setFeedbackError("Couldn't save your feedback — tap again to retry.")
    }
  }

  const handleIdentify = async () => {
    const imprint_tokens = tokensText
      .split(/[\s,;]+/)
      .map((t) => t.trim())
      .filter(Boolean)
    if (imprint_tokens.length === 0 && !color && !shape) {
      setError('Type the imprint, or pick a color/shape first.')
      return
    }
    setSearching(true)
    setError(null)
    setTextResult(null)
    try {
      const res = await fetch('/api/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imprint_tokens, color: color || null, shape: shape || null }),
      })
      if (!res.ok) throw new Error(`Request failed (${res.status})`)
      const data: TextResponse = await res.json()
      setTextResult(data)
      if (data.candidates.length === 0) {
        setError('No matches found. Try fewer imprint characters, or check the color and shape.')
      }
    } catch {
      setError('Something went wrong searching. Please try again.')
    } finally {
      setSearching(false)
    }
  }

  const progressPct = Math.min(95, Math.round((elapsed / EXPECTED_SECONDS) * 100))

  if (enabled === null) {
    return <p className="text-slate-500">Loading…</p>
  }
  if (!enabled) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-6 text-slate-700">
        <p className="font-semibold text-slate-900 mb-1">Photo identification is coming soon.</p>
        <p className="text-sm">
          We&apos;re still testing it. Meanwhile, use the{' '}
          <Link href="/search" className="text-emerald-700 underline">search</Link> by imprint, color, or shape.
        </p>
      </div>
    )
  }

  return (
    <div>
      <p className="mb-3 text-xs text-slate-500">
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800">Beta</span>{' '}
        New feature — results can be imperfect. Always confirm with a pharmacist.
      </p>
      {/* Capture tips */}
      <div className="mb-4 rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-sm text-slate-700">
        <span className="font-semibold text-slate-900">For best results:</span> put the pill on a plain
        surface in good light, get close so it <span className="font-semibold">fills the circle</span>, hold
        steady, and photograph <span className="font-semibold">both sides</span>.
      </div>

      <label className="mb-4 flex items-start gap-2 text-sm text-slate-600 cursor-pointer">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-1 h-4 w-4 accent-emerald-700"
        />
        <span>
          Keep my photos to help PillSeek improve <span className="text-slate-400">(optional)</span>. Photos are
          stored privately, with no personal details, and used only to train our pill reader.
        </span>
      </label>

      {/* Photo capture */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        {(['front', 'back'] as SideKey[]).map((side) => (
          <label
            key={side}
            className={`relative border-2 border-dashed rounded-2xl p-4 text-center cursor-pointer transition-colors ${
              previews[side] ? 'border-emerald-400 bg-emerald-50/40' : 'border-emerald-300 hover:bg-emerald-50'
            }`}
          >
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              disabled={matching}
              onChange={(e) => handlePhoto(side, e.target.files?.[0] ?? null)}
            />
            {previews[side] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previews[side] as string}
                alt={`Pill ${side === 'front' ? 'side 1' : 'side 2'}`}
                className="mx-auto h-36 w-36 object-cover rounded-xl"
              />
            ) : (
              <div className="py-4 flex flex-col items-center">
                {/* Framing guide */}
                <div className="h-28 w-28 rounded-full border-4 border-emerald-300/80 flex items-center justify-center text-3xl select-none">
                  <span aria-hidden>📷</span>
                </div>
                <p className="mt-3 font-medium text-slate-700">
                  {side === 'front' ? 'Side 1' : 'Side 2 (flip it)'}
                </p>
                <p className="text-xs text-slate-500">Tap to use your camera</p>
              </div>
            )}
          </label>
        ))}
      </div>

      {/* Flow status */}
      {oneSide && !matching && (
        <p className="mb-4 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-emerald-800">
          📸 Now flip the pill and take the other side — we&apos;ll identify it once we have both.
        </p>
      )}
      {matching && (
        <div className="mb-4 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3">
          <div className="flex justify-between text-sm text-emerald-800">
            <span className="font-medium">Reading the imprint and matching your pill…</span>
            <span>{elapsed}s</span>
          </div>
          <div className="mt-2 h-2 w-full rounded-full bg-emerald-100 overflow-hidden">
            <div
              className="h-2 bg-emerald-600 rounded-full transition-all duration-1000"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-emerald-700">Usually takes about {EXPECTED_SECONDS} seconds.</p>
        </div>
      )}
      {bothSides && !matching && (
        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-slate-600">
          {photoResult?.imprint_read ? (
            <span>
              Read from photo: <span className="font-semibold text-slate-900">{photoResult.imprint_read}</span>
            </span>
          ) : (
            <span>Couldn&apos;t read an imprint from these photos.</span>
          )}
          {photoResult?.attrs_guess?.shape && (
            <span>
              · Looks {photoResult.attrs_guess.shape.toLowerCase()}
              {photoResult.attrs_guess.color ? `, ${photoResult.attrs_guess.color.toLowerCase()}` : ''}
            </span>
          )}
          <button onClick={resetPhotos} className="ml-auto text-emerald-700 hover:underline">
            Start over
          </button>
        </div>
      )}

      {/* Imprint (read from photo, or typed) */}
      <div className="mb-4">
        <label htmlFor="imprint" className="block font-medium text-slate-700 mb-1">
          Imprint {photoResult?.imprint_read ? '(read from your photo — edit if wrong)' : '(letters/numbers on the pill)'}
        </label>
        <input
          id="imprint"
          type="text"
          value={tokensText}
          onChange={(e) => setTokensText(e.target.value)}
          placeholder="e.g. LAMICTAL XR 200"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      </div>

      {/* Color / shape + manual search */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <select
          value={color}
          onChange={(e) => setColor(e.target.value)}
          aria-label="Pill color"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2"
        >
          <option value="">Any Color</option>
          {filters.colors.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={shape}
          onChange={(e) => setShape(e.target.value)}
          aria-label="Pill shape"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2"
        >
          <option value="">Any Shape</option>
          {filters.shapes.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          onClick={handleIdentify}
          disabled={searching || matching}
          className="rounded-lg bg-emerald-700 text-white font-semibold px-6 py-2 hover:bg-emerald-800 disabled:opacity-50"
        >
          {searching ? 'Identifying…' : 'Identify Pill'}
        </button>
      </div>

      {error && <p className="text-red-600 mb-4">{error}</p>}

      {/* Photo results */}
      {photoResult && photoResult.matches.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-slate-900 mb-3">Matches from your photo</h2>
          <ul className="space-y-3">
            {photoResult.matches.map((m) => (
              <li key={m.slug} className="relative">
                {photoResult.capture_id && !feedbackSent && (
                  <button
                    onClick={() => sendFeedback('up', m.slug)}
                    className="absolute -top-2 right-3 z-10 rounded-full border border-emerald-300 bg-white px-2 py-0.5 text-[11px] font-medium text-emerald-800 hover:bg-emerald-50"
                    title="Confirm this is your pill"
                  >
                    👍 This is my pill
                  </button>
                )}
                <Link
                  href={`/pill/${encodeURIComponent(m.slug)}`}
                  className="flex gap-4 items-center rounded-xl border border-slate-200 p-3 hover:border-emerald-400 hover:shadow-sm transition-all"
                >
                  {m.image_urls?.[0] && (
                    <Image
                      src={m.image_urls[0]}
                      alt={`${m.medicine_name} pill photo`}
                      width={72}
                      height={72}
                      className="rounded-lg object-cover flex-shrink-0"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900 truncate">
                      {m.medicine_name}{' '}
                      {m.strength && <span className="text-slate-500 font-normal">{m.strength}</span>}
                    </p>
                    <p className="text-sm text-slate-600 truncate">Imprint: {m.splimprint || '—'}</p>
                  </div>
                  <span
                    className={`text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap ${
                      m.source === 'imprint' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {m.source === 'imprint' ? 'Imprint match' : 'Looks similar'} · {Math.round(m.similarity * 100)}%
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {photoResult.capture_id && (
            <div className="mt-3 text-sm">
              {feedbackSent ? (
                <span className="text-emerald-700">Thanks — your feedback helps us improve.</span>
              ) : (
                <button onClick={() => sendFeedback('down')} className="text-slate-500 hover:text-slate-800 underline">
                  👎 None of these is my pill
                </button>
              )}
              {feedbackError && <p className="mt-1 text-xs text-red-600">{feedbackError}</p>}
            </div>
          )}
          <p className="text-xs text-slate-500 mt-3">{photoResult.disclaimer}</p>
        </div>
      )}

      {/* Manual results */}
      {textResult && textResult.candidates.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold text-slate-900 mb-3">Possible matches — compare with your pill</h2>
          <ul className="space-y-3">
            {textResult.candidates.map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/pill/${encodeURIComponent(c.slug)}`}
                  className="flex gap-4 items-center rounded-xl border border-slate-200 p-3 hover:border-emerald-400 hover:shadow-sm transition-all"
                >
                  <Image
                    src={c.image_urls[0]}
                    alt={`${c.medicine_name} pill photo`}
                    width={72}
                    height={72}
                    className="rounded-lg object-cover flex-shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900 truncate">
                      {c.medicine_name}{' '}
                      {c.strength && <span className="text-slate-500 font-normal">{c.strength}</span>}
                    </p>
                    <p className="text-sm text-slate-600 truncate">
                      Imprint: {c.splimprint || '—'} · {c.color || '—'} · {c.shape || '—'}
                    </p>
                  </div>
                  <span
                    className={`text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap ${QUALITY_STYLES[c.match_quality]}`}
                  >
                    {c.match_quality === 'exact' ? 'Best match' : c.match_quality === 'strong' ? 'Likely' : 'Possible'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500 mt-4 border-t border-slate-200 pt-3">{textResult.disclaimer}</p>
        </div>
      )}
    </div>
  )
}
