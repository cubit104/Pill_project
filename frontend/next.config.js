/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: true,
  images: {
    remotePatterns: [
      // Supabase storage (primary image host)
      {
        protocol: 'https',
        hostname: 'uqdwcxizabmxwflkbfrb.supabase.co',
        pathname: '/storage/v1/object/public/images/**',
      },
      // Render backend (legacy fallback images)
      {
        protocol: 'https',
        hostname: 'pill0project.onrender.com',
        pathname: '/images/**',
      },
      // Own domain (same-origin proxy)
      {
        protocol: 'https',
        hostname: 'pillseek.com',
        pathname: '/images/**',
      },
      {
        protocol: 'https',
        hostname: 'www.pillseek.com',
        pathname: '/images/**',
      },
      // DailyMed image sources
      {
        protocol: 'https',
        hostname: 'www.accessdata.fda.gov',
        pathname: '/spl/data/**',
      },
      {
        protocol: 'https',
        hostname: 'dailymed.nlm.nih.gov',
        pathname: '/dailymed/image.cfm/**',
      },
    ],
  },
  async rewrites() {
    const apiBase = process.env.API_BASE_URL || 'http://localhost:8000'
    return [
      { source: '/api/:path*', destination: `${apiBase}/api/:path*` },
      { source: '/filters', destination: `${apiBase}/filters` },
      { source: '/suggestions', destination: `${apiBase}/suggestions` },
      { source: '/details', destination: `${apiBase}/details` },
      { source: '/health', destination: `${apiBase}/health` },
      { source: '/ndc_lookup', destination: `${apiBase}/ndc_lookup` },
      { source: '/reload-data', destination: `${apiBase}/reload-data` },
    ]
  },
};

module.exports = nextConfig;
