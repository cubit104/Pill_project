const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com').replace(/\/$/, '')

type GuideSlugEntry = {
  slug: string
  has_medguide: boolean
  has_professional: boolean
  has_medication_summary: boolean
  has_dosage?: boolean
  has_adverse_reactions?: boolean
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
    const guideSlugRes = await fetch(`${API_BASE}/api/slugs/guide-pages`, {
      next: { revalidate: 86400 },
    })
    if (!guideSlugRes.ok) {
      console.error(
        `[sitemap-adverse-reactions] Failed to fetch guide slugs from backend: ${guideSlugRes.status} ${guideSlugRes.statusText}`
      )
      throw new Error(
        `Failed to fetch guide slugs: ${guideSlugRes.status} ${guideSlugRes.statusText}`
      )
    }

    const guideSlugs: GuideSlugEntry[] = await guideSlugRes.json()
    const urls = guideSlugs
      .filter((entry) => entry.slug && entry.has_adverse_reactions === true)
      .map((entry) => `${SITE_URL}/pill/${encodeURIComponent(entry.slug)}/adverse-reactions`)

    return new Response(buildXml(urls), {
      headers: {
        'Content-Type': 'application/xml',
      },
    })
  } catch (err) {
    console.error('[sitemap-adverse-reactions] Failed to fetch data from backend:', err)
    return new Response(buildXml([]), {
      headers: {
        'Content-Type': 'application/xml',
      },
    })
  }
}
