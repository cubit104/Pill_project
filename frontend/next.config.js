/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'uqdwcxizabmxwflkbfrb.supabase.co',
        pathname: '/storage/v1/object/public/images/**',
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
