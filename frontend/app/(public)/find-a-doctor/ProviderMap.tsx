'use client'

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Origin, Position, Provider } from '../../lib/providers'

/**
 * Map of the results: numbered pins (OpenStreetMap tiles, Leaflet), a blue dot
 * for the search origin, the selected provider highlighted. Positions arrive a
 * moment after the list (Census geocoder), so pins fill in as they come.
 */
export default function ProviderMap({
  providers,
  positions,
  origin,
  selected,
  onSelect,
}: {
  providers: Provider[]
  positions: Record<string, Position>
  origin: Origin | null
  selected: string | null
  onSelect: (npi: string) => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const fittedRef = useRef<string>('')
  const fittedCount = useRef(0)
  const userMoved = useRef(false)
  // The parent passes a new handler on every render; keep the latest without rebuilding the markers.
  const onSelectRef = useRef(onSelect)
  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  useEffect(() => {
    if (!boxRef.current || mapRef.current) return
    const map = L.map(boxRef.current, { scrollWheelZoom: false, zoomControl: true, attributionControl: true })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map)
    map.setView([39.5, -98.35], 4)
    // Once the viewer pans or zooms, stop re-fitting under them.
    map.on('dragstart', () => (userMoved.current = true))
    map.on('zoomstart', (e: L.LeafletEvent) => {
      if (!(e.target as L.Map & { _fitting?: boolean })._fitting) userMoved.current = true
    })
    mapRef.current = map
    layerRef.current = L.layerGroup().addTo(map)
    // A fresh map has not been fitted yet, even if this component instance was mounted before.
    fittedRef.current = ''
    fittedCount.current = 0
    userMoved.current = false
    return () => {
      map.stop() // cancel any pan/zoom animation before the container goes away
      map.remove()
      mapRef.current = null
      layerRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    const points: L.LatLngExpression[] = []

    if (origin) {
      L.marker([origin.lat, origin.lon], {
        icon: L.divIcon({ className: '', html: '<div style="width:16px;height:16px;border-radius:9999px;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 6px rgba(37,99,235,.18)"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }),
        interactive: false,
        zIndexOffset: -100,
      }).addTo(layer)
      points.push([origin.lat, origin.lon])
    }

    providers.forEach((d, i) => {
      const pos = positions[d.npi]
      if (!pos) return
      const isSel = d.npi === selected
      const html = isSel
        ? `<div style="width:32px;height:32px;border-radius:9999px;background:#059669;color:#fff;border:2px solid #fff;box-shadow:0 2px 8px rgba(15,23,42,.35);display:flex;align-items:center;justify-content:center;font:700 13px system-ui,sans-serif">${i + 1}</div>`
        : `<div style="width:26px;height:26px;border-radius:9999px;background:#fff;color:#0f172a;border:2px solid #059669;box-shadow:0 2px 6px rgba(15,23,42,.2);display:flex;align-items:center;justify-content:center;font:700 11px system-ui,sans-serif">${i + 1}</div>`
      const size = isSel ? 32 : 26
      const m = L.marker([pos.lat, pos.lon], {
        icon: L.divIcon({ className: '', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
        title: d.name,
        zIndexOffset: isSel ? 1000 : 0,
      })
      m.on('click', () => onSelectRef.current(d.npi))
      m.addTo(layer)
      points.push([pos.lat, pos.lon])
    })

    // Fit to the pins: again as more arrive (they come a moment after the list), never
    // once the viewer has moved the map. The container can still be sizing itself on the
    // first pass, so measure before fitting and do it after layout.
    const key = providers
      .slice(0, 5)
      .map((d) => d.npi)
      .join(',')
    if (fittedRef.current !== key) {
      fittedRef.current = key
      fittedCount.current = 0
      userMoved.current = false
    }
    if (points.length > fittedCount.current && !userMoved.current) {
      fittedCount.current = points.length
      const bounds = L.latLngBounds(points)
      const fit = () => {
        if (mapRef.current !== map) return // unmounted in the meantime (React strict mode remounts)
        const m = map as L.Map & { _fitting?: boolean }
        m._fitting = true
        map.invalidateSize()
        map.fitBounds(bounds, { padding: [28, 28], maxZoom: 13, animate: false })
        setTimeout(() => (m._fitting = false), 400)
      }
      requestAnimationFrame(fit)
    }
  }, [providers, positions, origin, selected])

  useEffect(() => {
    const map = mapRef.current
    const pos = selected ? positions[selected] : null
    if (map && pos && map.getContainer().isConnected) map.panTo([pos.lat, pos.lon], { animate: false })
  }, [selected, positions])

  return <div ref={boxRef} className="h-full w-full" aria-label="Map of results" role="region" />
}
