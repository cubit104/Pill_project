import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export const alt =
  'PillSeek — Free Pill Identifier by Imprint, Drug Name, NDC, Color & Shape'

export const size = {
  width: 1200,
  height: 630,
}

export const contentType = 'image/png'

export default async function TwitterImage() {
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
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #0f2a1e 100%)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        {/* Top accent bar */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 8,
            background: 'linear-gradient(90deg, #047857, #10b981)',
            display: 'flex',
          }}
        />

        {/* Logo mark — simplified pill icon */}
        <div
          style={{
            width: 120,
            height: 120,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #047857, #10b981)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 40,
            boxShadow: '0 0 60px rgba(16,185,129,0.4)',
          }}
        >
          {/* Pill capsule shape */}
          <div
            style={{
              width: 72,
              height: 34,
              borderRadius: 17,
              background: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: 4,
                bottom: 4,
                width: 2,
                background: '#047857',
                display: 'flex',
              }}
            />
          </div>
        </div>

        {/* Brand name */}
        <div
          style={{
            fontSize: 80,
            fontWeight: 800,
            color: 'white',
            letterSpacing: '-2px',
            lineHeight: 1,
            marginBottom: 24,
            display: 'flex',
          }}
        >
          Pill
          <span style={{ color: '#10b981' }}>Seek</span>
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize: 28,
            color: '#94a3b8',
            textAlign: 'center',
            maxWidth: 860,
            lineHeight: 1.4,
            marginBottom: 32,
            display: 'flex',
          }}
        >
          Free Pill Identifier by Imprint, Drug Name, NDC, Color &amp; Shape
        </div>

        {/* Sub-line */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#10b981',
              display: 'flex',
            }}
          />
          <div
            style={{
              fontSize: 20,
              color: '#64748b',
              display: 'flex',
            }}
          >
            Powered by FDA &amp; DailyMed Data
          </div>
        </div>

        {/* Bottom accent */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 4,
            background: 'linear-gradient(90deg, #047857, #10b981)',
            display: 'flex',
          }}
        />
      </div>
    ),
    {
      ...size,
    }
  )
}
