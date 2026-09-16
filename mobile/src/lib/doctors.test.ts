import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import {
  ALL_PROVIDERS,
  FINDERS,
  PHARMACY,
  SPECIALTIES,
  URGENT_CARE,
  isValidZip,
  mapsUrl,
  nameParams,
  searchParamsFor,
  shareText,
  specialtyByKey,
  telUrl,
  todaysHours,
  websiteLabel,
  type Doctor,
} from './doctors'

const jane: Doctor = {
  npi: '1234567890',
  name: 'Jane Doe',
  last: 'Doe',
  credential: 'MD',
  specialty: 'Family Medicine',
  address: '123 Main St, Suite 4',
  city: 'San Francisco',
  state: 'CA',
  zip: '94107',
  phone: '415-555-1212',
  organisation: false,
  taxonomies: [{ desc: 'Family Medicine', state: 'CA', license: 'A22222', primary: true }],
  gender: 'F',
  since: '2009',
  distanceMiles: 1.2,
  google: { rating: 4.8, ratings_count: 62, open_now: true, hours: [], website: 'https://www.janedoe.com/' },
}

describe('helpers', () => {
  it('validates ZIPs', () => {
    expect(isValidZip('94107')).toBe(true)
    expect(isValidZip(' 94107 ')).toBe(true)
    expect(isValidZip('9410')).toBe(false)
    expect(isValidZip('94107-1234')).toBe(false)
  })

  it('builds tel and map links', () => {
    expect(telUrl('(415) 555-1212')).toBe('tel:4155551212')
    expect(mapsUrl(jane, 'ios')).toContain('maps.apple.com/?q=123%20Main%20St%2C%20Suite%204%2C%20San%20Francisco%2C%20CA%2094107')
    expect(mapsUrl(jane, 'android').startsWith('geo:0,0?q=')).toBe(true)
    expect(mapsUrl(jane, 'web')).toContain('google.com/maps')
  })

  it('shares who, what, where, phone and website', () => {
    expect(shareText(jane).split('\n')).toEqual(['Jane Doe, MD', 'Family Medicine', '123 Main St, Suite 4', 'San Francisco, CA 94107', '415-555-1212', 'https://www.janedoe.com/'])
    expect(shareText({ ...jane, google: null, phone: '' }).split('\n')).toHaveLength(4)
  })

  it('shortens a website for a button', () => {
    expect(websiteLabel('https://www.janedoe.com/')).toBe('janedoe.com')
    expect(websiteLabel('http://clinic.example.org/contact?x=1')).toBe('clinic.example.org')
  })

  it("picks today's line from Google's Monday-first week", () => {
    const week = ['Monday: 8:00 AM – 5:00 PM', 'Tuesday: 8:00 AM – 5:00 PM', 'Wednesday: Closed', 'Thursday: 9:00 AM – 1:00 PM', 'Friday: 8:00 AM – 5:00 PM', 'Saturday: Closed', 'Sunday: Closed']
    expect(todaysHours(week, new Date('2026-09-16T12:00:00'))).toBe('Closed') // a Wednesday
    expect(todaysHours(week, new Date('2026-09-20T12:00:00'))).toBe('Closed') // Sunday is last
    expect(todaysHours(week, new Date('2026-09-14T12:00:00'))).toBe('8:00 AM – 5:00 PM') // Monday is first
    expect(todaysHours([])).toBeNull()
  })

  it('every specialty key is unique and matches the backend list; unknown keys fall back', () => {
    expect(new Set(SPECIALTIES.map((s) => s.key)).size).toBe(SPECIALTIES.length)
    expect(specialtyByKey('nope').key).toBe('family')
    expect(ALL_PROVIDERS.key).toBe('all')
    expect(specialtyByKey('dentist').key).toBe('dentist')
    // Pharmacies and urgent care are organisations with their own tiles, not in the doctor pulldown.
    expect(SPECIALTIES.some((s) => s.key === 'pharmacy' || s.key === 'urgent')).toBe(false)
    expect(FINDERS.pharmacy.fixed).toBe(PHARMACY)
    expect(FINDERS.urgent.fixed).toBe(URGENT_CARE)
    expect(FINDERS.doctors.fixed).toBeNull()
  })

  it('cleans name-search parameters', () => {
    expect(nameParams({ last: 'Ander', first: 'Na', state: 'ca' })).toEqual({ last: 'Ander', first: 'Na', state: 'CA' })
    expect(nameParams({ last: " O'Neil ", first: 'J', state: 'texas' })).toEqual({ last: "O'Neil" })
    expect(nameParams({ last: 'A' })).toBeNull()
  })
})

describe('searchParamsFor', () => {
  const family = specialtyByKey('family')

  it('builds the backend query for each mode', () => {
    expect(searchParamsFor('doctors', { specialty: family, mode: 'zip', zip: ' 94107 ' }).toString()).toBe('kind=doctors&specialty=family&zip=94107')
    expect(searchParamsFor('pharmacy', { specialty: PHARMACY, mode: 'city', city: { city: 'Plano', state: 'TX' } }).toString()).toBe('kind=pharmacy&specialty=pharmacy&city=Plano&state=TX')
    expect(searchParamsFor('urgent', { specialty: URGENT_CARE, mode: 'near', position: { lat: 33.019876, lon: -96.6987 } }).toString()).toBe(
      'kind=urgent&specialty=urgent&lat=33.01988&lon=-96.69870',
    )
    expect(searchParamsFor('doctors', { specialty: family, mode: 'name', name: { last: 'Ander', first: 'Na', state: 'TX' } }).toString()).toBe(
      'kind=doctors&specialty=family&last=Ander&first=Na&state=TX',
    )
  })

  it('refuses incomplete searches before any network call', () => {
    const bad = (q: Parameters<typeof searchParamsFor>[1]) => {
      try {
        searchParamsFor('doctors', q)
      } catch (err) {
        return err
      }
      return null
    }
    expect(bad({ specialty: family, mode: 'zip', zip: '9410' })).toBeInstanceOf(ApiError)
    expect(bad({ specialty: family, mode: 'city' })).toBeInstanceOf(ApiError)
    expect(bad({ specialty: family, mode: 'near' })).toBeInstanceOf(ApiError)
    expect(bad({ specialty: family, mode: 'name', name: { last: 'A' } })).toBeInstanceOf(ApiError)
    expect((bad({ specialty: family, mode: 'zip', zip: '' }) as ApiError).retryable).toBe(false)
  })
})
