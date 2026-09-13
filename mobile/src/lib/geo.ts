/**
 * US ZIP geography, offline: every ZIP with its city, state and centroid
 * (GeoNames postal codes, CC BY 4.0, bundled as public/data/us-zips.json).
 * Powers city live-fill, "near me" (nearest ZIP to the phone) and the
 * distance shown on each doctor. Pure functions over the loaded table so the
 * maths is unit-tested without a network.
 */

export interface ZipRow {
  zip: string
  city: string
  state: string
  lat: number
  lon: number
}

export interface CityHit {
  city: string
  state: string
  /** Centroid: mean of the city's ZIP centroids. */
  lat: number
  lon: number
  zips: string[]
}

export interface ZipTable {
  rows: ZipRow[]
  byZip: Map<string, ZipRow>
  cities: CityHit[]
  /** Lazily built set of state codes present in the table. */
  states?: Set<string>
}

type RawRow = [string, string, string, number, number]

export function buildTable(raw: RawRow[]): ZipTable {
  const rows: ZipRow[] = raw.map(([zip, city, state, lat, lon]) => ({ zip, city, state, lat, lon }))
  const byZip = new Map(rows.map((r) => [r.zip, r]))
  const acc = new Map<string, { city: string; state: string; lat: number; lon: number; zips: string[] }>()
  for (const r of rows) {
    const key = `${r.city.toLowerCase()}|${r.state}`
    const c = acc.get(key)
    if (c) {
      c.lat += r.lat
      c.lon += r.lon
      c.zips.push(r.zip)
    } else acc.set(key, { city: r.city, state: r.state, lat: r.lat, lon: r.lon, zips: [r.zip] })
  }
  const cities = [...acc.values()]
    .map((c) => ({ city: c.city, state: c.state, lat: c.lat / c.zips.length, lon: c.lon / c.zips.length, zips: c.zips }))
    .sort((a, b) => a.city.localeCompare(b.city) || a.state.localeCompare(b.state))
  return { rows, byZip, cities }
}

let tablePromise: Promise<ZipTable> | null = null

/** Loads the bundled table once (about 1.5 MB, parsed in a few ms). */
export function loadZipTable(): Promise<ZipTable> {
  tablePromise ??= fetch(`${import.meta.env.BASE_URL}data/us-zips.json`)
    .then((res) => {
      if (!res.ok) throw new Error(`ZIP table HTTP ${res.status}`)
      return res.json() as Promise<RawRow[]>
    })
    .then(buildTable)
    .catch((err) => {
      tablePromise = null
      throw err
    })
  return tablePromise
}

const EARTH_MILES = 3958.8

export function distanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_MILES * Math.asin(Math.sqrt(a))
}

export function nearestZip(table: ZipTable, lat: number, lon: number): ZipRow | null {
  let best: ZipRow | null = null
  let bestD = Infinity
  for (const r of table.rows) {
    // Cheap pre-filter: a degree of latitude is ~69 miles; skip anything far away.
    if (Math.abs(r.lat - lat) > 1.5) continue
    const d = distanceMiles(lat, lon, r.lat, r.lon)
    if (d < bestD) {
      bestD = d
      best = r
    }
  }
  if (best) return best
  // Nothing within the pre-filter (middle of an ocean): fall back to a full scan.
  for (const r of table.rows) {
    const d = distanceMiles(lat, lon, r.lat, r.lon)
    if (d < bestD) {
      bestD = d
      best = r
    }
  }
  return best
}

/** The `limit` nearest ZIPs to a point within `maxMiles`, nearest first (the point's own ZIP included). */
export function nearbyZips(table: ZipTable, lat: number, lon: number, limit = 10, maxMiles = 12): ZipRow[] {
  const out: { r: ZipRow; d: number }[] = []
  for (const r of table.rows) {
    if (Math.abs(r.lat - lat) > 0.5) continue // ~35 miles: cheap pre-filter
    const d = distanceMiles(lat, lon, r.lat, r.lon)
    if (d <= maxMiles) out.push({ r, d })
  }
  return out
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map((x) => x.r)
}

/**
 * Live-fill for the city box: "san fr" → San Francisco, CA ... Also accepts
 * "city, st" and "city st". Prefix matches first, then anywhere in the name.
 */
export function suggestCities(table: ZipTable, query: string, limit = 8): CityHit[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  // A trailing two-letter word is a state only when it is one ("san fr" is still a city prefix).
  const m = /^(.*?)[,\s]+([a-z]{2})$/.exec(q)
  const stateGuess = m ? m[2]!.toUpperCase() : null
  const isState = stateGuess !== null && (table.states ??= new Set(table.rows.map((r) => r.state))).has(stateGuess)
  const name = (isState ? m![1]! : q).trim()
  const state = isState ? stateGuess : null
  if (!name) return []
  const starts: CityHit[] = []
  const contains: CityHit[] = []
  for (const c of table.cities) {
    if (state && c.state !== state) continue
    const lc = c.city.toLowerCase()
    if (lc.startsWith(name)) starts.push(c)
    else if (lc.includes(name)) contains.push(c)
    if (starts.length >= limit) break
  }
  // Bigger cities (more ZIPs) first within each group: "San" should offer San Francisco before San Anselmo.
  const bySize = (a: CityHit, b: CityHit) => b.zips.length - a.zips.length || a.city.localeCompare(b.city)
  return [...starts.sort(bySize), ...contains.sort(bySize)].slice(0, limit)
}

export function findCity(table: ZipTable, city: string, state: string): CityHit | null {
  const lc = city.trim().toLowerCase()
  const st = state.trim().toUpperCase()
  return table.cities.find((c) => c.state === st && c.city.toLowerCase() === lc) ?? null
}

export function formatMiles(miles: number): string {
  if (miles < 0.1) return '< 0.1 mi'
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`
}
