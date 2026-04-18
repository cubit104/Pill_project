import type { Metadata } from 'next'
import './globals.css'
import Header from './components/Header'
import Footer from './components/Footer'

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com'
).replace(/\/$/, '')

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'PillSeek — Free Pill Identifier by Imprint, Color & Shape',
    template: '%s | PillSeek',
  },
  description:
    'Identify any pill by imprint code, color, shape, or drug name. Free medication lookup tool powered by FDA data — trusted by patients and caregivers.',
  keywords:
    'pill identifier, medication identification, imprint code, drug lookup, pill finder, identify pill by imprint',
  authors: [{ name: 'PillSeek' }],
  creator: 'PillSeek',
  publisher: 'PillSeek',
  robots: { index: true, follow: true },
  openGraph: {
    type: 'website',
    siteName: 'PillSeek',
    title: 'PillSeek — Free Pill Identifier by Imprint, Color & Shape',
    description:
      'Identify any pill by imprint code, color, shape, or drug name. Free medication lookup tool powered by FDA data.',
    url: SITE_URL,
    images: [{ url: `${SITE_URL}/og-image.png`, width: 1200, height: 630, alt: 'PillSeek logo' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PillSeek — Free Pill Identifier by Imprint, Color & Shape',
    description:
      'Identify any pill by imprint code, color, shape, or drug name. Powered by FDA data.',
    images: [`${SITE_URL}/og-image.png`],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="bg-slate-50 text-slate-900 antialiased min-h-screen flex flex-col font-sans">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  )
}
