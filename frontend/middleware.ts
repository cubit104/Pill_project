import { NextRequest, NextResponse } from 'next/server'

export function middleware(req: NextRequest) {
  const adminEnabled = process.env.NEXT_PUBLIC_ENABLE_ADMIN === 'true'
  const { pathname } = req.nextUrl

  if (adminEnabled) {
    // Admin-only domain: allow admin routes and API through unchanged
    if (pathname.startsWith('/admin') || pathname.startsWith('/api')) {
      return NextResponse.next()
    }
    // Redirect all other paths (/, /search, /pill/*, etc.) to admin login
    return NextResponse.redirect(new URL('/admin/login', req.url))
  }

  // Public domain: block /admin/* with a 404 rewrite
  if (pathname.startsWith('/admin')) {
    return NextResponse.rewrite(new URL('/not-found', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    // Match everything except _next internals and static assets
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|txt|xml)$).*)',
  ],
}
