import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'

export const dynamic = 'force-dynamic'

/**
 * On-demand ISR revalidation.
 *
 * Call this after publishing an admin edit so the public page picks up the
 * change immediately instead of waiting for the next revalidate window.
 *
 *   POST /api/revalidate?path=/pill/acyclovir-400-mg&secret=<REVALIDATE_SECRET>
 *
 * Set REVALIDATE_SECRET in Vercel env. Without it, all requests are refused.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.REVALIDATE_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: 'Revalidation disabled (REVALIDATE_SECRET not configured)' },
      { status: 503 }
    )
  }

  const url = new URL(req.url)
  const provided = url.searchParams.get('secret')
  if (provided !== secret) {
    return NextResponse.json({ error: 'Invalid secret' }, { status: 401 })
  }

  const path = url.searchParams.get('path')
  if (!path || !path.startsWith('/')) {
    return NextResponse.json(
      { error: "Missing or invalid 'path' query param (must start with '/')" },
      { status: 400 }
    )
  }

  try {
    revalidatePath(path)
    return NextResponse.json({ revalidated: true, path, now: Date.now() })
  } catch (e) {
    return NextResponse.json(
      { error: `Revalidation failed: ${String(e)}` },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  // Convenience: allow GET with same params for easy curl/browser testing.
  return POST(req)
}
