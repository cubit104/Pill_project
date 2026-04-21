import AdminSidebar from './components/AdminSidebar'
import AdminTopBar from './components/AdminTopBar'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Admin — PillSeek',
  robots: { index: false, follow: false },
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <AdminSidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <AdminTopBar />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  )
}
