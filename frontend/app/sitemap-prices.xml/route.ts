const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com').replace(/\/$/, '')

function buildXml(urls: string[]): string {
  const urlEntries = urls
    .map(
      (url) =>
        `  <url><loc>${url}</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>`
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
    const slugRes = await fetch(`${API_BASE}/api/slugs`, { next: { revalidate: 86400 } })
    if (!slugRes.ok) {
      console.error(
        `[sitemap-prices] Failed to fetch slugs from backend: ${slugRes.status} ${slugRes.statusText}`
      )
      throw new Error(`Failed to fetch slugs: ${slugRes.status} ${slugRes.statusText}`)
    }

    const slugs: string[] = await slugRes.json()
    const urls = slugs.map(
      (slug) => `${SITE_URL}/pill/${encodeURIComponent(slug)}/price`
    )

    return new Response(buildXml(urls), {
      headers: {
        'Content-Type': 'application/xml',
      },
    })
  } catch (err) {
    console.error('[sitemap-prices] Failed to fetch data from backend:', err)
    return new Response(buildXml([]), {
      headers: {
        'Content-Type': 'application/xml',
      },
    })
  }
}
