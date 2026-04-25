import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { slugify } from './app/lib/slugify'

// Canonical slug: lowercase alphanumerics separated by single hyphens,
// no leading/trailing hyphens, no consecutive hyphens.
const CANONICAL_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl
  const m = pathname.match(/^\/(drug|color|shape|imprint)\/([^/]+)\/?$/)
  if (!m) return NextResponse.next()

  const [, section, rawSeg] = m

  // Fast-path: if the segment is ALREADY in canonical slug form, do nothing.
  // This is what prevents redirect loops — we never compare against a
  // freshly-slugified value (which can differ from what Next.js puts back
  // into the URL after the redirect due to URL normalization quirks).
  if (CANONICAL_SLUG.test(rawSeg)) {
    return NextResponse.next()
  }

  // Otherwise, slugify and redirect once.
  let decoded = rawSeg
  try {
    decoded = decodeURIComponent(rawSeg)
  } catch {
    // leave as-is if malformed
  }
  const slugged = slugify(decoded)

  // If slugify produced nothing usable, bail out rather than redirect to
  // an empty path (which would 404 or loop).
  if (!slugged) {
    return NextResponse.next()
  }

  const url = req.nextUrl.clone()
  url.pathname = `/${section}/${slugged}`
  url.search = search
  return NextResponse.redirect(url, 301)
}

export const config = {
  matcher: ['/drug/:path*', '/color/:path*', '/shape/:path*', '/imprint/:path*'],
}
