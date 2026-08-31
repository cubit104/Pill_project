import type { MetadataRoute } from 'next'
import { slugifyDrugName } from './lib/slug'
import { slugifyUrl } from './lib/url-utils'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com').replace(/\/$/, '')

async function fetchSitemapJson<T>(label: string, url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url, { next: { revalidate: 86400 } })
    if (!res.ok) {
      console.error(`[sitemap] Failed to fetch ${label} from backend: ${res.status} ${res.statusText}`)
      return fallback
    }
    return (await res.json()) as T
  } catch (err) {
    console.error(`[sitemap] Failed to fetch ${label} from backend:`, err)
    return fallback
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Static pages — no trailing slash, consistent with next.config.js trailingSlash: false
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
      url: `${SITE_URL}/condition`,
      changeFrequency: 'weekly',
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/interactions`,
      changeFrequency: 'weekly',
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/sources`,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
  ]

  try {
    const [slugs, classes, drugSlugs, drugPriceSlugs, conditionPayload, colorSlugs, shapeSlugs] = await Promise.all([
      fetchSitemapJson<string[]>('slugs', `${API_BASE}/api/slugs`, []),
      fetchSitemapJson<Array<{ slug: string }>>('classes', `${API_BASE}/api/classes`, []),
      fetchSitemapJson<Array<{ drug_name: string }>>('drug slugs', `${API_BASE}/api/slugs/drugs`, []),
      fetchSitemapJson<Array<{ drug_name: string }>>('drug price slugs', `${API_BASE}/api/slugs/drug-prices`, []),
      fetchSitemapJson<{ conditions?: Array<{ slug: string }> }>('conditions', `${API_BASE}/api/conditions`, {
        conditions: [],
      }),
      fetchSitemapJson<Array<{ name: string }>>('color slugs', `${API_BASE}/api/slugs/colors`, []),
      fetchSitemapJson<Array<{ name: string }>>('shape slugs', `${API_BASE}/api/slugs/shapes`, []),
    ])

    // No trailing slash — matches actual browser URLs and canonical tags
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

    const drugPages: MetadataRoute.Sitemap = drugSlugs
      .map((entry) => slugifyDrugName(entry.drug_name))
      .filter(Boolean)
      .map((slug) => ({
        url: `${SITE_URL}/drug/${slug}`,
        changeFrequency: 'weekly' as const,
        priority: 0.7,
      }))

    const drugPricePages: MetadataRoute.Sitemap = drugPriceSlugs
      .map((entry) => slugifyDrugName(entry.drug_name))
      .filter(Boolean)
      .map((slug) => ({
        url: `${SITE_URL}/drug/${slug}/price`,
        changeFrequency: 'weekly' as const,
        priority: 0.7,
      }))

    const conditionPages: MetadataRoute.Sitemap = (conditionPayload.conditions ?? [])
      .filter((condition) => condition.slug)
      .map((condition) => ({
        url: `${SITE_URL}/condition/${encodeURIComponent(condition.slug)}`,
        changeFrequency: 'weekly' as const,
        priority: 0.6,
      }))

    const colorPages: MetadataRoute.Sitemap = colorSlugs
      .map((color) => slugifyUrl(color.name))
      .filter(Boolean)
      .map((slug) => ({
        url: `${SITE_URL}/color/${slug}`,
        changeFrequency: 'weekly' as const,
        priority: 0.5,
      }))

    const shapePages: MetadataRoute.Sitemap = shapeSlugs
      .map((shape) => slugifyUrl(shape.name))
      .filter(Boolean)
      .map((slug) => ({
        url: `${SITE_URL}/shape/${slug}`,
        changeFrequency: 'weekly' as const,
        priority: 0.5,
      }))

    const urls = [
      ...staticPages,
      ...pillPages,
      ...drugPages,
      ...drugPricePages,
      ...classPages,
      ...conditionPages,
      ...colorPages,
      ...shapePages,
    ]

    const deduped = new Map<string, MetadataRoute.Sitemap[number]>()
    for (const entry of urls) {
      deduped.set(entry.url, entry)
    }

    return Array.from(deduped.values())
  } catch (err) {
    console.error('[sitemap] Failed to fetch data from backend:', err)
    return staticPages
  }
}
