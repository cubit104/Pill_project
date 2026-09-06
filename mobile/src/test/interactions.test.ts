import { describe, expect, it } from 'vitest'
import { interactionsPath, normaliseDrugList, normaliseSeverity, parseDrugsParam } from '../lib/interactions'

describe('interactions helpers', () => {
  it('normalises severities', () => {
    expect(normaliseSeverity('Major')).toBe('major')
    expect(normaliseSeverity('moderate')).toBe('moderate')
    expect(normaliseSeverity('minor')).toBe('minor')
    expect(normaliseSeverity(null)).toBe('unknown')
    expect(normaliseSeverity('weird')).toBe('unknown')
  })

  it('dedupes and caps the drug list', () => {
    expect(normaliseDrugList([' Warfarin ', 'warfarin', '', 'Aspirin'])).toEqual(['Warfarin', 'Aspirin'])
    expect(normaliseDrugList(Array.from({ length: 15 }, (_, i) => `d${i}`))).toHaveLength(10)
  })

  it('round-trips the drugs query param', () => {
    expect(parseDrugsParam('warfarin, aspirin,,aspirin')).toEqual(['warfarin', 'aspirin'])
    expect(parseDrugsParam(null)).toEqual([])
    expect(interactionsPath('Plavix')).toBe('/interactions?drugs=Plavix')
    expect(interactionsPath()).toBe('/interactions')
    expect(interactionsPath('a b', 'c')).toBe('/interactions?drugs=a%20b%2Cc')
  })
})
