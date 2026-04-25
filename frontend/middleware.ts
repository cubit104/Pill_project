import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { slugify } from './app/lib/slugify'

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl
  const m = pathname.match(/^\/(drug|color|shape|imprint)\/(.+)$/)
  if (!m) return NextResponse.next()

  const [, section, rawSeg] = m
  const decoded = decodeURIComponent(rawSeg)
  const slugged = slugify(decoded)

  if (slugged && slugged !== rawSeg) {
    const url = req.nextUrl.clone()
    url.pathname = `/${section}/${slugged}`
    url.search = search
    return NextResponse.redirect(url, 301)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/drug/:path*', '/color/:path*', '/shape/:path*', '/imprint/:path*'],
}
