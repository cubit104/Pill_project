import { describe, expect, it } from 'vitest'
import { dedupeReminders, type Reminder } from './cabinet'

const r = (id: string, item: string, updated?: string, times: string[] = ['08:00']): Reminder => ({
  id,
  cabinet_item_id: item,
  times,
  days: [0, 1, 2, 3, 4, 5, 6],
  dose: '1 tablet',
  enabled: true,
  timezone: null,
  ...(updated ? { updated_at: updated } : {}),
})

describe('dedupeReminders', () => {
  it('leaves one reminder per pill alone', () => {
    const list = [r('a', 'pill1'), r('b', 'pill2')]
    const { keep, drop } = dedupeReminders(list)
    expect(keep).toEqual(list)
    expect(drop).toEqual([])
  })

  it('keeps the most recently edited when a pill has two', () => {
    const older = r('a', 'pill1', '2026-09-10T15:59:00Z', ['08:00', '20:00'])
    const newer = r('b', 'pill1', '2026-09-10T22:11:00Z', ['08:00'])
    const { keep, drop } = dedupeReminders([older, newer])
    expect(keep.map((x) => x.id)).toEqual(['b'])
    expect(drop.map((x) => x.id)).toEqual(['a'])
  })

  it('does not care about the order they arrive in', () => {
    const older = r('a', 'pill1', '2026-09-10T15:59:00Z')
    const newer = r('b', 'pill1', '2026-09-10T22:11:00Z')
    expect(dedupeReminders([newer, older]).keep.map((x) => x.id)).toEqual(['b'])
  })

  it('keeps the first when neither has an edit time', () => {
    const { keep, drop } = dedupeReminders([r('a', 'pill1'), r('b', 'pill1')])
    expect(keep.map((x) => x.id)).toEqual(['a'])
    expect(drop.map((x) => x.id)).toEqual(['b'])
  })

  it('handles three duplicates', () => {
    const list = [
      r('a', 'pill1', '2026-09-01T00:00:00Z'),
      r('b', 'pill1', '2026-09-03T00:00:00Z'),
      r('c', 'pill1', '2026-09-02T00:00:00Z'),
    ]
    const { keep, drop } = dedupeReminders(list)
    expect(keep.map((x) => x.id)).toEqual(['b'])
    expect(drop.map((x) => x.id).sort()).toEqual(['a', 'c'])
  })

  it('is empty-safe', () => {
    expect(dedupeReminders([])).toEqual({ keep: [], drop: [] })
  })
})
