import type { Metadata } from 'next'
import './globals.css'
import Header from './components/Header'
import Footer from './components/Footer'

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://idmypills.com'
).replace(/\/$/, '')

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'IDMyPills — Free Pill Identifier by Imprint, Color & Shape',
    template: '%s | IDMyPills',
  },
  description:
    'Identify any pill by imprint code, color, shape, or drug name. Free medication lookup tool powered by FDA data — trusted by patients and caregivers.',
  keywords:
    'pill identifier, medication identification, imprint code, drug lookup, pill finder, identify pill by imprint',
  authors: [{ name: 'IDMyPills' }],
  creator: 'IDMyPills',
  publisher: 'IDMyPills',
  robots: { index: true, follow: true },
  openGraph: {
    type: 'website',
    siteName: 'IDMyPills',
    title: 'IDMyPills — Free Pill Identifier by Imprint, Color & Shape',
    description:
      'Identify any pill by imprint code, color, shape, or drug name. Free medication lookup tool powered by FDA data.',
    url: SITE_URL,
    images: [{ url: `${SITE_URL}/icon.png`, width: 512, height: 512, alt: 'IDMyPills logo' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'IDMyPills — Free Pill Identifier by Imprint, Color & Shape',
    description:
      'Identify any pill by imprint code, color, shape, or drug name. Powered by FDA data.',
    images: [`${SITE_URL}/icon.png`],
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
