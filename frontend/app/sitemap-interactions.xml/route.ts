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
  return new Response(buildXml([]), {
    headers: {
      'Content-Type': 'application/xml',
    },
  })
}
