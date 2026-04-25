'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '../../lib/supabase'

async function getToken(): Promise<string | null> {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? null
}

async function apiFetch(path: string, options?: RequestInit) {
  const token = await getToken()
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Request failed')
  }
  return res.json()
}

export type RangeOption = '7d' | '28d' | '90d'

interface FetchState<T> {
  data: T | null
  loading: boolean
  error: string | null
  refetch: () => void
}

function useFetch<T>(path: string | null): FetchState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const refetch = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!path) return
    let cancelled = false
    setLoading(true)
    setError(null)
    apiFetch(path)
      .then(d => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [path, tick])

  return { data, loading, error, refetch }
}

export function useGA4Overview(range: RangeOption) {
  return useFetch<any>(`/api/admin/analytics/ga4/overview?range=${range}`)
}

export function useSearchConsoleOverview(range: RangeOption) {
  return useFetch<any>(`/api/admin/analytics/search-console/overview?range=${range}`)
}

export function usePageHealth() {
  return useFetch<any>('/api/admin/analytics/page-health')
}

export function usePageSpeed() {
  const [result, setResult] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async (url: string, strategy: 'mobile' | 'desktop') => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiFetch('/api/admin/analytics/pagespeed/run', {
        method: 'POST',
        body: JSON.stringify({ url, strategy }),
      })
      setResult(data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  return { result, loading, error, run }
}
