import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconButton } from './Button'
import { CheckIcon, CloseIcon } from './Icons'
import { useBackHandler } from '../lib/backstack'
import { CameraUnavailableError, sampleFrame, startPreview, stopPreview } from '../lib/camera'
import { useElementSize } from '../lib/hooks'
import { foldFrame, memoryLines, missingFields, type LineMemory, type Missing } from '../lib/labelMerge'
import type { OcrLine, ParsedLabel } from '../lib/labelParse'
import { applyStatusBar, hapticImpact, hapticNotify } from '../lib/native'
import { recognizeText } from '../lib/ocr'

interface Props {
  onDone: (result: { label: ParsedLabel; lines: OcrLine[] }) => void
  onCancel: () => void
  onUnavailable: (err: CameraUnavailableError) => void
}

const FRAME_MS = 650
const MAX_MS = 40_000
/** Auto-finish after this many consecutive frames with nothing missing. */
const CONFIRM_FRAMES = 2

const FIELD_LABEL: Record<Missing, string> = { drug: 'Drug & strength', directions: 'Directions', quantity: 'Quantity', rx: 'Rx number' }
const ALL: Missing[] = ['drug', 'directions', 'quantity', 'rx']

/**
 * Live label scanner: the native preview fills the screen, we OCR a frame ~1.5×/s
 * while the user slowly turns the bottle, merge every reading, and show the
 * fields ticking off. Finishes by itself once all four are found, or on Done.
 */
export default function LabelScanner({ onDone, onCancel, onUnavailable }: Props) {
  const [boxRef, box] = useElementSize<HTMLDivElement>()
  const [ready, setReady] = useState(false)
  const [state, setState] = useState<{ memory: LineMemory[]; label: ParsedLabel | null }>({ memory: [], label: null })
  const [frames, setFrames] = useState(0)
  const stateRef = useRef(state)
  stateRef.current = state
  const startedRef = useRef(false)
  const mounted = useRef(true)
  const doneRef = useRef(false)
  const okStreak = useRef(0)
  useBackHandler(true, onCancel)

  const finish = () => {
    if (doneRef.current) return
    doneRef.current = true
    const s = stateRef.current
    onDone({ label: s.label ?? foldFrame(s, []).label, lines: memoryLines(s.memory) })
  }

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
      .then(() => mounted.current && setReady(true))
      .catch((err: unknown) => {
        if (!mounted.current) return
        onUnavailable(err instanceof CameraUnavailableError ? err : new CameraUnavailableError('error', String(err)))
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box.w, box.h])

  // The OCR loop.
  useEffect(() => {
    if (!ready) return
    let stop = false
    const startedAt = Date.now()
    const tick = async () => {
      if (stop) return
      const b64 = await sampleFrame(60)
      if (stop) return
      if (b64) {
        try {
          const lines = await recognizeText(b64)
          if (stop) return
          const next = foldFrame(stateRef.current, lines)
          setState(next)
          setFrames((n) => n + 1)
          const missing = missingFields(next.label)
          okStreak.current = missing.length === 0 ? okStreak.current + 1 : 0
          if (okStreak.current >= CONFIRM_FRAMES) {
            void hapticNotify('success')
            finish()
            return
          }
        } catch {
          /* frame failed; try the next */
        }
      }
      if (Date.now() - startedAt > MAX_MS) {
        finish()
        return
      }
      window.setTimeout(() => void tick(), FRAME_MS)
    }
    void tick()
    return () => {
      stop = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  const missing = new Set(missingFields(state.label))
  const found = ALL.filter((f) => !missing.has(f)).length

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label="Scan a pharmacy label">
      <div className="relative z-10 flex items-center justify-between bg-black px-3" style={{ paddingTop: 'calc(var(--safe-top) + 6px)', minHeight: 'calc(var(--safe-top) + 56px)' }}>
        <IconButton label="Cancel" tone="light" onClick={onCancel}>
          <CloseIcon size={22} />
        </IconButton>
        <p className="text-[16px] font-semibold">Scan the label</p>
        <span className="w-11" />
      </div>

      <div ref={boxRef} className="relative flex-1 overflow-hidden">
        {!ready && <div className="absolute inset-0 flex items-center justify-center bg-black text-[15px] text-white/80">Starting camera…</div>}
        <div className="pointer-events-none absolute inset-x-6 top-1/2 h-[46%] -translate-y-1/2 rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        <p className="pointer-events-none absolute inset-x-6 top-4 text-center text-[15px] font-medium text-white/90 drop-shadow">
          {found === 0 ? 'Fill the box with the label. Hold still.' : 'Slowly turn the bottle to show the rest of the label.'}
        </p>
      </div>

      <div className="relative z-10 bg-black px-5 pb-3 pt-3" style={{ paddingBottom: 'calc(var(--safe-bottom) + 12px)' }}>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[14px]">
          {ALL.map((f) => (
            <li key={f} className={`flex items-center gap-2 ${missing.has(f) ? 'text-white/55' : 'text-emerald-300'}`}>
              <span className={`flex h-5 w-5 items-center justify-center rounded-full ${missing.has(f) ? 'border border-white/40' : 'bg-emerald-400 text-black'}`}>{!missing.has(f) && <CheckIcon size={12} strokeWidth={3} />}</span>
              {FIELD_LABEL[f]}
            </li>
          ))}
        </ul>
        {state.label?.drugName && (
          <p className="mt-2 truncate text-[13px] text-white/70">
            {state.label.drugName}
            {state.label.strength ? ` ${state.label.strength}` : ''}
            {state.label.directions ? ` · ${state.label.directions}` : ''}
          </p>
        )}
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[12px] text-white/50">{frames} frames read</span>
          <button
            type="button"
            onClick={() => {
              void hapticImpact('light')
              finish()
            }}
            disabled={!state.label?.drugName}
            className="pressable rounded-full bg-white px-5 py-2.5 text-[15px] font-semibold text-black disabled:opacity-40"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
