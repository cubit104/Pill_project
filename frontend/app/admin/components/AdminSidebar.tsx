'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Pill, FileEdit, Trash2, ScrollText, Users, Settings } from 'lucide-react'
import { createClient } from '../lib/supabase'

const baseNavItems = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/pills', label: 'Pills', icon: Pill },
  { href: '/admin/drafts', label: 'Drafts', icon: FileEdit },
  { href: '/admin/trash', label: 'Trash', icon: Trash2 },
  { href: '/admin/audit', label: 'Audit Log', icon: ScrollText },
]

const superadminNavItems = [
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
]

export default function AdminSidebar() {
  const pathname = usePathname()
  const [isSuperadmin, setIsSuperadmin] = useState(false)

  useEffect(() => {
    const checkRole = async () => {
      try {
        const supabase = createClient()
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (!session) return
        const res = await fetch('/api/admin/me', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (res.ok) {
          const data = await res.json()
          setIsSuperadmin(data.role === 'superadmin')
        }
      } catch (err) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Failed to check admin role:', err)
        }
        // silently fail — sidebar still renders without superadmin items
      }
    }
    checkRole()
  }, [])

  const navItems = isSuperadmin ? [...baseNavItems, ...superadminNavItems] : baseNavItems

  return (
    <aside className="w-64 bg-gray-900 text-white flex flex-col h-full shrink-0">
      <div className="p-4 border-b border-gray-700">
        <h1 className="text-xl font-bold text-white">💊 PillSeek Admin</h1>
      </div>
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive =
            pathname === href || (href !== '/admin' && pathname.startsWith(href))
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
              {label}
            </Link>
          )
        })}
      </nav>
      <div className="p-4 border-t border-gray-700 text-xs text-gray-500">
        PillSeek Admin v1.0
      </div>
    </aside>
  )
}
