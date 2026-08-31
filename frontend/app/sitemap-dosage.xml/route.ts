const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com').replace(/\/$/, '')

type GuidePageSlug = {
  slug: string
  has_dosage: boolean
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function buildXml(urls: string[]): string {
  const urlEntries = urls
    .map(
      (url) =>
        `  <url><loc>${xmlEscape(url)}</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>`
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
    const slugRes = await fetch(`${API_BASE}/api/slugs/guide-pages`, { next: { revalidate: 86400 } })
    if (!slugRes.ok) {
      console.error(
        `[sitemap-dosage] Failed to fetch guide page slugs from backend: ${slugRes.status} ${slugRes.statusText}`
      )
      throw new Error(`Failed to fetch guide page slugs: ${slugRes.status} ${slugRes.statusText}`)
    }

    const slugs: GuidePageSlug[] = await slugRes.json()
    const urls = slugs
      .filter((entry) => entry.slug && entry.has_dosage)
      .map((entry) => `${SITE_URL}/pill/${encodeURIComponent(entry.slug)}/dosage`)

    return new Response(buildXml(urls), {
      headers: {
        'Content-Type': 'application/xml',
      },
    })
  } catch (err) {
    console.error('[sitemap-dosage] Failed to fetch data from backend:', err)
    return new Response(buildXml([]), {
      headers: {
        'Content-Type': 'application/xml',
      },
    })
  }
}
