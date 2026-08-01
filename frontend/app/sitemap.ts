import type { MetadataRoute } from 'next'
import { slugifyDrugName } from './lib/slug'
import { slugifyUrl } from './lib/url-utils'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com').replace(/\/$/, '')

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
    const [slugRes, classRes, drugRes, drugPriceRes, conditionRes, filterRes] = await Promise.all([
      fetch(`${API_BASE}/api/slugs`, { next: { revalidate: 86400 } }),
      fetch(`${API_BASE}/api/classes`, { next: { revalidate: 86400 } }),
      fetch(`${API_BASE}/api/slugs/drugs`, { next: { revalidate: 86400 } }),
      fetch(`${API_BASE}/api/slugs/drug-prices`, { next: { revalidate: 86400 } }),
      fetch(`${API_BASE}/api/conditions`, { next: { revalidate: 86400 } }),
      fetch(`${API_BASE}/filters`, { next: { revalidate: 86400 } }),
    ])

    if (!slugRes.ok) {
      console.error(
        `[sitemap] Failed to fetch slugs from backend: ${slugRes.status} ${slugRes.statusText}`
      )
      throw new Error(`Failed to fetch slugs: ${slugRes.status} ${slugRes.statusText}`)
    }

    const slugs: string[] = await slugRes.json()
    const drugSlugs: Array<{ drug_name: string }> = drugRes.ok
      ? await drugRes.json()
      : []
    const drugPriceSlugs: Array<{ drug_name: string }> = drugPriceRes.ok
      ? await drugPriceRes.json()
      : []
    const conditionPayload: { conditions?: Array<{ slug: string }> } = conditionRes.ok
      ? await conditionRes.json()
      : {}
    const filtersPayload: {
      colors?: Array<{ name: string }>
      shapes?: Array<{ name: string }>
    } = filterRes.ok
      ? await filterRes.json()
      : {}

    let classes: Array<{ slug: string }> = []
    if (!classRes.ok) {
      console.error(
        `[sitemap] Failed to fetch classes from backend: ${classRes.status} ${classRes.statusText}`
      )
    } else {
      classes = await classRes.json()
    }

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

    const colorPages: MetadataRoute.Sitemap = (filtersPayload.colors ?? [])
      .map((color) => slugifyUrl(color.name))
      .filter(Boolean)
      .map((slug) => ({
        url: `${SITE_URL}/color/${slug}`,
        changeFrequency: 'weekly' as const,
        priority: 0.5,
      }))

    const shapePages: MetadataRoute.Sitemap = (filtersPayload.shapes ?? [])
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
