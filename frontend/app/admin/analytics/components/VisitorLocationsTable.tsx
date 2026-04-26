'use client'

import { useState, useEffect } from 'react'
import { MapPin } from 'lucide-react'

// Country name → ISO alpha-2 code (for flag emoji)
const COUNTRY_TO_ALPHA2: Record<string, string> = {
  'Afghanistan': 'AF', 'Albania': 'AL', 'Algeria': 'DZ', 'Angola': 'AO',
  'Argentina': 'AR', 'Armenia': 'AM', 'Australia': 'AU', 'Austria': 'AT',
  'Azerbaijan': 'AZ', 'Bahrain': 'BH', 'Bangladesh': 'BD', 'Belarus': 'BY',
  'Belgium': 'BE', 'Bolivia': 'BO', 'Bosnia & Herzegovina': 'BA', 'Brazil': 'BR',
  'Bulgaria': 'BG', 'Cambodia': 'KH', 'Cameroon': 'CM', 'Canada': 'CA',
  'Chile': 'CL', 'China': 'CN', 'Colombia': 'CO', 'Costa Rica': 'CR',
  'Croatia': 'HR', 'Cuba': 'CU', 'Cyprus': 'CY', 'Czechia': 'CZ',
  'Czech Republic': 'CZ', 'Denmark': 'DK', 'Dominican Republic': 'DO',
  'Ecuador': 'EC', 'Egypt': 'EG', 'El Salvador': 'SV', 'Estonia': 'EE',
  'Ethiopia': 'ET', 'Finland': 'FI', 'France': 'FR', 'Georgia': 'GE',
  'Germany': 'DE', 'Ghana': 'GH', 'Greece': 'GR', 'Guatemala': 'GT',
  'Honduras': 'HN', 'Hungary': 'HU', 'India': 'IN', 'Indonesia': 'ID',
  'Iran': 'IR', 'Iraq': 'IQ', 'Ireland': 'IE', 'Israel': 'IL', 'Italy': 'IT',
  'Japan': 'JP', 'Jordan': 'JO', 'Kazakhstan': 'KZ', 'Kenya': 'KE',
  'Kuwait': 'KW', 'Latvia': 'LV', 'Lebanon': 'LB', 'Libya': 'LY',
  'Lithuania': 'LT', 'Malaysia': 'MY', 'Mexico': 'MX', 'Moldova': 'MD',
  'Morocco': 'MA', 'Myanmar': 'MM', 'Nepal': 'NP', 'Netherlands': 'NL',
  'New Zealand': 'NZ', 'Nigeria': 'NG', 'Norway': 'NO', 'Oman': 'OM',
  'Pakistan': 'PK', 'Panama': 'PA', 'Peru': 'PE', 'Philippines': 'PH',
  'Poland': 'PL', 'Portugal': 'PT', 'Qatar': 'QA', 'Romania': 'RO',
  'Russia': 'RU', 'Saudi Arabia': 'SA', 'Serbia': 'RS', 'Singapore': 'SG',
  'Slovakia': 'SK', 'Slovenia': 'SI', 'South Africa': 'ZA', 'South Korea': 'KR',
  'Spain': 'ES', 'Sri Lanka': 'LK', 'Sweden': 'SE', 'Switzerland': 'CH',
  'Syria': 'SY', 'Taiwan': 'TW', 'Tanzania': 'TZ', 'Thailand': 'TH',
  'Tunisia': 'TN', 'Turkey': 'TR', 'Türkiye': 'TR', 'Uganda': 'UG',
  'Ukraine': 'UA', 'United Arab Emirates': 'AE', 'United Kingdom': 'GB',
  'United States': 'US', 'Uruguay': 'UY', 'Uzbekistan': 'UZ',
  'Venezuela': 'VE', 'Vietnam': 'VN', 'Yemen': 'YE', 'Zimbabwe': 'ZW',
}

function getFlagEmoji(country: string): string {
  const alpha2 = COUNTRY_TO_ALPHA2[country]
  if (!alpha2) return '🌐'
  return [...alpha2.toUpperCase()]
    .map(c => String.fromCodePoint(0x1f1e6 - 65 + c.charCodeAt(0)))
    .join('')
}

interface LocationRow {
  city: string
  region: string
  country: string
  users: number
  sessions: number
}

interface Props {
  range: string
  token: string | null
}

export default function VisitorLocationsTable({ range, token }: Props) {
  const [data, setData] = useState<LocationRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notConfigured, setNotConfigured] = useState(false)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setNotConfigured(false)

    fetch(`/api/admin/analytics/ga4/visitor-ips?range=${range}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })
      .then(res => {
        if (!res.ok) throw new Error(`Request failed: ${res.statusText}`)
        return res.json()
      })
      .then(json => {
        if (!cancelled) {
          if (json.configured === false) {
            setNotConfigured(true)
          } else if (json.error) {
            setError(json.error)
          } else {
            setData(json.locations ?? [])
          }
        }
      })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [range, token])

  if (notConfigured) return null

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-3">
      <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
        <MapPin className="w-4 h-4 text-indigo-500" />
        Visitor Locations
        <span className="text-xs font-normal text-gray-400">{'(city & region from GA4)'}</span>
      </h3>
      {loading ? (
        <div className="py-6 text-center text-gray-400 text-sm animate-pulse">Loading…</div>
      ) : error ? (
        <div className="py-4 text-center text-red-500 text-sm">{error}</div>
      ) : data.length === 0 ? (
        <div className="py-6 text-center text-gray-400 text-sm">No location data available</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 border-b border-gray-100">
                <th className="text-left pb-2 font-medium">Country</th>
                <th className="text-left pb-2 font-medium">City</th>
                <th className="text-left pb-2 font-medium">Region</th>
                <th className="text-right pb-2 font-medium">Users</th>
                <th className="text-right pb-2 font-medium">Sessions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {data.map((row, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="py-1.5 text-gray-700">
                    <div className="flex items-center gap-1.5">
                      <span aria-hidden="true">{getFlagEmoji(row.country)}</span>
                      <span>{row.country}</span>
                    </div>
                  </td>
                  <td className="py-1.5 text-gray-600">{row.city || '—'}</td>
                  <td className="py-1.5 text-gray-600">{row.region || '—'}</td>
                  <td className="py-1.5 text-right tabular-nums text-gray-700">{row.users.toLocaleString()}</td>
                  <td className="py-1.5 text-right tabular-nums text-gray-700">{row.sessions.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
