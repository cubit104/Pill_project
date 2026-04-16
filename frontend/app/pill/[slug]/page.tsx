import PillDetailClient from './PillDetailClient'

export function generateStaticParams() {
  return [{ slug: '__placeholder__' }]
}

export default function PillDetailPage() {
  return <PillDetailClient />
}
