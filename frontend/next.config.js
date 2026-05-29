/** @type {import('next').NextConfig} */
const nextConfig = {
  // No trailing slash — URLs are /pill/slug not /pill/slug/
  // Consistent with canonical tags, sitemap, and OG URLs
  trailingSlash: false,

  // Inline critical CSS, defer the rest → eliminates the 408ms blocking CSS chain
  experimental: {
    optimizeCss: true,
  },

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'uqdwcxizabmxwflkbfrb.supabase.co',
        pathname: '/storage/v1/object/public/images/**',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/images/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
    ]
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
