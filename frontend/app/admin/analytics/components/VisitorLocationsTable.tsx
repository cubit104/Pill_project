'use client'

import { useState, useEffect } from 'react'
import { MapPin, ChevronLeft, ChevronRight } from 'lucide-react'

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

const PAGE_SIZE = 20

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
  const [page, setPage] = useState(1)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setNotConfigured(false)
    setPage(1)

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

  const totalPages = Math.ceil(data.length / PAGE_SIZE)
  const pageStart = (page - 1) * PAGE_SIZE
  const pageEnd = Math.min(page * PAGE_SIZE, data.length)
  const pageRows = data.slice(pageStart, pageEnd)

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
        <>
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
                {pageRows.map((row, i) => (
                  <tr key={pageStart + i} className="hover:bg-gray-50">
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

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2 border-t border-gray-100">
              <span className="text-xs text-gray-400">
                Showing {pageStart + 1}–{pageEnd} of {data.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="w-3.5 h-3.5 text-gray-600" />
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`min-w-[24px] h-6 px-1.5 rounded text-xs font-medium transition-colors ${
                      p === page
                        ? 'bg-indigo-500 text-white'
                        : 'text-gray-500 hover:bg-gray-100'
                    }`}
                  >
                    {p}
                  </button>
                ))}
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  aria-label="Next page"
                >
                  <ChevronRight className="w-3.5 h-3.5 text-gray-600" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
