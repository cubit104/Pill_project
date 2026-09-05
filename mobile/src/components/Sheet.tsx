import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useBackHandler } from '../lib/backstack'

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
    window.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
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
        className="animate-sheet-up relative w-full max-w-lg rounded-t-[28px] bg-elevated shadow-sheet"
        style={{ paddingBottom: 'calc(var(--safe-bottom) + 16px)' }}
      >
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-line" aria-hidden />
        {title && <h2 className="px-5 pt-3 text-[20px] font-bold tracking-tight text-ink">{title}</h2>}
        <div className="px-5 pt-3">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
