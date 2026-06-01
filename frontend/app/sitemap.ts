import type { MetadataRoute } from 'next'

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
      url: `${SITE_URL}/sources`,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
  ]

  try {
    const [slugRes, classRes, guideSlugRes] = await Promise.all([
      fetch(`${API_BASE}/api/slugs`, { next: { revalidate: 86400 } }),
      fetch(`${API_BASE}/api/classes`, { next: { revalidate: 86400 } }),
      fetch(`${API_BASE}/api/slugs/guide-pages`, { next: { revalidate: 86400 } }),
    ])

    if (!slugRes.ok) {
      console.error(
        `[sitemap] Failed to fetch slugs from backend: ${slugRes.status} ${slugRes.statusText}`
      )
      throw new Error(`Failed to fetch slugs: ${slugRes.status} ${slugRes.statusText}`)
    }

    const slugs: string[] = await slugRes.json()
    type GuideSlugEntry = {
      slug: string
      has_medguide: boolean
      has_professional: boolean
      has_medication_summary: boolean
      has_dosage?: boolean
      has_adverse_reactions?: boolean
    }
    const guideSlugs: GuideSlugEntry[] = guideSlugRes.ok
      ? await guideSlugRes.json()
      : []

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

    const medicationGuidePages: MetadataRoute.Sitemap = guideSlugs
      .filter((entry) => entry.slug && entry.has_medguide)
      .map((entry) => ({
        url: `${SITE_URL}/pill/${encodeURIComponent(entry.slug)}/medication-guide`,
        changeFrequency: 'monthly' as const,
        priority: 0.7,
      }))

    const professionalInfoPages: MetadataRoute.Sitemap = guideSlugs
      .filter((entry) => entry.slug && entry.has_professional)
      .map((entry) => ({
        url: `${SITE_URL}/pill/${encodeURIComponent(entry.slug)}/professional-information`,
        changeFrequency: 'monthly' as const,
        priority: 0.7,
      }))

    const medicationSummaryPages: MetadataRoute.Sitemap = guideSlugs
      .filter((entry) => entry.slug && entry.has_medication_summary && !entry.has_medguide)
      .map((entry) => ({
        url: `${SITE_URL}/pill/${encodeURIComponent(entry.slug)}/medication-summary`,
        changeFrequency: 'monthly' as const,
        priority: 0.7,
      }))

    const dosagePages: MetadataRoute.Sitemap = guideSlugs
      .filter((entry) => entry.slug && entry.has_dosage)
      .map((entry) => ({
        url: `${SITE_URL}/pill/${encodeURIComponent(entry.slug)}/dosage`,
        changeFrequency: 'monthly' as const,
        priority: 0.7,
      }))

    const adverseReactionsPages: MetadataRoute.Sitemap = guideSlugs
      .filter((entry) => entry.slug && entry.has_adverse_reactions)
      .map((entry) => ({
        url: `${SITE_URL}/pill/${encodeURIComponent(entry.slug)}/adverse-reactions`,
        changeFrequency: 'monthly' as const,
        priority: 0.7,
      }))

    return [
      ...staticPages,
      ...pillPages,
      ...medicationGuidePages,
      ...professionalInfoPages,
      ...medicationSummaryPages,
      ...dosagePages,
      ...adverseReactionsPages,
      ...classPages,
    ]
  } catch (err) {
    console.error('[sitemap] Failed to fetch data from backend:', err)
    return staticPages
  }
}
