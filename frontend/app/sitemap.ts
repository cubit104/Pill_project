import type { MetadataRoute } from 'next'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com').replace(/\/$/, '')

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: `${SITE_URL}/`,
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    // /search is noindex,follow — omit from sitemap to avoid mixed signals
    {
      url: `${SITE_URL}/about`,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/contact`,
      changeFrequency: 'monthly',
      priority: 0.4,
    },
    {
      url: `${SITE_URL}/privacy`,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/terms`,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/medical-disclaimer`,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/sources`,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
  ]

  try {
    const [slugRes, classRes, hubRes] = await Promise.all([
      fetch(`${API_BASE}/api/slugs`, { next: { revalidate: 86400 } }),
      fetch(`${API_BASE}/api/classes`, { next: { revalidate: 86400 } }),
      fetch(`${API_BASE}/api/hub-slugs`, { next: { revalidate: 86400 } }),
    ])

    if (!slugRes.ok) {
      console.error(
        `[sitemap] Failed to fetch slugs from backend: ${slugRes.status} ${slugRes.statusText}`
      )
      throw new Error(`Failed to fetch slugs: ${slugRes.status} ${slugRes.statusText}`)
    }

    const slugs: string[] = await slugRes.json()

    let classes: Array<{ slug: string }> = []
    if (!classRes.ok) {
      console.error(
        `[sitemap] Failed to fetch classes from backend: ${classRes.status} ${classRes.statusText}`
      )
    } else {
      classes = await classRes.json()
    }

    let hubSlugs: { drugs: string[]; colors: string[]; shapes: string[]; imprints: string[] } = {
      drugs: [],
      colors: [],
      shapes: [],
      imprints: [],
    }
    if (!hubRes.ok) {
      console.error(
        `[sitemap] Failed to fetch hub slugs from backend: ${hubRes.status} ${hubRes.statusText}`
      )
    } else {
      hubSlugs = await hubRes.json()
    }

    const pillPages: MetadataRoute.Sitemap = slugs.map((slug) => ({
      url: `${SITE_URL}/pill/${encodeURIComponent(slug)}`,
      changeFrequency: 'monthly',
      priority: 0.8,
    }))

    const classPages: MetadataRoute.Sitemap = classes.map((c) => ({
      url: `${SITE_URL}/class/${encodeURIComponent(c.slug)}`,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    }))

    const hubPages: MetadataRoute.Sitemap = [
      ...hubSlugs.drugs.map((s) => ({
        url: `${SITE_URL}/drug/${s}`,
        changeFrequency: 'weekly' as const,
        priority: 0.7,
      })),
      ...hubSlugs.colors.map((s) => ({
        url: `${SITE_URL}/color/${s}`,
        changeFrequency: 'weekly' as const,
        priority: 0.7,
      })),
      ...hubSlugs.shapes.map((s) => ({
        url: `${SITE_URL}/shape/${s}`,
        changeFrequency: 'weekly' as const,
        priority: 0.7,
      })),
      ...hubSlugs.imprints.map((s) => ({
        url: `${SITE_URL}/imprint/${s}`,
        changeFrequency: 'weekly' as const,
        priority: 0.7,
      })),
    ]

    return [...staticPages, ...pillPages, ...classPages, ...hubPages]
  } catch (err) {
    // Return static pages only if endpoints are unavailable
    console.error('[sitemap] Failed to fetch data from backend:', err)
    return staticPages
  }
}
