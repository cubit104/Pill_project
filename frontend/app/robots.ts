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
        disallow: [
          '/api/',
          '/admin/',
          // Disallow search result URLs with query params — these are not ranking surfaces
          '/search?*',
        ],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  }
}
