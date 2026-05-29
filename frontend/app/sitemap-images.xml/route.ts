const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com').replace(/\/$/, '')

type SlugImagesEntry = {
  slug: string
  images: string[]
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function buildXml(entries: SlugImagesEntry[]): string {
  const urlEntries = entries
    .map((entry) => {
      const loc = `${SITE_URL}/pill/${encodeURIComponent(entry.slug)}`
      const images = entry.images
        .map((imageUrl) => `    <image:image><image:loc>${xmlEscape(imageUrl)}</image:loc></image:image>`)
        .join('\n')
      return `  <url>\n    <loc>${xmlEscape(loc)}</loc>\n${images}\n  </url>`
    })
    .join('\n')

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n' +
    (urlEntries ? `${urlEntries}\n` : '') +
    '</urlset>'
  )
}

export async function GET() {
  try {
    const slugRes = await fetch(`${API_BASE}/api/slugs/images`, { next: { revalidate: 86400 } })
    if (!slugRes.ok) {
      console.error(
        `[sitemap-images] Failed to fetch slug image data from backend: ${slugRes.status} ${slugRes.statusText}`
      )
      throw new Error(`Failed to fetch slug images: ${slugRes.status} ${slugRes.statusText}`)
    }

    const payload: SlugImagesEntry[] = await slugRes.json()
    const entries = payload.filter((entry) => entry.slug && Array.isArray(entry.images) && entry.images.length > 0)

    return new Response(buildXml(entries), {
      headers: {
        'Content-Type': 'application/xml',
      },
    })
  } catch (err) {
    console.error('[sitemap-images] Failed to fetch data from backend:', err)
    return new Response(buildXml([]), {
      headers: {
        'Content-Type': 'application/xml',
      },
    })
  }
}
