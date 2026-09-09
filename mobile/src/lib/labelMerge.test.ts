import { describe, expect, it } from 'vitest'
import { directionsComplete, foldFrame, mergeLines, memoryLines, missingFields } from './labelMerge'

describe('mergeLines', () => {
  it('keeps the longer reading of a line seen across frames', () => {
    let mem = mergeLines([], [{ text: 'TAKE 1 TABLET BY M', y: 0.5, confidence: 0.6 }])
    mem = mergeLines(mem, [{ text: 'TAKE 1 TABLET BY MOUTH ONCE DAILY', y: 0.52, confidence: 0.8 }])
    expect(mem).toHaveLength(1)
    expect(mem[0]?.text).toBe('TAKE 1 TABLET BY MOUTH ONCE DAILY')
    expect(mem[0]?.seen).toBe(2)
  })

  it('treats one-token OCR flicker as the same line and keeps confidence-best', () => {
    let mem = mergeLines([], [{ text: 'DILTIAZEM 30MG TAB', confidence: 0.5 }])
    mem = mergeLines(mem, [{ text: 'DILTIAZEM 30MG TAB', confidence: 0.9 }, { text: 'DILTIAZEM 3OMG TAB', confidence: 0.4 }])
    expect(mem).toHaveLength(1)
    expect(mem[0]?.text).toBe('DILTIAZEM 30MG TAB')
  })

  it('orders memory by vertical position', () => {
    const mem = mergeLines([], [
      { text: 'QTY 30', y: 0.8 },
      { text: 'Walmart Pharmacy', y: 0.1 },
      { text: 'TAKE 1 TABLET DAILY', y: 0.5 },
    ])
    expect(memoryLines(mem).map((l) => l.text)).toEqual(['Walmart Pharmacy', 'TAKE 1 TABLET DAILY', 'QTY 30'])
  })
})

describe('foldFrame', () => {
  it('fills fields from successive partial views of a curved label', () => {
    let state = foldFrame({ memory: [], label: null }, [])
    state = foldFrame(state, [
      { text: 'Walmart Pharmacy', y: 0.05 },
      { text: 'Rx* 7206525', y: 0.15 },
      { text: 'TAKE 1 TABLET BYN', y: 0.4 },
      { text: 'DILTIAZEM 30MG TAB', y: 0.55 },
      { text: 'QTY 30 Discard After', y: 0.65 },
    ])
    expect(state.label.drugName).toBe('Diltiazem')
    expect(state.label.strength).toBe('30 MG')
    expect(state.label.rxNumber).toBe('7206525')
    expect(state.label.quantity).toBe(30)
    expect(missingFields(state.label)).toEqual(['directions'])

    state = foldFrame(state, [
      { text: 'TAKE 1 TABLET BY MOUTH TWICE DAILY', y: 0.4 },
      { text: 'DILTIAZEM 30MG TAB', y: 0.55 },
      { text: 'No Refills - Dr. Motwani', y: 0.75 },
    ])
    expect(state.label.directions).toBe('TAKE 1 TABLET BY MOUTH TWICE DAILY')
    expect(state.label.refills).toBe(0)
    expect(missingFields(state.label)).toEqual([])
  })
})

describe('directionsComplete', () => {
  it('detects truncated directions', () => {
    expect(directionsComplete('TAKE 1 TABLET BYN')).toBe(false)
    expect(directionsComplete('TAKE 1 TABLET BY MOUTH ONCE DAILY')).toBe(true)
    expect(directionsComplete('TAKE 1 TABLET EVERY 8 HOURS')).toBe(true)
    expect(directionsComplete(null)).toBe(false)
  })
})
