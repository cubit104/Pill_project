'use client'

import { useState } from 'react'
import { ComposableMap, Geographies, Geography } from 'react-simple-maps'

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'

// GA4 country name → ISO 3166-1 numeric code (matches world-atlas topojson IDs)
const COUNTRY_TO_NUMERIC: Record<string, number> = {
  'Afghanistan': 4, 'Albania': 8, 'Algeria': 12, 'Angola': 24, 'Argentina': 32,
  'Armenia': 51, 'Australia': 36, 'Austria': 40, 'Azerbaijan': 31,
  'Bahrain': 48, 'Bangladesh': 50, 'Belarus': 112, 'Belgium': 56, 'Bolivia': 68,
  'Bosnia & Herzegovina': 70, 'Brazil': 76, 'Bulgaria': 100,
  'Cambodia': 116, 'Cameroon': 120, 'Canada': 124, 'Chile': 152, 'China': 156,
  'Colombia': 170, 'Costa Rica': 188, 'Croatia': 191, 'Cuba': 192,
  'Cyprus': 196, 'Czechia': 203, 'Czech Republic': 203,
  'Denmark': 208, 'Dominican Republic': 214,
  'Ecuador': 218, 'Egypt': 818, 'El Salvador': 222, 'Estonia': 233, 'Ethiopia': 231,
  'Finland': 246, 'France': 250,
  'Georgia': 268, 'Germany': 276, 'Ghana': 288, 'Greece': 300, 'Guatemala': 320,
  'Honduras': 340, 'Hungary': 348,
  'India': 356, 'Indonesia': 360, 'Iran': 364, 'Iraq': 368, 'Ireland': 372,
  'Israel': 376, 'Italy': 380,
  'Japan': 392, 'Jordan': 400,
  'Kazakhstan': 398, 'Kenya': 404, 'Kuwait': 414,
  'Latvia': 428, 'Lebanon': 422, 'Libya': 434, 'Lithuania': 440,
  'Malaysia': 458, 'Mexico': 484, 'Moldova': 498, 'Morocco': 504, 'Myanmar': 104,
  'Nepal': 524, 'Netherlands': 528, 'New Zealand': 554, 'Nigeria': 566, 'Norway': 578,
  'Oman': 512,
  'Pakistan': 586, 'Panama': 591, 'Peru': 604, 'Philippines': 608,
  'Poland': 616, 'Portugal': 620,
  'Qatar': 634,
  'Romania': 642, 'Russia': 643,
  'Saudi Arabia': 682, 'Serbia': 688, 'Singapore': 702, 'Slovakia': 703,
  'Slovenia': 705, 'South Africa': 710, 'South Korea': 410, 'Spain': 724,
  'Sri Lanka': 144, 'Sweden': 752, 'Switzerland': 756, 'Syria': 760,
  'Taiwan': 158, 'Tanzania': 834, 'Thailand': 764, 'Tunisia': 788,
  'Turkey': 792, 'Türkiye': 792,
  'Uganda': 800, 'Ukraine': 804, 'United Arab Emirates': 784,
  'United Kingdom': 826, 'United States': 840, 'Uruguay': 858,
  'Uzbekistan': 860,
  'Venezuela': 862, 'Vietnam': 704,
  'Yemen': 887,
  'Zimbabwe': 716,
}

// Reverse lookup: numeric ID → display name
const NUMERIC_TO_NAME: Record<number, string> = {}
for (const [name, id] of Object.entries(COUNTRY_TO_NUMERIC)) {
  if (!NUMERIC_TO_NAME[id]) NUMERIC_TO_NAME[id] = name
}

interface Props {
  countries: { country: string; users: number }[]
}

export default function WorldMap({ countries }: Props) {
  const [tooltip, setTooltip] = useState<{ name: string; users: number } | null>(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })

  // Build user count map keyed by ISO numeric ID
  const userMap: Record<number, number> = {}
  for (const { country, users } of countries) {
    const id = COUNTRY_TO_NUMERIC[country]
    if (id !== undefined) userMap[id] = users
  }

  const maxUsers = Math.max(...Object.values(userMap), 1)

  // Interpolate from light blue (#dbeafe = 219,234,254) to dark blue (#1e40af = 30,64,175)
  const getColor = (geoId: string | number): string => {
    const id = Number(geoId)
    const users = userMap[id]
    if (!users) return '#e2e8f0'
    const t = users / maxUsers
    const r = Math.round(219 - 189 * t)
    const g = Math.round(234 - 170 * t)
    const b = Math.round(254 - 79 * t)
    return `rgb(${r},${g},${b})`
  }

  const handleMouseEnter = (geo: any, evt: React.MouseEvent) => {
    const id = Number(geo.id)
    const name = NUMERIC_TO_NAME[id] || 'Unknown'
    const users = userMap[id] ?? 0
    setTooltip({ name, users })
    setTooltipPos({ x: evt.clientX, y: evt.clientY })
  }

  const handleMouseMove = (evt: React.MouseEvent) => {
    setTooltipPos({ x: evt.clientX, y: evt.clientY })
  }

  const handleMouseLeave = () => {
    setTooltip(null)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 relative">
      <h3 className="font-semibold text-gray-900 text-sm mb-3">Visitor World Map</h3>
      <div className="w-full" onMouseMove={handleMouseMove}>
        <ComposableMap
          projection="geoMercator"
          projectionConfig={{ scale: 120, center: [0, 20] }}
          style={{ width: '100%', height: 'auto' }}
        >
          <Geographies geography={GEO_URL}>
            {({ geographies }: { geographies: any[] }) =>
              geographies.map((geo) => (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill={getColor(geo.id)}
                  stroke="#ffffff"
                  strokeWidth={0.3}
                  onMouseEnter={(evt: React.MouseEvent) => handleMouseEnter(geo, evt)}
                  onMouseLeave={handleMouseLeave}
                  style={{
                    default: { outline: 'none' },
                    hover: { outline: 'none', opacity: 0.8, cursor: 'pointer' },
                    pressed: { outline: 'none' },
                  }}
                />
              ))
            }
          </Geographies>
        </ComposableMap>
      </div>
      {/* Legend */}
      <div className="flex items-center gap-2 mt-2 justify-end">
        <span className="text-xs text-gray-400">Fewer</span>
        <div
          className="h-2 w-24 rounded-full"
          style={{ background: 'linear-gradient(to right, #dbeafe, #1e40af)' }}
        />
        <span className="text-xs text-gray-400">More</span>
      </div>
      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none bg-gray-900 text-white text-xs px-2.5 py-1.5 rounded-lg shadow-lg whitespace-nowrap"
          style={{ left: tooltipPos.x + 12, top: tooltipPos.y - 36 }}
        >
          <span className="font-medium">{tooltip.name}</span>
          {tooltip.users > 0 ? (
            <span className="ml-1.5 text-gray-300">{tooltip.users.toLocaleString()} users</span>
          ) : (
            <span className="ml-1.5 text-gray-400">No data</span>
          )}
        </div>
      )}
    </div>
  )
}
