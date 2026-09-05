import { useCallback, useEffect, useRef, useState } from 'react'
import { getFeatures, type Features } from './api'

/** navigator.onLine mirrored into React state. */
export function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}

export interface FeaturesState {
  features: Features | null
  loading: boolean
  error: boolean
  reload: () => void
}

export function useFeatures(): FeaturesState {
  const [features, setFeatures] = useState<Features | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    const ctrl = new AbortController()
    setLoading(true)
    setError(false)
    getFeatures(ctrl.signal)
      .then((f) => {
        setFeatures(f)
        setLoading(false)
      })
      .catch(() => {
        if (ctrl.signal.aborted) return
        setError(true)
        setLoading(false)
      })
    return () => ctrl.abort()
  }, [nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { features, loading, error, reload }
}

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(id)
  }, [value, delayMs])
  return debounced
}

/** Tracks the size of an element with ResizeObserver. */
export function useElementSize<T extends HTMLElement>(): [React.RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size]
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}
