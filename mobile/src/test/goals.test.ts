import { describe, expect, it } from 'vitest'
import { GOALS, goalPillPath, goalSearchPath, isGoal, parsePillPath, sectionPath } from '../lib/goals'

describe('goals', () => {
  it('recognises only known goals', () => {
    for (const g of Object.keys(GOALS)) expect(isGoal(g)).toBe(true)
    expect(isGoal('toString')).toBe(false)
    expect(isGoal(null)).toBe(false)
    expect(isGoal('')).toBe(false)
  })

  it('builds search and pill paths', () => {
    expect(goalSearchPath('dosage')).toBe('/search?type=drug&goal=dosage')
    expect(goalPillPath('a b/c', 'price')).toBe('/pill/a%20b%2Fc/price')
    expect(goalPillPath('x', null)).toBe('/pill/x')
    expect(sectionPath('x', 'dosage')).toBe('/pill/x/dosage')
  })

  it('parses pill paths with and without a section', () => {
    expect(parsePillPath('/pill/lisinopril-e101')).toEqual({ slug: 'lisinopril-e101', section: null })
    expect(parsePillPath('/pill/a%20b/adverse-reactions')).toEqual({ slug: 'a b', section: 'adverse-reactions' })
    expect(parsePillPath('/pill/x/bogus')).toEqual({ slug: 'x', section: null })
    expect(parsePillPath('/pill/')).toBeNull()
    expect(parsePillPath('/search')).toBeNull()
  })
})
