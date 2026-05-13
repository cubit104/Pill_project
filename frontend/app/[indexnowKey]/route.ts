import { buildIndexNowKeyResponse } from '../lib/indexnow'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ indexnowKey: string }>
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { indexnowKey } = await params
  return buildIndexNowKeyResponse(indexnowKey) || new Response('Not Found', { status: 404 })
}
