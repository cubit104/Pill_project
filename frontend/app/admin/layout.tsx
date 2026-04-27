import AdminLayoutContent from './components/AdminLayoutContent'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Admin — PillSeek',
  robots: { index: false, follow: false },
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminLayoutContent>{children}</AdminLayoutContent>
}
