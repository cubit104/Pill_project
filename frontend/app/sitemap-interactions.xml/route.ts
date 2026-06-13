const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com').replace(/\/$/, '')

type InteractionSlugEntry = {
  slug: string
  drug_name: string
  has_drug_interactions: boolean
  has_food_interactions: boolean
  has_disease_interactions: boolean
}

function buildXml(urls: string[]): string {
  const urlEntries = urls
    .map(
      (url) =>
        `  <url><loc>${url}</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>`
    )
    .join('\n')

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    (urlEntries ? `${urlEntries}\n` : '') +
    '</urlset>'
  )
}

export async function GET() {
  try {
    const interactionSlugRes = await fetch(`${API_BASE}/api/slugs/interactions`, {
      next: { revalidate: 86400 },
    })
    if (!interactionSlugRes.ok) {
      console.error(
        `[sitemap-interactions] Failed to fetch interaction slugs from backend: ${interactionSlugRes.status} ${interactionSlugRes.statusText}`
      )
      throw new Error(
        `Failed to fetch interaction slugs: ${interactionSlugRes.status} ${interactionSlugRes.statusText}`
      )
    }

    const interactionSlugs: InteractionSlugEntry[] = await interactionSlugRes.json()
    const urls = interactionSlugs
      .filter((entry) => entry.slug)
      .map((entry) => `${SITE_URL}/pill/${encodeURIComponent(entry.slug)}/interactions`)

    return new Response(buildXml(urls), {
      headers: {
        'Content-Type': 'application/xml',
      },
    })
  } catch (err) {
    console.error('[sitemap-interactions] Failed to fetch data from backend:', err)
    return new Response(buildXml([]), {
      headers: {
        'Content-Type': 'application/xml',
      },
    })
  }
}
