'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Pill, FileEdit, Trash2, ScrollText, Users, Settings, ImageOff, Layers, BarChart2, X } from 'lucide-react'
import { createClient } from '../lib/supabase'

const baseNavItems = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/pills', label: 'Pills', icon: Pill },
  { href: '/admin/pills/missing-images', label: 'Missing Images Queue', icon: ImageOff },
  { href: '/admin/duplicates', label: 'Duplicates', icon: Layers },
  { href: '/admin/drafts', label: 'Drafts', icon: FileEdit },
  { href: '/admin/trash', label: 'Trash', icon: Trash2 },
  { href: '/admin/audit', label: 'Audit Log', icon: ScrollText },
  { href: '/admin/analytics', label: 'Analytics & SEO', icon: BarChart2 },
]

const superuserNavItems = [
  { href: '/admin/settings', label: 'Settings', icon: Settings },
]

interface AdminSidebarProps {
  isOpen?: boolean
  onClose?: () => void
}

export default function AdminSidebar({ isOpen = false, onClose }: AdminSidebarProps) {
  const pathname = usePathname()
  const [role, setRole] = useState<string | null>(null)
  const [dupCount, setDupCount] = useState<number | null>(null)
  const [draftCount, setDraftCount] = useState<number | null>(null)

  const fetchCounts = useCallback(async (token: string) => {
    const [dupRes, draftRes] = await Promise.all([
      fetch('/api/admin/duplicates/count', { headers: { Authorization: `Bearer ${token}` } }),
      fetch('/api/admin/drafts/count', { headers: { Authorization: `Bearer ${token}` } }),
    ])
    if (dupRes.ok) {
      const dupData = await dupRes.json()
      if (dupData.total_groups != null) setDupCount(dupData.total_groups)
    }
    if (draftRes.ok) {
      const draftData = await draftRes.json()
      if (draftData.count != null) setDraftCount(draftData.count)
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      try {
        const supabase = createClient()
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (!session) return
        const token = session.access_token

        const [meRes] = await Promise.all([
          fetch('/api/admin/me', { headers: { Authorization: `Bearer ${token}` } }),
        ])

        if (meRes.ok) {
          const data = await meRes.json()
          setRole(data.role)
        }
        await fetchCounts(token)
      } catch (err) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Failed to init sidebar:', err)
        }
      }
    }
    init()
  }, [fetchCounts])

  useEffect(() => {
    const handleDraftCountChanged = async () => {
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        await fetchCounts(session.access_token)
      } catch (err) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Failed to refresh draft count:', err)
        }
      }
    }

    window.addEventListener('draft-count-changed', handleDraftCountChanged)
    return () => window.removeEventListener('draft-count-changed', handleDraftCountChanged)
  }, [fetchCounts])

  const isSuperuser = role === 'superuser' || role === 'superadmin'
  const canViewAudit = role === 'superuser' || role === 'superadmin' || role === 'editor'

  // Build nav items: conditionally show audit log and settings
  const navItems = [
    ...baseNavItems.filter(item => item.href !== '/admin/audit' || canViewAudit),
    ...(isSuperuser ? superuserNavItems : []),
  ]

  return (
    <aside
      className={`
        fixed top-0 left-0 h-full z-50 w-72
        md:relative md:w-16 md:z-auto
        lg:w-64
        transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        bg-gray-900 text-white flex flex-col shrink-0
      `}
    >
      {/* Header */}
      <div className="p-4 border-b border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <img
            src="/logo-mark.svg"
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 object-contain shrink-0"
          />
          <div className="min-w-0 md:hidden lg:block">
            <h1 className="text-xl font-bold leading-none">
              <span className="text-white">Pill</span><span className="text-emerald-400">Seek</span>
              <span className="ml-1 font-normal text-slate-400">Admin</span>
            </h1>
            {role && (
              <div className="mt-1">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  isSuperuser ? 'bg-red-900 text-red-200' :
                  role === 'editor' ? 'bg-blue-900 text-blue-200' :
                  'bg-purple-900 text-purple-200'
                }`}>
                  {role}
                </span>
              </div>
            )}
          </div>
        </div>
        {/* Close button — mobile only */}
        <button
          onClick={() => onClose?.()}
          className="md:hidden flex items-center justify-center w-8 h-8 text-gray-400 hover:text-white transition-colors"
          aria-label="Close menu"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive =
            pathname === href ||
            (href !== '/admin' && pathname.startsWith(href + '/'))
          return (
            <Link
              key={href}
              href={href}
              onClick={() => onClose?.()}
              title={label}
              className={`flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium transition-colors
                md:justify-center md:px-2 lg:justify-start lg:px-3
                ${isActive
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="flex-1 md:sr-only lg:not-sr-only">{label}</span>
              {href === '/admin/duplicates' && dupCount != null && dupCount > 0 && (
                <span className="bg-yellow-400 text-yellow-900 text-xs font-bold px-1.5 py-0.5 rounded-full md:hidden lg:inline">
                  {dupCount}
                </span>
              )}
              {href === '/admin/drafts' && draftCount != null && draftCount > 0 && (
                <span className="bg-blue-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full md:hidden lg:inline">
                  {draftCount}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      <div className="p-4 border-t border-gray-700 text-xs text-gray-500 md:hidden lg:block">
        PillSeek Admin v2.0
      </div>
    </aside>
  )
}
