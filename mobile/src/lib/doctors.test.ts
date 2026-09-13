import { describe, expect, it } from 'vitest'
import {
  FINDERS,
  PHARMACY,
  SPECIALTIES,
  URGENT_CARE,
  filterBySpecialty,
  isValidZip,
  mapsUrl,
  mergeResults,
  nppesUrl,
  parseNpiResponse,
  rankByDistance,
  specialtyByKey,
  telUrl,
} from './doctors'
import { buildTable } from './geo'

const sample = {
  result_count: 3,
  results: [
    {
      number: 1234567890,
      enumeration_type: 'NPI-1',
      basic: { first_name: 'JANE', last_name: 'DOE', credential: 'M.D.', gender: 'F', enumeration_date: '2009-03-14' },
      addresses: [
        { address_purpose: 'MAILING', address_1: 'PO BOX 1', city: 'OAKLAND', state: 'CA', postal_code: '94601', telephone_number: '510-555-0000' },
        { address_purpose: 'LOCATION', address_1: '123 MAIN ST', address_2: 'SUITE 4', city: 'SAN FRANCISCO', state: 'CA', postal_code: '941071234', telephone_number: '415-555-1212', fax_number: '415-555-1213' },
      ],
      taxonomies: [
        { desc: 'Internal Medicine', primary: false, state: 'CA', license: 'A11111' },
        { desc: 'Family Medicine', primary: true, state: 'CA', license: 'A22222' },
      ],
    },
    {
      number: 1234567890, // duplicate NPI: dropped
      enumeration_type: 'NPI-1',
      basic: { first_name: 'JANE', last_name: 'DOE' },
      addresses: [{ address_purpose: 'LOCATION', address_1: '1 ELSEWHERE', city: 'X', state: 'CA', postal_code: '94107' }],
      taxonomies: [],
    },
    {
      number: 9876543210,
      enumeration_type: 'NPI-2',
      basic: { organization_name: 'CORNER PHARMACY LLC' },
      addresses: [{ address_purpose: 'LOCATION', address_1: '9 MARKET ST', city: 'SAN FRANCISCO', state: 'CA', postal_code: '94103', telephone_number: '(415) 555-9999' }],
      taxonomies: [{ desc: 'Pharmacy', primary: true }],
    },
    {
      number: 5555555555, // no address at all: dropped
      enumeration_type: 'NPI-1',
      basic: { first_name: 'NO', last_name: 'ADDRESS' },
      addresses: [],
      taxonomies: [],
    },
    {
      number: 4444444444, // unknown ZIP: ranks last
      enumeration_type: 'NPI-1',
      basic: { first_name: 'FAR', last_name: 'AWAY' },
      addresses: [{ address_purpose: 'LOCATION', address_1: '1 NOWHERE', city: 'ELSEWHERE', state: 'ZZ', postal_code: '00000' }],
      taxonomies: [{ desc: 'Family Medicine', primary: true }],
    },
  ],
}

const table = buildTable([
  ['94102', 'San Francisco', 'CA', 37.779, -122.419],
  ['94103', 'San Francisco', 'CA', 37.773, -122.411],
  ['94107', 'San Francisco', 'CA', 37.766, -122.394],
])

describe('parseNpiResponse', () => {
  it('prefers the practice address, title-cases names, keeps the primary taxonomy, dedupes', () => {
    const rows = parseNpiResponse(sample)
    expect(rows.map((r) => r.npi)).toEqual(['1234567890', '9876543210', '4444444444'])
    const jane = rows[0]!
    expect(jane.name).toBe('Jane Doe')
    expect(jane.credential).toBe('MD')
    expect(jane.specialty).toBe('Family Medicine')
    expect(jane.address).toBe('123 Main St, Suite 4')
    expect(jane.city).toBe('San Francisco')
    expect(jane.zip).toBe('94107')
    expect(jane.phone).toBe('415-555-1212')
    expect(jane.organisation).toBe(false)
  })

  it('keeps the details for the sheet', () => {
    const jane = parseNpiResponse(sample)[0]!
    expect(jane.taxonomies.map((t) => `${t.desc}|${t.state}|${t.license}|${t.primary}`)).toEqual([
      'Internal Medicine|CA|A11111|false',
      'Family Medicine|CA|A22222|true',
    ])
    expect(jane.mailing).toEqual({ address: 'Po Box 1', city: 'Oakland', state: 'CA', zip: '94601', phone: '510-555-0000', fax: '' })
    expect(jane.gender).toBe('F')
    expect(jane.since).toBe('2009')
    expect(jane.distanceMiles).toBeNull()
  })

  it('handles organisations', () => {
    const org = parseNpiResponse(sample)[1]!
    expect(org.name).toBe('Corner Pharmacy LLC')
    expect(org.organisation).toBe(true)
    expect(org.specialty).toBe('Pharmacy')
    expect(org.mailing).toBeNull()
  })

  it('is safe on garbage', () => {
    expect(parseNpiResponse(null)).toEqual([])
    expect(parseNpiResponse({ results: 'nope' })).toEqual([])
    expect(parseNpiResponse({ Errors: [{ description: 'bad' }] })).toEqual([])
  })
})

describe('ranking', () => {
  it('sorts nearest first and puts unknown ZIPs last', () => {
    const origin = { lat: 37.779, lon: -122.419, label: 'San Francisco, CA 94102' }
    const ranked = rankByDistance(parseNpiResponse(sample), origin, table)
    expect(ranked.map((d) => d.npi)).toEqual(['9876543210', '1234567890', '4444444444'])
    expect(ranked[0]!.distanceMiles).toBeGreaterThan(0)
    expect(ranked[0]!.distanceMiles!).toBeLessThan(ranked[1]!.distanceMiles!)
    expect(ranked[2]!.distanceMiles).toBeNull()
  })

  it('leaves order alone without an origin', () => {
    const rows = parseNpiResponse(sample)
    expect(rankByDistance(rows, null, table).map((d) => d.npi)).toEqual(rows.map((d) => d.npi))
  })

  it('merges lists without duplicates, first list wins', () => {
    const rows = parseNpiResponse(sample)
    const merged = mergeResults([[rows[0]!], [rows[0]!, rows[1]!]])
    expect(merged.map((d) => d.npi)).toEqual(['1234567890', '9876543210'])
  })
})

describe('helpers', () => {
  it('validates ZIPs', () => {
    expect(isValidZip('94107')).toBe(true)
    expect(isValidZip(' 94107 ')).toBe(true)
    expect(isValidZip('9410')).toBe(false)
    expect(isValidZip('94107-1234')).toBe(false)
  })

  it('builds tel, map and registry links', () => {
    expect(telUrl('(415) 555-1212')).toBe('tel:4155551212')
    const d = parseNpiResponse(sample)[0]!
    expect(mapsUrl(d, 'ios')).toContain('maps.apple.com/?q=123%20Main%20St%2C%20Suite%204%2C%20San%20Francisco%2C%20CA%2094107')
    expect(mapsUrl(d, 'android').startsWith('geo:0,0?q=')).toBe(true)
    expect(mapsUrl(d, 'web')).toContain('google.com/maps')
    expect(nppesUrl('1234567890')).toBe('https://npiregistry.cms.hhs.gov/provider-view/1234567890')
  })

  it('every specialty has a taxonomy, a filter and a kind; unknown keys fall back', () => {
    for (const s of SPECIALTIES) {
      expect(s.taxonomy.length).toBeGreaterThan(3)
      expect(s.match).toBeInstanceOf(RegExp)
      expect(['NPI-1', 'NPI-2']).toContain(s.kind)
    }
    expect(new Set(SPECIALTIES.map((s) => s.key)).size).toBe(SPECIALTIES.length)
    expect(specialtyByKey('nope').key).toBe('family')
    expect(specialtyByKey('dentist').key).toBe('dentist')
    // Pharmacies and urgent care are organisations with their own tiles, not in the doctor pulldown.
    expect(SPECIALTIES.some((s) => s.key === 'pharmacy' || s.key === 'urgent')).toBe(false)
    expect(FINDERS.pharmacy.fixed).toBe(PHARMACY)
    expect(FINDERS.urgent.fixed).toBe(URGENT_CARE)
    expect(PHARMACY.kind).toBe('NPI-2')
    expect(FINDERS.doctors.fixed).toBeNull()
  })

  it('filters out the neighbours the word search drags in', () => {
    const by = specialtyByKey
    const row = (specialty: string) => ({ ...parseNpiResponse(sample)[0]!, specialty, taxonomies: [] })
    const psych = filterBySpecialty(
      [row('Psychiatry & Neurology, Psychiatry'), row('Psychiatry & Neurology, Neurology'), row('Psychiatry & Neurology, Child & Adolescent Psychiatry')],
      by('psychiatry'),
    )
    expect(psych.map((d) => d.specialty)).toEqual(['Psychiatry & Neurology, Psychiatry', 'Psychiatry & Neurology, Child & Adolescent Psychiatry'])
    const neuro = filterBySpecialty([row('Psychiatry & Neurology, Psychiatry'), row('Psychiatry & Neurology, Neurology')], by('neurology'))
    expect(neuro.map((d) => d.specialty)).toEqual(['Psychiatry & Neurology, Neurology'])
    const internal = filterBySpecialty([row('Internal Medicine'), row('Emergency Medicine'), row('Internal Medicine, Infectious Disease')], by('internal'))
    expect(internal.map((d) => d.specialty)).toEqual(['Internal Medicine', 'Internal Medicine, Infectious Disease'])
    const urgent = filterBySpecialty([row('Clinic/Center'), row('Clinic/Center, Urgent Care')], URGENT_CARE)
    expect(urgent.map((d) => d.specialty)).toEqual(['Clinic/Center, Urgent Care'])
    expect(filterBySpecialty([row('')], by('family'))).toHaveLength(1) // unknown specialty is kept, not hidden
  })

  it('keeps a place whose wanted specialty is not its primary one', () => {
    const jane = parseNpiResponse(sample)[0]! // primary Family Medicine, also Internal Medicine
    const kept = filterBySpecialty([jane], specialtyByKey('internal'))
    expect(kept).toHaveLength(1)
    expect(kept[0]!.specialty).toBe('Internal Medicine') // the card shows the specialty that was searched for
    expect(jane.specialty).toBe('Family Medicine') // original untouched
    expect(filterBySpecialty([jane], specialtyByKey('dermatology'))).toHaveLength(0)
    expect(URGENT_CARE.nameHint).toBe('*urgent*')
  })
})
