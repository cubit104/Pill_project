import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { CheckIcon, AlertIcon } from './Icons'

type Tone = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  message: string
  tone: Tone
}

interface ToastApi {
  show: (message: string, tone?: Tone) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const counter = useRef(0)

  const show = useCallback((message: string, tone: Tone = 'info') => {
    const id = ++counter.current
    setItems((list) => [...list.slice(-2), { id, message, tone }])
    window.setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 2800)
  }, [])

  const api = useMemo(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-2 px-4"
        style={{ bottom: 'calc(var(--tabbar-h) + var(--safe-bottom) + 12px)' }}
        aria-live="polite"
        aria-atomic="true"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={`animate-fade-up flex max-w-md items-center gap-2 rounded-2xl px-4 py-3 text-[15px] font-medium shadow-card ${
              t.tone === 'error' ? 'bg-[#b91c1c] text-white' : 'bg-ink text-canvas'
            }`}
          >
            {t.tone === 'success' && <CheckIcon size={18} className="text-brand" />}
            {t.tone === 'error' && <AlertIcon size={18} />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
