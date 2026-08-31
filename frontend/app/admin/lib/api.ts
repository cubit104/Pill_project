import { createClient } from './supabase'

function buildQueryString(
  params?: Record<string, string | number | boolean | null | undefined>,
) {
  const searchParams = new URLSearchParams()

  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value === null || value === undefined) {
      return
    }

    searchParams.set(key, String(value))
  })

  return searchParams.toString()
}

async function apiFetch(path: string, options?: RequestInit) {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token

  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers || {}),
    },
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Request failed')
  }

  return res.json()
}

export const adminApi = {
  getMe: () => apiFetch('/api/admin/me'),
  getStats: () => apiFetch('/api/admin/stats'),
  getPills: (params: Record<string, string | number | boolean>) => {
    const qs = buildQueryString(params)
    return apiFetch(qs ? `/api/admin/pills?${qs}` : '/api/admin/pills')
  },
  getPill: (id: string) => apiFetch(`/api/admin/pills/${id}`),
  createPill: (data: object) =>
    apiFetch('/api/admin/pills', { method: 'POST', body: JSON.stringify(data) }),
  updatePill: (id: string, data: object) =>
    apiFetch(`/api/admin/pills/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePill: (id: string) =>
    apiFetch(`/api/admin/pills/${id}`, { method: 'DELETE' }),
  restorePill: (id: string) =>
    apiFetch(`/api/admin/pills/${id}/restore`, { method: 'POST' }),
  createDraft: (pillId: string, data: object) =>
    apiFetch(`/api/admin/pills/${pillId}/drafts`, { method: 'POST', body: JSON.stringify(data) }),
  getDrafts: (params?: Record<string, string | number | boolean>) => {
    const qs = buildQueryString(params)
    return apiFetch(qs ? `/api/admin/drafts?${qs}` : '/api/admin/drafts')
  },
  submitDraft: (id: string) =>
    apiFetch(`/api/admin/drafts/${id}/submit`, { method: 'POST' }),
  approveDraft: (id: string, notes?: string) =>
    apiFetch(`/api/admin/drafts/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ review_notes: notes }),
    }),
  publishDraft: (id: string) =>
    apiFetch(`/api/admin/drafts/${id}/publish`, { method: 'POST' }),
  rejectDraft: (id: string, notes?: string) =>
    apiFetch(`/api/admin/drafts/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ review_notes: notes }),
    }),
  getAuditLog: (params?: Record<string, string | number | boolean>) => {
    const qs = buildQueryString(params)
    return apiFetch(qs ? `/api/admin/audit?${qs}` : '/api/admin/audit')
  },
  getUsers: () => apiFetch('/api/admin/users'),
  inviteUser: (data: object) =>
    apiFetch('/api/admin/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id: string, data: object) =>
    apiFetch(`/api/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deactivateUser: (id: string) =>
    apiFetch(`/api/admin/users/${id}`, { method: 'DELETE' }),
}
