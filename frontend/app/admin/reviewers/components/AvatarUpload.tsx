'use client'

import { useRef, useState } from 'react'
import { UserCircle } from 'lucide-react'

interface AvatarUploadProps {
  reviewerId: string
  currentUrl?: string | null
  onUpload: (newUrl: string) => void
}

export default function AvatarUpload({ reviewerId, currentUrl, onUpload }: AvatarUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentUrl ?? null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const allowed = ['image/jpeg', 'image/png', 'image/webp']
    if (!allowed.includes(file.type)) {
      setError('Only JPG, PNG, or WebP images are allowed.')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('Image must be under 2 MB.')
      return
    }

    setError('')
    setUploading(true)

    try {
      const { createClient } = await import('../../lib/supabase')
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')

      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch(`/api/admin/reviewers/${reviewerId}/avatar`, {
        method: 'POST',
        headers: { Authorization: `****** },
        body: formData,
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || 'Upload failed')
      }

      const data = await res.json()
      setPreviewUrl(data.avatar_url)
      onUpload(data.avatar_url)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="w-24 h-24 rounded-full overflow-hidden bg-gray-700 flex items-center justify-center border-2 border-gray-600">
        {previewUrl ? (
          <img src={previewUrl} alt="Avatar" className="w-full h-full object-cover" />
        ) : (
          <UserCircle className="w-16 h-16 text-gray-400" />
        )}
      </div>

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className="text-sm px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded-md transition-colors disabled:opacity-50"
      >
        {uploading ? 'Uploading…' : 'Upload Photo'}
      </button>

      <p className="text-xs text-gray-400">JPG, PNG, WebP · max 2 MB</p>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  )
}
