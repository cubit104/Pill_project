'use client'

import { useState, useEffect } from 'react'
import { MapPin, ChevronLeft, ChevronRight } from 'lucide-react'

// Derive a flag emoji directly from an ISO 3166-1 alpha-2 country code returned
// by the backend ($geoip_country_code). Falls back to a globe when the code is
// absent or invalid.
function getFlagEmoji(countryCode: string): string {
  if (!countryCode || countryCode.length !== 2) return '🌐'
  return [...countryCode.toUpperCase()]
    .map(c => String.fromCodePoint(0x1f1e6 - 65 + c.charCodeAt(0)))
    .join('')
}

function formatRelativeTime(isoString: string | null | undefined): string {
  if (!isoString) return '—'
  const date = new Date(isoString)
  if (isNaN(date.getTime())) return '—'
  const diffMs = Date.now() - date.getTime()
  if (diffMs < 0) return 'just now'
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDays = Math.floor(diffHr / 24)
  return `${diffDays}d ago`
}

const PAGE_SIZE = 20

interface LocationRow {
  ip: string
  city: string
  region: string
  country: string
  country_code: string
  last_seen: string | null
  pageviews: number
  users: number
}

interface Props {
  range: string
  token: string | null
}

export default function PostHogVisitorLocationsTable({ range, token }: Props) {
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

    fetch(`/api/admin/analytics/posthog/visitor-locations?range=${range}`, {
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
        <MapPin className="w-4 h-4 text-orange-500" />
        Visitor IP / Locations
        <span className="text-xs font-normal text-gray-400">{'(PostHog GeoIP)'}</span>
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
                  <th className="text-left pb-2 font-medium">Last Seen</th>
                  <th className="text-left pb-2 font-medium">IP Address</th>
                  <th className="text-left pb-2 font-medium">Country</th>
                  <th className="text-left pb-2 font-medium">City</th>
                  <th className="text-left pb-2 font-medium">Region</th>
                  <th className="text-right pb-2 font-medium">Pageviews</th>
                  <th className="text-right pb-2 font-medium">Users</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {pageRows.map((row, i) => (
                  <tr key={`${row.ip || '—'}|${row.city || '—'}|${row.region || '—'}|${row.country || '—'}|${pageStart + i}`} className="hover:bg-gray-50">
                    <td className="py-1.5 text-gray-500 whitespace-nowrap">{formatRelativeTime(row.last_seen)}</td>
                    <td className="py-1.5 text-gray-600 font-mono">{row.ip || '—'}</td>
                    <td className="py-1.5 text-gray-700">
                      <div className="flex items-center gap-1.5">
                        <span aria-hidden="true">{getFlagEmoji(row.country_code)}</span>
                        <span>{row.country}</span>
                      </div>
                    </td>
                    <td className="py-1.5 text-gray-600">{row.city || '—'}</td>
                    <td className="py-1.5 text-gray-600">{row.region || '—'}</td>
                    <td className="py-1.5 text-right tabular-nums text-gray-700">{row.pageviews.toLocaleString()}</td>
                    <td className="py-1.5 text-right tabular-nums text-gray-700">{row.users.toLocaleString()}</td>
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
                        ? 'bg-orange-500 text-white'
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
