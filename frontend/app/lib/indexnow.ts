export type IndexNowRouteConfig = {
  key: string
  keyLocation: string
  siteUrl: string
  keyFileName: string
}

export function getIndexNowRouteConfig(
  env: NodeJS.ProcessEnv = process.env
): IndexNowRouteConfig | null {
  const key = env.INDEXNOW_KEY?.trim()
  if (!key) {
    return null
  }

  const siteUrl = (env.SITE_URL || env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com').trim().replace(/\/$/, '')
  const keyLocation = env.INDEXNOW_KEY_LOCATION?.trim() || `${siteUrl}/${key}.txt`

  return {
    key,
    keyLocation,
    siteUrl,
    keyFileName: `${key}.txt`,
  }
}

export function buildIndexNowKeyResponse(
  requestedPathSegment: string,
  env: NodeJS.ProcessEnv = process.env
): Response | null {
  const config = getIndexNowRouteConfig(env)
  if (!config || requestedPathSegment !== config.keyFileName) {
    return null
  }

  return new Response(config.key, {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'x-content-type-options': 'nosniff',
    },
  })
}
