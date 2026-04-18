import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  const siteUrl = (
    process.env.NEXT_PUBLIC_SITE_URL || 'https://idmypills.com'
  ).replace(/\/$/, '')

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Only disallow paths that should never be crawled.
        // Search result pages (/search?q=...) are handled via page-level
        // `noindex,follow` meta robots — robots.txt query-string patterns
        // are inconsistently supported and would prevent crawlers from
        // honoring the noindex directive.
        disallow: [
          '/api/',
          '/admin/',
        ],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  }
}
