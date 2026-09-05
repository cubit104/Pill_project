'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * In-page camera with a circular framing guide and zoom.
 *
 * Why: the phone's own camera app hands us a full frame where the pill is a
 * few hundred pixels wide and the imprint ~15 px tall. Here the user fits the
 * pill inside the circle (zooming in as needed) and we crop exactly that
 * region out of the full-resolution camera frame, so the pill fills the
 * picture at up to 1600 px — what the imprint reader was trained on.
 *
 * Zoom uses the camera's optical/hardware zoom when the browser exposes it,
 * otherwise a digital zoom (tighter crop of the same frame).
 */

interface Props {
  title: string
  hint: string
  onCapture: (file: File) => void
  onClose: () => void
  /** Called when the camera can't be opened (permission denied, no camera, http origin). */
  onUnavailable: (reason: string) => void
}

const GUIDE_FRACTION = 0.68 // circle diameter relative to the shorter side of the view
const CROP_PAD = 0.12 // extra margin around the circle in the saved image
const MAX_SIDE = 1600 // saved image size cap (matches the upload path)

export default function CameraCapture({ title, hint, onCapture, onClose, onUnavailable }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [ready, setReady] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number; step: number; hardware: boolean }>({
    min: 1,
    max: 3,
    step: 0.1,
    hardware: false,
  })
  const [busy, setBusy] = useState(false)

  // Open the rear camera at the highest resolution it offers.
  useEffect(() => {
    let cancelled = false
    const open = async () => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        onUnavailable('Camera not supported in this browser')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 4096 }, height: { ideal: 3072 } },
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          await video.play().catch(() => {})
        }
        // Hardware zoom, when the browser exposes it (Android Chrome does; iOS Safari does not).
        const track = stream.getVideoTracks()[0]
        const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & {
          zoom?: { min: number; max: number; step?: number }
        }
        if (caps.zoom && caps.zoom.max > caps.zoom.min) {
          setZoomRange({ min: caps.zoom.min, max: Math.min(caps.zoom.max, 8), step: caps.zoom.step || 0.1, hardware: true })
          setZoom(caps.zoom.min)
        }
        setReady(true)
      } catch (e) {
        onUnavailable(e instanceof Error ? e.message : 'Camera unavailable')
      }
    }
    void open()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyZoom = useCallback(
    (z: number) => {
      setZoom(z)
      if (zoomRange.hardware) {
        const track = streamRef.current?.getVideoTracks()[0]
        track?.applyConstraints({ advanced: [{ zoom: z } as MediaTrackConstraintSet] }).catch(() => {})
      }
    },
    [zoomRange.hardware],
  )

  // Digital zoom factor applied to the preview (1 when hardware zoom is in use).
  const digitalZoom = zoomRange.hardware ? 1 : zoom

  const capture = async () => {
    const video = videoRef.current
    if (!video || !ready || busy) return
    setBusy(true)
    try {
      const natW = video.videoWidth
      const natH = video.videoHeight
      const dispW = video.clientWidth
      const dispH = video.clientHeight
      if (!natW || !natH || !dispW || !dispH) throw new Error('Camera frame not ready')
      // object-fit: cover — the visible part of the frame is a centred region scaled by `scale`,
      // then the digital zoom (CSS scale about the centre) shrinks the visible region further.
      const scale = Math.max(dispW / natW, dispH / natH) * digitalZoom
      const guideDisp = GUIDE_FRACTION * Math.min(dispW, dispH)
      const cropSide = Math.min(natW, natH, (guideDisp / scale) * (1 + 2 * CROP_PAD))
      const sx = Math.max(0, natW / 2 - cropSide / 2)
      const sy = Math.max(0, natH / 2 - cropSide / 2)
      const outSide = Math.min(MAX_SIDE, Math.round(cropSide))
      const canvas = document.createElement('canvas')
      canvas.width = outSide
      canvas.height = outSide
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas unavailable')
      ctx.drawImage(video, sx, sy, cropSide, cropSide, 0, 0, outSide, outSide)
      const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
      if (!blob) throw new Error('Could not save the photo')
      onCapture(new File([blob], `pill-${Date.now()}.jpg`, { type: 'image/jpeg' }))
    } catch (e) {
      onUnavailable(e instanceof Error ? e.message : 'Capture failed')
    } finally {
      setBusy(false)
    }
  }

  // Rendered on document.body so no ancestor transform/overflow can shrink the overlay.
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white" role="dialog" aria-label={title}>
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <p className="font-semibold">{title}</p>
          <p className="text-xs text-white/70">{hint}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm bg-white/10 hover:bg-white/20">
          Cancel
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="absolute inset-0 h-full w-full object-cover"
          style={{ transform: `scale(${digitalZoom})`, transformOrigin: 'center center' }}
        />
        {/* Circular guide: dim everything outside the circle */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(circle at center, transparent calc(${(GUIDE_FRACTION * 50).toFixed(1)}vmin - 2px), rgba(0,0,0,0.55) calc(${(GUIDE_FRACTION * 50).toFixed(1)}vmin))`,
          }}
        />
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-emerald-400/90"
          style={{ width: `${GUIDE_FRACTION * 100}vmin`, height: `${GUIDE_FRACTION * 100}vmin` }}
        />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">Starting camera…</div>
        )}
      </div>

      <div className="px-4 pb-6 pt-3 space-y-3">
        <label className="flex items-center gap-3 text-sm">
          <span className="w-12 text-white/80">Zoom</span>
          <input
            type="range"
            min={zoomRange.min}
            max={zoomRange.max}
            step={zoomRange.step}
            value={zoom}
            onChange={(e) => applyZoom(Number(e.target.value))}
            className="flex-1 accent-emerald-500"
            aria-label="Zoom"
          />
          <span className="w-10 text-right tabular-nums text-white/80">{zoom.toFixed(1)}×</span>
        </label>
        <p className="text-center text-xs text-white/70">Fill the circle with the pill, hold steady, then tap the button.</p>
        <div className="flex justify-center">
          <button
            type="button"
            onClick={capture}
            disabled={!ready || busy}
            aria-label="Take photo"
            className="rounded-full border-4 border-white bg-emerald-500 disabled:opacity-50"
            style={{ width: 72, height: 72 }}
          />
        </div>
      </div>
    </div>,
    document.body,
  )
}
