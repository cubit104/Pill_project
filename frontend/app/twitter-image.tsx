import { buildOgImageResponse, size as ogSize } from './lib/og-image'

export const runtime = 'edge'

export const alt =
  'PillSeek — Free Pill Identifier by Imprint, Drug Name, NDC, Color & Shape'

export const size = ogSize

export const contentType = 'image/png'

export default function TwitterImage() {
  return buildOgImageResponse()
}
