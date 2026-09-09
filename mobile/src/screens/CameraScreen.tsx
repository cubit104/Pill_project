import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconButton } from '../components/Button'
import { CloseIcon, FlashIcon, FlipIcon } from '../components/Icons'
import { useBackHandler } from '../lib/backstack'
import {
  CameraUnavailableError,
  capturePreview,
  guideDiameter,
  sampleGuideFill,
  setTorch,
  startPreview,
  stopPreview,
  torchAvailable,
  type CapturedPhoto,
} from '../lib/camera'
import { fillHint, type FillLevel } from '../lib/fill'
import { useElementSize } from '../lib/hooks'
import { applyStatusBar, hapticImpact } from '../lib/native'

export type Side = 1 | 2

interface Props {
  side: Side
  /** Thumbnail of side 1 (shown while shooting side 2). */
  previous: CapturedPhoto | null
  onCapture: (side: Side, photo: CapturedPhoto) => void
  onClose: () => void
  /** Live preview could not start; caller falls back to the system camera. */
  onUnavailable: (error: CameraUnavailableError) => void
}

/**
 * Full-screen native camera preview (behind the WebView) with an HTML overlay:
 * dimmed mask, centred circle guide, title, hint, shutter, cancel and torch.
 */
export default function CameraScreen({ side, previous, onCapture, onClose, onUnavailable }: Props) {
  const [boxRef, box] = useElementSize<HTMLDivElement>()
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [torch, setTorchState] = useState(false)
  const [hasTorch, setHasTorch] = useState(false)
  const [flash, setFlash] = useState(false)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [fill, setFill] = useState<FillLevel | null>(null)
  const startedRef = useRef(false)
  const mounted = useRef(true)
  const guidePx = guideDiameter(box.w, box.h)

  useBackHandler(true, onClose)

  // Start the preview once the overlay box has a size.
  useEffect(() => {
    mounted.current = true
    document.documentElement.classList.add('camera-open')
    void applyStatusBar('camera')
    return () => {
      mounted.current = false
      document.documentElement.classList.remove('camera-open')
      void stopPreview()
      void applyStatusBar('auto')
    }
  }, [])

  useEffect(() => {
    if (startedRef.current || box.w === 0 || box.h === 0) return
    startedRef.current = true
    const el = boxRef.current
    const rect = el ? el.getBoundingClientRect() : { x: 0, y: 0, width: box.w, height: box.h }
    startPreview({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
      .then(async () => {
        if (!mounted.current) return
        setReady(true)
        setHasTorch(await torchAvailable())
      })
      .catch((err: unknown) => {
        if (!mounted.current) return
        const e = err instanceof CameraUnavailableError ? err : new CameraUnavailableError('error', String(err))
        onUnavailable(e)
      })
    // onUnavailable is stable enough for our use; we only want to start once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box.w, box.h])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Live coaching: sample the circle a few times a second and colour the ring.
  useEffect(() => {
    if (!ready || busy || !guidePx) return
    let stop = false
    let timer = 0
    const tick = async () => {
      const est = await sampleGuideFill({ dispW: box.w, dispH: box.h, guidePx })
      if (stop) return
      if (est === null) return // plugin cannot sample: leave the ring neutral
      setFill(est.level)
      timer = window.setTimeout(() => void tick(), 600)
    }
    timer = window.setTimeout(() => void tick(), 400)
    return () => {
      stop = true
      window.clearTimeout(timer)
    }
  }, [ready, busy, guidePx, box.w, box.h])

  const shoot = useCallback(async () => {
    if (!ready || busy || !guidePx) return
    setBusy(true)
    void hapticImpact('light')
    setFlash(true)
    window.setTimeout(() => setFlash(false), 180)
    try {
      const photo = await capturePreview({ dispW: box.w, dispH: box.h, guidePx })
      if (!mounted.current) return
      onCapture(side, photo)
    } catch (err) {
      if (!mounted.current) return
      // A capture hiccup (memory, empty frame) is not a broken camera: say so and let the user shoot again.
      setCaptureError(err instanceof Error && err.message ? `Couldn't take the photo (${err.message}). Try again.` : "Couldn't take the photo. Try again.")
      window.setTimeout(() => mounted.current && setCaptureError(null), 3000)
    } finally {
      if (mounted.current) setBusy(false)
    }
  }, [ready, busy, guidePx, box.w, box.h, side, onCapture])

  const toggleTorch = async () => {
    const next = !torch
    if (await setTorch(next)) setTorchState(next)
  }

  const title = side === 1 ? 'Side 1 of 2' : 'Side 2 of 2 — flip the pill'
  const mask = guidePx
    ? `radial-gradient(circle at center, transparent ${Math.max(0, guidePx / 2 - 1)}px, rgba(0,0,0,0.62) ${guidePx / 2}px)`
    : 'rgba(0,0,0,0.62)'

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex flex-col bg-transparent text-white"
      style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)', backgroundColor: 'transparent' }}
    >
      {/* Safe-area strips stay black so the status bar never sits on the native window colour. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 bg-black" style={{ height: 'var(--safe-top)' }} aria-hidden />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black" style={{ height: 'var(--safe-bottom)' }} aria-hidden />
      {/* The plugin needs a parent element on the web; native ignores it. */}
      <div id="camera-preview-root" className="pointer-events-none absolute inset-0 -z-10" aria-hidden />

      {/* Top bar (opaque: outside the native preview rect) */}
      <div className="relative z-10 flex items-center justify-between bg-black px-3 pb-2 pt-2">
        <IconButton label="Cancel" tone="light" onClick={onClose}>
          <CloseIcon size={22} />
        </IconButton>
        <div className="text-center">
          <p className="text-[17px] font-semibold drop-shadow">{title}</p>
        </div>
        <IconButton
          label={torch ? 'Turn torch off' : 'Turn torch on'}
          tone="light"
          onClick={toggleTorch}
          disabled={!hasTorch}
          className={hasTorch ? '' : 'opacity-0 pointer-events-none'}
        >
          <FlashIcon size={22} on={torch} />
        </IconButton>
      </div>

      {/* Preview area with circle guide */}
      <div ref={boxRef} className="relative flex-1 overflow-hidden">
        <div className="pointer-events-none absolute inset-0 transition-opacity duration-base" style={{ background: mask }} />
        {guidePx > 0 && (
          <div
            className={`pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] transition-colors duration-300 ${
              fill === 'good' ? 'border-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.55)]' : fill === 'small' ? 'border-amber-300 shadow-[0_0_0_3px_rgba(251,191,36,0.5)]' : 'border-white/90 shadow-[0_0_0_2px_rgba(5,150,105,0.6)]'
            }`}
            style={{ width: guidePx, height: guidePx }}
          />
        )}
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center bg-black text-[15px] text-white/80">Starting camera…</div>
        )}
        {flash && <div className="pointer-events-none absolute inset-0 bg-white/80" aria-hidden />}
        {captureError && (
          <p role="alert" className="absolute inset-x-6 top-4 rounded-2xl bg-black/70 px-4 py-2 text-center text-[14px] font-medium text-white">
            {captureError}
          </p>
        )}
        <p className={`pointer-events-none absolute inset-x-6 bottom-6 text-center text-[15px] font-medium drop-shadow ${fill === 'good' ? 'text-emerald-300' : fill === 'small' ? 'text-amber-200' : 'text-white/85'}`} aria-live="polite">
          {fillHint(fill)}
        </p>
      </div>

      {/* Bottom controls (opaque: outside the native preview rect) */}
      <div className="relative z-10 flex h-32 items-center justify-between bg-black px-8">
        <div className="flex w-16 items-center justify-center">
          {previous ? (
            <img src={previous.previewUrl} alt="Side 1" className="h-14 w-14 rounded-xl border-2 border-white/80 object-cover" />
          ) : (
            <span className="h-14 w-14" />
          )}
        </div>
        <button
          type="button"
          onClick={() => void shoot()}
          disabled={!ready || busy}
          aria-label={side === 1 ? 'Take photo of side 1' : 'Take photo of side 2'}
          className="pressable flex h-[84px] w-[84px] items-center justify-center rounded-full border-4 border-white disabled:opacity-40"
        >
          <span className={`block h-[72px] w-[72px] rounded-full bg-brand transition-transform ${busy ? 'scale-75' : ''}`} />
        </button>
        <div className="flex w-16 flex-col items-center justify-center gap-1 text-[12px] text-white/80">
          {side === 2 ? (
            <>
              <FlipIcon size={24} />
              <span>Flipped?</span>
            </>
          ) : (
            <span className="h-14 w-14" />
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
