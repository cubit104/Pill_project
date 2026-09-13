import { describe, expect, it } from 'vitest'
import { buildTable, distanceMiles, findCity, formatMiles, nearbyZips, nearestZip, suggestCities } from './geo'

const table = buildTable([
  ['94102', 'San Francisco', 'CA', 37.779, -122.419],
  ['94107', 'San Francisco', 'CA', 37.766, -122.394],
  ['94110', 'San Francisco', 'CA', 37.75, -122.415],
  ['94960', 'San Anselmo', 'CA', 37.986, -122.567],
  ['78205', 'San Antonio', 'TX', 29.424, -98.493],
  ['10001', 'New York', 'NY', 40.75, -73.997],
  ['02134', 'Allston', 'MA', 42.358, -71.128],
  ['96799', 'Pago Pago', 'AS', -14.276, -170.702],
])

describe('distanceMiles', () => {
  it('matches a known great-circle distance (SF to NYC about 2570 mi)', () => {
    const d = distanceMiles(37.7749, -122.4194, 40.7128, -74.006)
    expect(d).toBeGreaterThan(2560)
    expect(d).toBeLessThan(2580)
  })
  it('is zero for the same point', () => {
    expect(distanceMiles(1, 2, 1, 2)).toBe(0)
  })
})

describe('buildTable', () => {
  it('groups ZIPs into cities with a mean centroid', () => {
    const sf = findCity(table, 'san francisco', 'ca')!
    expect(sf.zips).toEqual(['94102', '94107', '94110'])
    expect(sf.lat).toBeCloseTo((37.779 + 37.766 + 37.75) / 3, 5)
    expect(table.byZip.get('10001')?.city).toBe('New York')
  })
})

describe('nearestZip', () => {
  it('finds the closest ZIP centroid', () => {
    expect(nearestZip(table, 37.76, -122.4)?.zip).toBe('94107')
    expect(nearestZip(table, 40.7, -74)?.zip).toBe('10001')
  })
  it('still answers far from everything', () => {
    expect(nearestZip(table, -30, -160)?.zip).toBe('96799')
  })
})

describe('nearbyZips', () => {
  it('returns the closest ZIPs within the radius, nearest first', () => {
    const near = nearbyZips(table, 37.766, -122.394, 3, 3)
    expect(near[0]?.zip).toBe('94107')
    expect(new Set(near.map((z) => z.zip))).toEqual(new Set(['94107', '94110', '94102']))
    expect(nearbyZips(table, 37.766, -122.394, 10, 0.5).map((z) => z.zip)).toEqual(['94107'])
    expect(nearbyZips(table, 0, 0, 10, 12)).toEqual([])
  })
})

describe('suggestCities', () => {
  it('prefix matches, biggest city first, then substring matches', () => {
    expect(suggestCities(table, 'san').map((c) => `${c.city}, ${c.state}`)).toEqual([
      'San Francisco, CA',
      'San Anselmo, CA',
      'San Antonio, TX',
    ])
    expect(suggestCities(table, 'ston').map((c) => c.city)).toEqual(['Allston'])
  })
  it('understands "city, st" and "city st"', () => {
    expect(suggestCities(table, 'san, tx').map((c) => c.city)).toEqual(['San Antonio'])
    expect(suggestCities(table, 'san fr ca').map((c) => c.city)).toEqual(['San Francisco'])
  })
  it('does not mistake the second word of a city for a state', () => {
    expect(suggestCities(table, 'san fr').map((c) => c.city)).toEqual(['San Francisco'])
    expect(suggestCities(table, 'new yo').map((c) => c.city)).toEqual(['New York'])
  })
  it('needs two characters', () => {
    expect(suggestCities(table, 's')).toEqual([])
  })
})

describe('formatMiles', () => {
  it('rounds sensibly', () => {
    expect(formatMiles(0.04)).toBe('< 0.1 mi')
    expect(formatMiles(2.345)).toBe('2.3 mi')
    expect(formatMiles(23.6)).toBe('24 mi')
  })
})
