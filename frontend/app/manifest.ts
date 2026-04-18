import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'PillSeek',
    short_name: 'PillSeek',
    description: 'Free Pill Identifier by Imprint, Color & Shape',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#2f7d4f',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  }
}
