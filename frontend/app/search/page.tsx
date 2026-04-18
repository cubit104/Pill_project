import type { Metadata } from 'next'
import SearchClient from './SearchClient'

export const metadata: Metadata = {
  title: 'Search Pills by Imprint, Color & Shape',
  description:
    'Search and identify pills by imprint code, drug name, color, shape, or NDC number. Free pill identification tool powered by FDA data.',
  alternates: { canonical: '/search' },
  robots: { index: false, follow: true },
}

export default function SearchPage() {
  return <SearchClient />
}

