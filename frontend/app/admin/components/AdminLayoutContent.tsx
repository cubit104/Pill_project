'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import AdminSidebar from './AdminSidebar'
import AdminTopBar from './AdminTopBar'

const AUTH_PATHS = ['/admin/login', '/admin/reset-password', '/admin/auth/callback']

export default function AdminLayoutContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const isAuthPage = AUTH_PATHS.some(p => pathname?.startsWith(p))

  if (isAuthPage) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center">
        {children}
      </main>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex flex-col flex-1 overflow-hidden">
        <AdminTopBar onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  )
}
