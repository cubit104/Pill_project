'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Pill, FileEdit, Trash2, ScrollText, Users, Settings, ImageOff, Layers } from 'lucide-react'
import { createClient } from '../lib/supabase'

const baseNavItems = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/pills', label: 'Pills', icon: Pill },
  { href: '/admin/pills/missing-images', label: 'Missing Images Queue', icon: ImageOff },
  { href: '/admin/duplicates', label: 'Duplicates', icon: Layers },
  { href: '/admin/drafts', label: 'Drafts', icon: FileEdit },
  { href: '/admin/trash', label: 'Trash', icon: Trash2 },
  { href: '/admin/audit', label: 'Audit Log', icon: ScrollText },
]

const superuserNavItems = [
  { href: '/admin/settings', label: 'Settings', icon: Settings },
]

export default function AdminSidebar() {
  const pathname = usePathname()
  const [role, setRole] = useState<string | null>(null)
  const [dupCount, setDupCount] = useState<number | null>(null)

  useEffect(() => {
    const init = async () => {
      try {
        const supabase = createClient()
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (!session) return
        const token = session.access_token

        const [meRes, dupRes] = await Promise.all([
          fetch('/api/admin/me', { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/api/admin/duplicates/count', { headers: { Authorization: `Bearer ${token}` } }),
        ])

        if (meRes.ok) {
          const data = await meRes.json()
          setRole(data.role)
        }
        if (dupRes.ok) {
          const dupData = await dupRes.json()
          if (dupData.total_groups != null) setDupCount(dupData.total_groups)
        }
      } catch (err) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Failed to init sidebar:', err)
        }
      }
    }
    init()
  }, [])

  const isSuperuser = role === 'superuser' || role === 'superadmin'
  const canViewAudit = role === 'superuser' || role === 'superadmin' || role === 'editor'

  // Build nav items: conditionally show audit log and settings
  const navItems = [
    ...baseNavItems.filter(item => item.href !== '/admin/audit' || canViewAudit),
    ...(isSuperuser ? superuserNavItems : []),
  ]

  return (
    <aside className="w-64 bg-gray-900 text-white flex flex-col h-full shrink-0">
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <img
            src="/logo-mark.svg"
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 object-contain"
          />
          <h1 className="text-xl font-bold">
            <span className="text-white">Pill</span><span className="text-emerald-400">Seek</span>
            <span className="ml-1 font-normal text-slate-400">Admin</span>
          </h1>
        </div>
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
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive =
            pathname === href ||
            (href !== '/admin' && pathname.startsWith(href + '/'))
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-300 hover:bg-gray-700 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="flex-1">{label}</span>
              {href === '/admin/duplicates' && dupCount != null && dupCount > 0 && (
                <span className="bg-yellow-400 text-yellow-900 text-xs font-bold px-1.5 py-0.5 rounded-full">
                  {dupCount}
                </span>
              )}
            </Link>
          )
        })}
      </nav>
      <div className="p-4 border-t border-gray-700 text-xs text-gray-500">
        PillSeek Admin v2.0
      </div>
    </aside>
  )
}
