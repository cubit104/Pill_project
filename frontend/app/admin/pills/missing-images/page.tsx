'use client'

export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '../../lib/supabase'
import { ArrowLeft, Upload, X } from 'lucide-react'
import { Suspense } from 'react'

interface Pill {
  id: string
  medicine_name: string
  splimprint: string
  splcolor_text: string
  splshape_text: string
  spl_strength: string
}

interface PillsResponse {
  pills: Pill[]
  total: number
  page: number
  per_page: number
  pages: number
}

function MissingImagesInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const page = Number(searchParams.get('page') || '1')

  const [pills, setPills] = useState<Pill[]>([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [uploading, setUploading] = useState<string | null>(null)
  const [uploadSuccess, setUploadSuccess] = useState<Set<string>>(new Set())

  const fetchPills = useCallback(async () => {
    const supabase = createClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) {
      router.push('/admin/login')
      return
    }

    const params = new URLSearchParams()
    params.set('has_image', 'false')
    params.set('page', String(page))
    params.set('per_page', '20')

    setLoading(true)
    try {
      const res = await fetch(`/api/admin/pills?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) throw new Error('Failed to fetch pills')
      const data: PillsResponse = await res.json()
      setPills(data.pills)
      setTotal(data.total)
      setPages(data.pages)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [page, router])

  useEffect(() => {
    fetchPills()
  }, [fetchPills])

  const handleSkip = (id: string) => {
    setSkipped((prev) => new Set([...prev, id]))
  }

  const handleUpload = async (id: string, file: File) => {
    const supabase = createClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) return

    setUploading(id)
    setError('')

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch(`/api/admin/pills/${id}/images`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData,
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Upload failed')
      }
      setUploadSuccess((prev) => new Set([...prev, id]))
      // Remove from list after short delay for visual feedback
      setTimeout(() => {
        setPills((prev) => prev.filter((p) => p.id !== id))
      }, 800)
    } catch (e) {
      setError(String(e))
    } finally {
      setUploading(null)
    }
  }

  const visiblePills = pills.filter((p) => !skipped.has(p.id) && !uploadSuccess.has(p.id))

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/pills"
          className="text-gray-500 hover:text-gray-700 flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Pills
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Missing Images Queue</h1>
      </div>

      <p className="text-sm text-gray-500">
        Pills without images. Upload an image per row — the row disappears on success. Use
        &quot;Skip&quot; to hide a row for this session.
      </p>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-2 rounded-md text-sm">{error}</div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-200 text-sm text-gray-600">
          {loading ? (
            <span>Loading…</span>
          ) : (
            <span>
              Showing {total === 0 ? 0 : (page - 1) * 20 + 1}–{Math.min(page * 20, total)} of{' '}
              {total.toLocaleString()} pills missing images
            </span>
          )}
        </div>

        {loading && (
          <div className="px-4 py-8 text-center text-gray-500">Loading…</div>
        )}

        {!loading && visiblePills.length === 0 && (
          <div className="px-4 py-8 text-center text-gray-500">
            All pills on this page have been processed.{' '}
            {page < pages && (
              <Link
                href={`/admin/pills/missing-images?page=${page + 1}`}
                className="text-indigo-600 hover:underline"
              >
                Load next page →
              </Link>
            )}
          </div>
        )}

        <div className="divide-y divide-gray-100">
          {visiblePills.map((pill) => (
            <div
              key={pill.id}
              className={`px-4 py-4 flex flex-col sm:flex-row sm:items-center gap-3 transition-opacity ${
                uploadSuccess.has(pill.id) ? 'opacity-30' : ''
              }`}
            >
              <div className="flex-1 min-w-0">
                <Link
                  href={`/admin/pills/${pill.id}`}
                  className="font-medium text-indigo-600 hover:underline text-sm"
                >
                  {pill.medicine_name || '(no name)'}
                </Link>
                {pill.spl_strength && (
                  <span className="ml-2 text-xs text-gray-400">{pill.spl_strength}</span>
                )}
                <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap gap-2">
                  {pill.splimprint && <span>Imprint: {pill.splimprint}</span>}
                  {pill.splcolor_text && <span>Color: {pill.splcolor_text}</span>}
                  {pill.splshape_text && <span>Shape: {pill.splshape_text}</span>}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {uploadSuccess.has(pill.id) ? (
                  <span className="text-green-600 text-sm font-medium">✓ Uploaded</span>
                ) : (
                  <>
                    <label className="flex items-center gap-1.5 bg-indigo-600 text-white px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer hover:bg-indigo-700 transition-colors">
                      <Upload className="w-3 h-3" />
                      {uploading === pill.id ? 'Uploading…' : 'Upload'}
                      <input
                        type="file"
                        accept=".jpg,.jpeg,.png,.webp"
                        className="hidden"
                        disabled={uploading === pill.id}
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) handleUpload(pill.id, file)
                        }}
                      />
                    </label>
                    <button
                      onClick={() => handleSkip(pill.id)}
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-300 px-2 py-1.5 rounded-md"
                    >
                      <X className="w-3 h-3" /> Skip
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between text-sm text-gray-600">
          <div>
            {total > 0 && (
              <span>
                Page {page} of {pages}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={`/admin/pills/missing-images?page=${page - 1}`}
                className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50"
              >
                Previous
              </Link>
            )}
            {page < pages && (
              <Link
                href={`/admin/pills/missing-images?page=${page + 1}`}
                className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function MissingImagesPage() {
  return (
    <Suspense fallback={<div className="p-4 text-gray-500">Loading…</div>}>
      <MissingImagesInner />
    </Suspense>
  )
}
