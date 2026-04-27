'use client'
import { useRouter } from 'next/navigation'
import { createClient } from '../lib/supabase'
import { LogOut, Menu } from 'lucide-react'

interface AdminTopBarProps {
  onMenuClick?: () => void
}

export default function AdminTopBar({ onMenuClick }: AdminTopBarProps) {
  const router = useRouter()
  const supabase = createClient()

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/admin/login')
  }

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6 shrink-0">
      <button
        onClick={onMenuClick}
        className="md:hidden flex items-center justify-center w-8 h-8 text-gray-600 hover:text-gray-900 transition-colors"
        aria-label="Open menu"
      >
        <Menu className="w-5 h-5" />
      </button>
      <div className="hidden md:block" />
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
