import { NextRequest, NextResponse } from 'next/server'

// Known bad bot user agents
const BAD_BOTS = [
  'python-requests',
  'go-http-client',
  'curl/',
  'wget/',
  'scrapy',
  'aiohttp',
  'httpx',
  'axios',
  'java/',
  'petalbot',
  'semrushbot',
  'ahrefsbot',
  'mj12bot',
  'dotbot',
  'blexbot',
  'zgrab',
]

// In-memory rate limit store (per IP, resets on redeploy)
const rateLimitMap = new Map<string, { count: number; ts: number }>()
const RATE_LIMIT = 60        // max requests
const RATE_WINDOW = 60_000   // per 60 seconds

function getIP(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  )
}

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now - entry.ts > RATE_WINDOW) {
    rateLimitMap.set(ip, { count: 1, ts: now })
    return false
  }
  entry.count++
  if (entry.count > RATE_LIMIT) return true
  return false
}

export function middleware(req: NextRequest) {
  const adminEnabled = process.env.NEXT_PUBLIC_ENABLE_ADMIN === 'true'
  const { pathname } = req.nextUrl
  const ua = (req.headers.get('user-agent') || '').toLowerCase()

  // Block known bad bots immediately
  for (const bot of BAD_BOTS) {
    if (ua.includes(bot)) {
      return new NextResponse('Forbidden', { status: 403 })
    }
  }

  // Block requests with no user agent (headless scrapers)
  if (!ua || ua.trim() === '') {
    return new NextResponse('Forbidden', { status: 403 })
  }

  // Rate limit per IP on pill/drug/imprint pages
  if (
    pathname.startsWith('/pill/') ||
    pathname.startsWith('/drug/') ||
    pathname.startsWith('/imprint/') ||
    pathname.startsWith('/api/')
  ) {
    const ip = getIP(req)
    if (isRateLimited(ip)) {
      return new NextResponse('Too Many Requests', {
        status: 429,
        headers: { 'Retry-After': '60' },
      })
    }
  }

  if (adminEnabled) {
    if (pathname.startsWith('/admin') || pathname.startsWith('/api')) {
      return NextResponse.next()
    }
    return NextResponse.redirect(new URL('/admin/login', req.url))
  }

  if (pathname.startsWith('/admin')) {
    return NextResponse.rewrite(new URL('/not-found', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|avif|ico|txt|xml)$).*)',
  ],
}
