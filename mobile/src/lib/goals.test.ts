import { describe, expect, it } from 'vitest'
import { ivPath, parseIvPath, parsePillPath } from './goals'

describe('injection drug paths', () => {
  it('builds and parses the screen and its two label tabs', () => {
    expect(ivPath('heparin')).toBe('/iv/heparin')
    expect(ivPath('heparin', 'dosage')).toBe('/iv/heparin/dosage')
    expect(parseIvPath('/iv/heparin')).toEqual({ slug: 'heparin', tab: 'overview' })
    expect(parseIvPath('/iv/heparin/side-effects')).toEqual({ slug: 'heparin', tab: 'side-effects' })
    expect(parseIvPath('/iv/heparin/professional-information')).toEqual({ slug: 'heparin', tab: 'overview' }) // no such screen in the app
    expect(parseIvPath('/iv/vitamin%20k')).toEqual({ slug: 'vitamin k', tab: 'overview' })
  })

  it('is not fooled by pill paths or an empty slug', () => {
    expect(parseIvPath('/pill/heparin')).toBeNull()
    expect(parseIvPath('/iv/')).toBeNull()
    expect(parsePillPath('/iv/heparin')).toBeNull()
  })
})
