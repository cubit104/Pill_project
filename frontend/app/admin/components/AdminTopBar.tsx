'use client'
import { useRouter } from 'next/navigation'
import { createClient } from '../lib/supabase'
import { LogOut } from 'lucide-react'

export default function AdminTopBar() {
  const router = useRouter()
  const supabase = createClient()

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/admin/login')
  }

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6 shrink-0">
      <div />
      <button
        onClick={handleSignOut}
        className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
      >
        <LogOut className="w-4 h-4" />
        Sign out
      </button>
    </header>
  )
}
