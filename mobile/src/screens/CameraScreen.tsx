import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconButton } from '../components/Button'
import { CloseIcon, FlashIcon, FlipIcon } from '../components/Icons'
import { AutoCaptureGate, type AutoState } from '../lib/autocapture'
import { useBackHandler } from '../lib/backstack'
import {
  CameraUnavailableError,
  capturePreview,
  guideDiameter,
  sampleGuideSignal,
  setTorch,
  startPreview,
  stopPreview,
  torchAvailable,
  type CapturedPhoto,
} from '../lib/camera'
import { fillHint, type FillLevel } from '../lib/fill'
import { useElementSize } from '../lib/hooks'
import { useT } from '../lib/i18n'
import { applyStatusBar, hapticImpact, hapticNotify } from '../lib/native'

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

/** How often the preview is sampled for coaching and auto-capture. */
const SAMPLE_MS = 320

/**
 * Full-screen native camera preview (behind the WebView) with an HTML overlay:
 * dimmed mask, centred circle guide, title, hint, shutter, cancel and torch.
 *
 * The photo takes itself: once the pill fills the circle, the image is sharp and
 * the phone is held still for a moment, we capture and move on. The shutter stays
 * as a fallback, greyed out while the pill is clearly too small to read.
 */
export default function CameraScreen({ side, previous, onCapture, onClose, onUnavailable }: Props) {
  const t = useT()
  const [boxRef, box] = useElementSize<HTMLDivElement>()
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [torch, setTorchState] = useState(false)
  const [hasTorch, setHasTorch] = useState(false)
  const [flash, setFlash] = useState(false)
  const [gotIt, setGotIt] = useState(false)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [fill, setFill] = useState<FillLevel | null>(null)
  const [auto, setAuto] = useState<AutoState>('idle')
  const startedRef = useRef(false)
  const mounted = useRef(true)
  const gateRef = useRef(new AutoCaptureGate())
  const prevGrayRef = useRef<Uint8Array | null>(null)
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

  // A new side is a new decision: forget the previous scene so the pill we just
  // shot cannot be captured again before it has been flipped.
  useEffect(() => {
    gateRef.current.reset()
    prevGrayRef.current = null
    setAuto('idle')
    setFill(null)
    setGotIt(false)
  }, [side])

  const shoot = useCallback(
    async (trigger: 'manual' | 'auto') => {
      if (!ready || busy || !guidePx) return
      setBusy(true)
      if (trigger === 'auto') {
        void hapticNotify('success')
        setGotIt(true)
      } else {
        void hapticImpact('light')
      }
      setFlash(true)
      window.setTimeout(() => setFlash(false), 180)
      try {
        const photo = await capturePreview({ dispW: box.w, dispH: box.h, guidePx })
        if (!mounted.current) return
        onCapture(side, photo)
      } catch (err) {
        if (!mounted.current) return
        // A capture hiccup (memory, empty frame) is not a broken camera: say so and let the user shoot again.
        setCaptureError(err instanceof Error && err.message ? t("Couldn't take the photo ({reason}). Try again.", { reason: err.message }) : t("Couldn't take the photo. Try again."))
        window.setTimeout(() => mounted.current && setCaptureError(null), 3000)
        setGotIt(false)
        gateRef.current.reset() // re-arm: the next auto-capture needs a fresh, steady scene
        prevGrayRef.current = null
      } finally {
        if (mounted.current) setBusy(false)
      }
    },
    [ready, busy, guidePx, box.w, box.h, side, onCapture, t],
  )

  // Live coaching + auto-capture: sample the circle a few times a second, colour
  // the ring, and fire the shutter once the gate says the frame is ready.
  useEffect(() => {
    if (!ready || busy || !guidePx) return
    let stop = false
    let timer = 0
    const tick = async () => {
      const sig = await sampleGuideSignal({ dispW: box.w, dispH: box.h, guidePx }, prevGrayRef.current)
      if (stop) return
      if (sig === null) return // plugin cannot sample: leave the ring neutral, shutter stays manual
      prevGrayRef.current = sig.gray
      setFill(sig.fill.level)
      const state = gateRef.current.feed({ t: performance.now(), level: sig.fill.level, sharp: sig.sharp, motion: sig.motion })
      setAuto(state)
      if (state === 'shoot') {
        void shoot('auto')
        return
      }
      timer = window.setTimeout(() => void tick(), SAMPLE_MS)
    }
    timer = window.setTimeout(() => void tick(), SAMPLE_MS)
    return () => {
      stop = true
      window.clearTimeout(timer)
    }
  }, [ready, busy, guidePx, box.w, box.h, shoot])

  const toggleTorch = async () => {
    const next = !torch
    if (await setTorch(next)) setTorchState(next)
  }

  const title = side === 1 ? t('Side 1 of 2') : t('Side 2 of 2 — flip the pill')
  const mask = guidePx
    ? `radial-gradient(circle at center, transparent ${Math.max(0, guidePx / 2 - 1)}px, rgba(0,0,0,0.62) ${guidePx / 2}px)`
    : 'rgba(0,0,0,0.62)'
  // Only a pill we are sure is too small blocks the shutter; "nothing detected" may
  // just be a white pill on a white table, and the user must still be able to shoot.
  const tooSmall = fill === 'small'
  const hint = gotIt
    ? t('Got it!')
    : auto === 'moving' || auto === 'holding'
      ? t('Hold still…')
      : auto === 'focusing'
        ? t('Hold still while it focuses…')
        : t(fillHint(fill))
  const hintTone = gotIt || auto === 'holding' ? 'text-emerald-300' : fill === 'good' ? 'text-emerald-200' : fill === 'small' ? 'text-amber-200' : 'text-white/85'
  const ringClass = gotIt || auto === 'holding'
    ? 'border-emerald-400 shadow-[0_0_0_6px_rgba(52,211,153,0.45)]'
    : fill === 'good'
      ? 'border-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.55)]'
      : fill === 'small'
        ? 'border-amber-300 shadow-[0_0_0_3px_rgba(251,191,36,0.5)]'
        : 'border-white/90 shadow-[0_0_0_2px_rgba(5,150,105,0.6)]'

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
        <IconButton label={t('Cancel')} tone="light" onClick={onClose}>
          <CloseIcon size={22} />
        </IconButton>
        <div className="text-center">
          <p className="text-[17px] font-semibold drop-shadow">{title}</p>
        </div>
        <IconButton
          label={torch ? t('Turn torch off') : t('Turn torch on')}
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
            className={`pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] transition-all duration-300 ${ringClass}`}
            style={{ width: guidePx, height: guidePx }}
          />
        )}
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center bg-black text-[15px] text-white/80">{t('Starting camera…')}</div>
        )}
        {flash && <div className="pointer-events-none absolute inset-0 bg-white/80" aria-hidden />}
        {captureError && (
          <p role="alert" className="absolute inset-x-6 top-4 rounded-2xl bg-black/70 px-4 py-2 text-center text-[14px] font-medium text-white">
            {captureError}
          </p>
        )}
        <p className={`pointer-events-none absolute inset-x-6 bottom-6 text-center text-[15px] font-medium drop-shadow ${hintTone}`} aria-live="polite">
          {hint}
        </p>
      </div>

      {/* Bottom controls (opaque: outside the native preview rect) */}
      <div className="relative z-10 flex h-32 items-center justify-between bg-black px-8">
        <div className="flex w-16 items-center justify-center">
          {previous ? (
            <img src={previous.previewUrl} alt={t('Side 1')} className="h-14 w-14 rounded-xl border-2 border-white/80 object-cover" />
          ) : (
            <span className="h-14 w-14" />
          )}
        </div>
        <div className="flex flex-col items-center gap-1">
          <button
            type="button"
            onClick={() => void shoot('manual')}
            disabled={!ready || busy || tooSmall}
            aria-label={t('Take photo of side {n}', { n: side })}
            title={t('Takes the photo by itself')}
            className="pressable flex h-[84px] w-[84px] items-center justify-center rounded-full border-4 border-white disabled:opacity-40"
          >
            <span className={`block h-[72px] w-[72px] rounded-full bg-brand transition-transform ${busy ? 'scale-75' : ''}`} />
          </button>
          <span className={`text-[11px] font-semibold uppercase tracking-wide ${tooSmall ? 'text-amber-200' : 'text-white/60'}`} aria-hidden>
            {tooSmall ? t('Move closer') : t('Auto')}
          </span>
        </div>
        <div className="flex w-16 flex-col items-center justify-center gap-1 text-[12px] text-white/80">
          {side === 2 ? (
            <>
              <FlipIcon size={24} />
              <span>{t('Flipped?')}</span>
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
