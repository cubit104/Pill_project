import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useBackHandler } from '../lib/backstack'
import { CloseIcon } from './Icons'

interface Props {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
}

/** Bottom sheet with backdrop, Escape/back-button close and focus containment. */
export default function Sheet({ open, onClose, title, children }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  useBackHandler(open, onClose)

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // When the keyboard opens over a field, keep that field in view inside the sheet.
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null
      if (!el || !panelRef.current?.contains(el)) return
      window.setTimeout(() => el.scrollIntoView({ block: 'nearest' }), 350)
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('focusin', onFocus)
    panelRef.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('focusin', onFocus)
      opener?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center" role="presentation">
      <button type="button" aria-label="Close" onClick={onClose} className="sheet-backdrop absolute inset-0" />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="animate-sheet-up relative w-full max-w-lg overflow-y-auto rounded-t-[28px] bg-elevated shadow-sheet"
        style={{ paddingBottom: 'calc(var(--safe-bottom) + 16px + var(--kb, 0px))', maxHeight: 'calc(100dvh - 24px)' }}
      >
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-line" aria-hidden />
        <div className="flex items-start justify-between gap-3 px-5 pt-3">
          {title ? <h2 className="min-w-0 flex-1 text-[20px] font-bold tracking-tight text-ink">{title}</h2> : <span className="flex-1" />}
          <button type="button" onClick={onClose} aria-label="Close" className="pressable -mr-2 -mt-1 flex h-10 w-10 flex-none items-center justify-center rounded-full bg-line/60 text-ink">
            <CloseIcon size={16} strokeWidth={2.6} />
          </button>
        </div>
        <div className="px-5 pt-3">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
