import { NextRequest, NextResponse } from 'next/server'

export function middleware(req: NextRequest) {
  const isAdminEnabled = process.env.NEXT_PUBLIC_ENABLE_ADMIN === 'true'
  if (!isAdminEnabled && req.nextUrl.pathname.startsWith('/admin')) {
    return NextResponse.rewrite(new URL('/not-found', req.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*'],
}
