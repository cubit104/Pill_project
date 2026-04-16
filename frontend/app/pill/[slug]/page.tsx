import PillDetailClient from './PillDetailClient'

export function generateStaticParams() {
  // Static export requires at least one pre-rendered path. We use a placeholder
  // because pill slugs are dynamic and resolved client-side from window.location.
  // The FastAPI backend serves the same HTML shell for any /pill/{slug} path.
  return [{ slug: '__placeholder__' }]
}

export default function PillDetailPage() {
  return <PillDetailClient />
}
