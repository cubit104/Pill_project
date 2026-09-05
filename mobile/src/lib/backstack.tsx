/**
 * Android hardware back button support. Modal-ish UI (camera, sheets) pushes a
 * handler; the topmost handler wins. When none is registered the router goes
 * back, and on the root screen the app exits.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'

type Handler = () => void

interface BackStackApi {
  push: (handler: Handler) => () => void
  /** Run the topmost handler. Returns false when the stack is empty. */
  pop: () => boolean
}

const BackStackContext = createContext<BackStackApi | null>(null)

export function BackStackProvider({ children }: { children: ReactNode }) {
  const stack = useRef<Handler[]>([])
  const push = useCallback((handler: Handler) => {
    stack.current.push(handler)
    return () => {
      stack.current = stack.current.filter((h) => h !== handler)
    }
  }, [])
  const pop = useCallback(() => {
    const top = stack.current[stack.current.length - 1]
    if (!top) return false
    top()
    return true
  }, [])
  const api = useMemo(() => ({ push, pop }), [push, pop])
  return <BackStackContext.Provider value={api}>{children}</BackStackContext.Provider>
}

export function useBackStack(): BackStackApi {
  const ctx = useContext(BackStackContext)
  if (!ctx) throw new Error('useBackStack must be used inside BackStackProvider')
  return ctx
}

/** Register `onBack` while `active` is true. */
export function useBackHandler(active: boolean, onBack: () => void): void {
  const { push } = useBackStack()
  const latest = useRef(onBack)
  latest.current = onBack
  useEffect(() => {
    if (!active) return
    return push(() => latest.current())
  }, [active, push])
}
