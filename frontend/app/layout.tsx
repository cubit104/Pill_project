import type { Metadata, Viewport } from 'next'
import './globals.css'
import Header from './components/Header'
import Footer from './components/Footer'

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com'
).replace(/\/$/, '')

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#047857',
}

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'PillSeek — Free Pill Identifier by Imprint, Drug Name, NDC, Color & Shape',
    template: '%s | PillSeek',
  },
  description:
    'Identify any pill free using imprint codes, drug name, NDC number, color, or shape. Free medication lookup tool powered by FDA data — trusted by patients and caregivers.',
  authors: [{ name: 'PillSeek' }],
  creator: 'PillSeek',
  publisher: 'PillSeek',
  robots: { index: true, follow: true },
  openGraph: {
    type: 'website',
    siteName: 'PillSeek',
    title: 'PillSeek — Free Pill Identifier by Imprint, Drug Name, NDC, Color & Shape',
    description:
      'Identify any pill free using imprint codes, drug name, NDC number, color, or shape. Free medication lookup tool powered by FDA data.',
    url: SITE_URL,
    images: [{ url: `${SITE_URL}/icon.png`, width: 512, height: 512, alt: 'PillSeek logo' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PillSeek — Free Pill Identifier by Imprint, Drug Name, NDC, Color & Shape',
    description:
      'Identify any pill free using imprint codes, drug name, NDC number, color, or shape. Powered by FDA data.',
    images: [`${SITE_URL}/icon.png`],
    site: '@pillseek',
    creator: '@pillseek',
  },
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || '',
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
