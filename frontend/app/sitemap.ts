import type { MetadataRoute } from 'next'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://idmypills.com'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: `${SITE_URL}/`,
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${SITE_URL}/search`,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
  ]

  try {
    const res = await fetch(`${API_BASE}/api/slugs`, { next: { revalidate: 86400 } })
    if (!res.ok) throw new Error(`Failed to fetch slugs: ${res.status}`)
    const slugs: string[] = await res.json()
    const pillPages: MetadataRoute.Sitemap = slugs.map((slug) => ({
      url: `${SITE_URL}/pill/${encodeURIComponent(slug)}`,
      changeFrequency: 'monthly',
      priority: 0.8,
    }))
    return [...staticPages, ...pillPages]
  } catch (err) {
    // Return static pages only if slugs endpoint is unavailable
    console.error('[sitemap] Failed to fetch slugs from backend:', err)
    return staticPages
  }
}
