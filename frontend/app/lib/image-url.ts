type ImageValue = string | { url?: string | null } | null | undefined

type PillImageLike = {
  image_url?: string | null
  images?: ImageValue[]
}

function normalizeImageUrl(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export function resolveImageUrls(pill: PillImageLike): string[] {
  const urls: string[] = []
  const seen = new Set<string>()
  const addUrl = (url: string | null) => {
    if (!url || seen.has(url)) return
    seen.add(url)
    urls.push(url)
  }

  addUrl(normalizeImageUrl(pill.image_url))

  if (!Array.isArray(pill.images)) return urls

  for (const image of pill.images) {
    if (typeof image === 'string') {
      addUrl(normalizeImageUrl(image))
      continue
    }
    if (image && typeof image === 'object' && 'url' in image) {
      addUrl(normalizeImageUrl(image.url))
    }
  }

  return urls
}

export function resolveImageUrl(pill: PillImageLike): string {
  return resolveImageUrls(pill)[0] || ''
}
