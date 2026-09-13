/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The web dev server proxies API calls to production so `npm run dev` works
// in a browser without CORS issues. Native builds call https://pillseek.com
// directly (see src/lib/api.ts).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    proxy: {
      '/api': { target: 'https://pillseek.com', changeOrigin: true },
      '/filters': { target: 'https://pillseek.com', changeOrigin: true },
      // NPPES NPI Registry has no CORS headers; in a browser the doctor search goes through here.
      '/npi-api': { target: 'https://npiregistry.cms.hhs.gov', changeOrigin: true, rewrite: (p) => p.replace(/^\/npi-api/, '/api') },
    },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
