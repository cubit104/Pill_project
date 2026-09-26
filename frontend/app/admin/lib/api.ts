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
  getCaptures: (params?: Record<string, string | number | boolean>) => {
    const qs = buildQueryString(params)
    return apiFetch(qs ? `/api/admin/captures?${qs}` : '/api/admin/captures')
  },
  getCapture: (id: string) => apiFetch(`/api/admin/captures/${id}`),
  getCaptureStats: () => apiFetch('/api/admin/captures/stats'),
  bulkCaptures: (ids: string[], action: 'unusable' | 'delete') =>
    apiFetch('/api/admin/captures/bulk', { method: 'POST', body: JSON.stringify({ ids, action }) }),
  reviewCapture: (id: string, data: object) =>
    apiFetch(`/api/admin/captures/${id}/review`, { method: 'POST', body: JSON.stringify(data) }),
  reopenCapture: (id: string) =>
    apiFetch(`/api/admin/captures/${id}/reopen`, { method: 'POST' }),
  deleteCapture: (id: string) =>
    apiFetch(`/api/admin/captures/${id}`, { method: 'DELETE' }),
  getIvDrugs: (params?: Record<string, string | number | boolean>) => {
    const qs = buildQueryString(params)
    return apiFetch(qs ? `/api/admin/iv/drugs?${qs}` : '/api/admin/iv/drugs')
  },
  getIvDrug: (id: string) => apiFetch(`/api/admin/iv/drugs/${id}`),
  previewIvDrug: (id: string) => apiFetch(`/api/admin/iv/drugs/${id}/preview`),
  generateIvCard: (id: string) =>
    apiFetch(`/api/admin/iv/drugs/${id}/card/generate`, { method: 'POST' }),
  saveIvCard: (id: string, data: object) =>
    apiFetch(`/api/admin/iv/drugs/${id}/card`, { method: 'PUT', body: JSON.stringify(data) }),
  approveIvCard: (id: string) =>
    apiFetch(`/api/admin/iv/drugs/${id}/card/approve`, { method: 'POST' }),
  rejectIvCard: (id: string, notes: string) =>
    apiFetch(`/api/admin/iv/drugs/${id}/card/reject`, { method: 'POST', body: JSON.stringify({ notes }) }),
  switchIvLabel: (id: string, splSetId: string) =>
    apiFetch(`/api/admin/iv/drugs/${id}/label`, { method: 'PUT', body: JSON.stringify({ spl_set_id: splSetId }) }),
  addIvDrug: (data: { name: string; spl_set_id: string; brand_names: string[] }) =>
    apiFetch('/api/admin/iv/drugs', { method: 'POST', body: JSON.stringify(data) }),
  editIvDetails: (id: string, data: object) =>
    apiFetch(`/api/admin/iv/drugs/${id}/details`, { method: 'PUT', body: JSON.stringify(data) }),
  getIvLabel: (id: string) => apiFetch(`/api/admin/iv/drugs/${id}/label`),
  refetchIvLabel: (id: string) =>
    apiFetch(`/api/admin/iv/drugs/${id}/label/refetch`, { method: 'POST' }),
  clearIvLabelCache: (id: string) =>
    apiFetch(`/api/admin/iv/drugs/${id}/label/clear-cache`, { method: 'POST' }),
  bulkApproveIvCards: (ids: string[]) =>
    apiFetch('/api/admin/iv/cards/approve', { method: 'POST', body: JSON.stringify({ ids }) }),
  getNextIvDraft: (id: string) => apiFetch(`/api/admin/iv/drugs/${id}/next-draft`),
  bulkPublishIv: (ids: string[], published: boolean) =>
    apiFetch('/api/admin/iv/drugs/publish', { method: 'POST', body: JSON.stringify({ ids, published }) }),
  draftMissingIvCards: (limit: number) =>
    apiFetch('/api/admin/iv/cards/draft-missing', { method: 'POST', body: JSON.stringify({ limit }) }),
  getIvDraftStatus: () => apiFetch('/api/admin/iv/cards/draft-status'),
  setIvPublished: (id: string, published: boolean) =>
    apiFetch(`/api/admin/iv/drugs/${id}/published`, { method: 'PUT', body: JSON.stringify({ published }) }),
  // Drafts -> Review one by one (routes/admin/draft_review.py)
  getReviewQueue: () => apiFetch('/api/admin/draft-review/queue'),
  getReviewItem: (id: string) => apiFetch(`/api/admin/draft-review/${id}`),
  readReviewPhoto: (id: string) => apiFetch(`/api/admin/draft-review/${id}/read-photo`, { method: 'POST' }),
  publishReviewed: (id: string, updatedAt: string | null) =>
    apiFetch(`/api/admin/draft-review/${id}/publish`, { method: 'POST', body: JSON.stringify({ updated_at: updatedAt }) }),
  indicationFromMedlinePlus: (id: string) =>
    apiFetch(`/api/admin/draft-review/${id}/indication/medlineplus`, { method: 'POST' }),
  indicationFromLabel: (id: string) => apiFetch(`/api/admin/draft-review/${id}/indication/label`),
  reviewPronunciation: (id: string, pronunciationText: string) =>
    apiFetch(`/api/admin/draft-review/${id}/pronunciation`, {
      method: 'POST',
      body: JSON.stringify({ pronunciation_text: pronunciationText }),
    }),
  saveIndication: (id: string, plainText: string) =>
    apiFetch(`/api/admin/pills/${id}/indication`, { method: 'PUT', body: JSON.stringify({ plain_text: plainText }) }),
  setReviewFlags: (id: string, missing: string[], note: string | null) =>
    apiFetch(`/api/admin/pills/${id}/review-flags`, { method: 'PUT', body: JSON.stringify({ missing, note }) }),
}
