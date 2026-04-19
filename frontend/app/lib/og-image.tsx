import { ImageResponse } from 'next/og'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const size = { width: 1200, height: 630 }

// Read the SVG once at module load time so every request reuses the cached data URI.
const svgDataUri = (() => {
  const svgPath = join(process.cwd(), 'public', 'logo-mark.svg')
  const svgContents = readFileSync(svgPath, 'utf8')
  return `data:image/svg+xml;base64,${Buffer.from(svgContents).toString('base64')}`
})()

export function buildOgImageResponse(opts?: { subtitle?: string }) {
  const subtitle = opts?.subtitle ?? 'Free Pill Identifier by Imprint, Drug Name, NDC, Color & Shape'

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        {/* Real logo mark */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={svgDataUri} width="220" height="220" style={{ marginBottom: 40 }} alt="" />

        {/* Brand name */}
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            fontSize: 108,
            fontWeight: 700,
            color: 'white',
            letterSpacing: '-0.02em',
          }}
        >
          <span>Pill</span>
          <span style={{ color: '#34d399' }}>Seek</span>
        </div>

        {/* Tagline */}
        <div
          style={{
            marginTop: 24,
            fontSize: 30,
            color: '#cbd5e1',
            textAlign: 'center',
            padding: '0 80px',
            display: 'flex',
          }}
        >
          {subtitle}
        </div>

        {/* Sub-line */}
        <div
          style={{
            marginTop: 40,
            fontSize: 22,
            color: '#64748b',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', display: 'flex' }} />
          Powered by FDA &amp; DailyMed Data
        </div>
      </div>
    ),
    { ...size }
  )
}
