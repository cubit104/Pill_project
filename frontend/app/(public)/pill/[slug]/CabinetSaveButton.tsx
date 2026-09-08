'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { addToCabinet, currentUser, isInCabinet, type CabinetUser } from '../../../lib/cabinet'

/** "Save to my cabinet" on a pill page. Signed-out visitors go to /cabinet to sign in, then the pill is added. */
export default function CabinetSaveButton({ slug }: { slug: string }) {
  const [user, setUser] = useState<CabinetUser | null | undefined>(undefined)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void currentUser().then(async (u) => {
      if (cancelled) return
      setUser(u)
      if (u) setSaved(await isInCabinet(slug).catch(() => false))
    })
    return () => {
      cancelled = true
    }
  }, [slug])

  const save = async () => {
    if (!user) return
    setBusy(true)
    setError('')
    try {
      await addToCabinet(user.id, slug)
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  const base = 'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500'
  if (user === undefined) return null
  if (!user) {
    return (
      <Link href={`/cabinet?add=${encodeURIComponent(slug)}`} className={`${base} border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100`}>
        <span aria-hidden>＋</span> Save to my cabinet
      </Link>
    )
  }
  if (saved) {
    return (
      <Link href="/cabinet" className={`${base} border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700`}>
        <span aria-hidden>✓</span> In my cabinet
      </Link>
    )
  }
  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" disabled={busy} onClick={() => void save()} className={`${base} border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 disabled:opacity-50`}>
        <span aria-hidden>＋</span> {busy ? 'Saving…' : 'Save to my cabinet'}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  )
}
