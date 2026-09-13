import { describe, expect, it } from 'vitest'
import { SPECIALTIES, filterBySpecialty, isValidZip, mapsUrl, parseNpiResponse, telUrl } from './doctors'

const sample = {
  result_count: 3,
  results: [
    {
      number: 1234567890,
      enumeration_type: 'NPI-1',
      basic: { first_name: 'JANE', last_name: 'DOE', credential: 'M.D.' },
      addresses: [
        { address_purpose: 'MAILING', address_1: 'PO BOX 1', city: 'OAKLAND', state: 'CA', postal_code: '94601', telephone_number: '510-555-0000' },
        { address_purpose: 'LOCATION', address_1: '123 MAIN ST', address_2: 'SUITE 4', city: 'SAN FRANCISCO', state: 'CA', postal_code: '941071234', telephone_number: '415-555-1212' },
      ],
      taxonomies: [
        { desc: 'Internal Medicine', primary: false },
        { desc: 'Family Medicine', primary: true },
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
      addresses: [{ address_purpose: 'LOCATION', address_1: '9 MARKET ST', city: 'SAN FRANCISCO', state: 'CA', postal_code: '94107', telephone_number: '(415) 555-9999' }],
      taxonomies: [{ desc: 'Pharmacy', primary: true }],
    },
    {
      number: 5555555555, // no address at all: dropped
      enumeration_type: 'NPI-1',
      basic: { first_name: 'NO', last_name: 'ADDRESS' },
      addresses: [],
      taxonomies: [],
    },
  ],
}

describe('parseNpiResponse', () => {
  it('prefers the practice address, title-cases names, keeps the primary taxonomy, dedupes', () => {
    const rows = parseNpiResponse(sample)
    expect(rows.map((r) => r.npi)).toEqual(['1234567890', '9876543210'])
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

  it('handles organisations', () => {
    const org = parseNpiResponse(sample)[1]!
    expect(org.name).toBe('Corner Pharmacy Llc')
    expect(org.organisation).toBe(true)
    expect(org.specialty).toBe('Pharmacy')
  })

  it('is safe on garbage', () => {
    expect(parseNpiResponse(null)).toEqual([])
    expect(parseNpiResponse({ results: 'nope' })).toEqual([])
    expect(parseNpiResponse({ Errors: [{ description: 'bad' }] })).toEqual([])
  })
})

describe('helpers', () => {
  it('validates ZIPs', () => {
    expect(isValidZip('94107')).toBe(true)
    expect(isValidZip(' 94107 ')).toBe(true)
    expect(isValidZip('9410')).toBe(false)
    expect(isValidZip('94107-1234')).toBe(false)
  })

  it('builds tel and map links', () => {
    expect(telUrl('(415) 555-1212')).toBe('tel:4155551212')
    const d = parseNpiResponse(sample)[0]!
    expect(mapsUrl(d, 'ios')).toContain('maps.apple.com/?q=123%20Main%20St%2C%20Suite%204%2C%20San%20Francisco%2C%20CA%2094107')
    expect(mapsUrl(d, 'android').startsWith('geo:0,0?q=')).toBe(true)
    expect(mapsUrl(d, 'web')).toContain('google.com/maps')
  })

  it('every specialty has a taxonomy, a filter and a kind', () => {
    for (const s of SPECIALTIES) {
      expect(s.taxonomy.length).toBeGreaterThan(3)
      expect(s.match).toBeInstanceOf(RegExp)
      expect(['NPI-1', 'NPI-2']).toContain(s.kind)
    }
    expect(new Set(SPECIALTIES.map((s) => s.key)).size).toBe(SPECIALTIES.length)
  })

  it('filters out the neighbours the word search drags in', () => {
    const by = (key: string) => SPECIALTIES.find((s) => s.key === key)!
    const row = (specialty: string) => ({ ...parseNpiResponse(sample)[0]!, specialty })
    const psych = filterBySpecialty(
      [row('Psychiatry & Neurology, Psychiatry'), row('Psychiatry & Neurology, Neurology'), row('Psychiatry & Neurology, Child & Adolescent Psychiatry')],
      by('psychiatry'),
    )
    expect(psych.map((d) => d.specialty)).toEqual(['Psychiatry & Neurology, Psychiatry', 'Psychiatry & Neurology, Child & Adolescent Psychiatry'])
    const internal = filterBySpecialty([row('Internal Medicine'), row('Emergency Medicine'), row('Internal Medicine, Infectious Disease')], by('internal'))
    expect(internal.map((d) => d.specialty)).toEqual(['Internal Medicine', 'Internal Medicine, Infectious Disease'])
    const urgent = filterBySpecialty([row('Clinic/Center'), row('Clinic/Center, Urgent Care')], by('urgent'))
    expect(urgent.map((d) => d.specialty)).toEqual(['Clinic/Center, Urgent Care'])
    expect(filterBySpecialty([row('')], by('family'))).toHaveLength(1) // unknown specialty is kept, not hidden
  })
})
