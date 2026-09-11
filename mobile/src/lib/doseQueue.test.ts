import { beforeEach, describe, expect, it, vi } from 'vitest'

/** In-memory stand-in for Capacitor Preferences. */
const store = new Map<string, string>()
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: store.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => {
      store.set(key, value)
    },
    remove: async ({ key }: { key: string }) => {
      store.delete(key)
    },
  },
}))

const { clearQueue, enqueueDose, flushQueue, loadQueue, mergeQueue } = await import('./doseQueue')

const dose = (reminderId: string, scheduledAt: string, status: 'taken' | 'skipped' = 'taken') => ({
  reminderId,
  scheduledAt,
  status,
  actedAt: '2026-09-10T08:05:00.000Z',
})

beforeEach(async () => {
  store.clear()
  await clearQueue()
})

describe('mergeQueue', () => {
  it('keeps one entry per dose, last answer wins', () => {
    const merged = mergeQueue([dose('r1', 'A', 'taken')], [dose('r1', 'A', 'skipped'), dose('r1', 'B')])
    expect(merged).toHaveLength(2)
    expect(merged[0]?.status).toBe('skipped')
  })

  it('keeps doses from different reminders apart', () => {
    expect(mergeQueue([dose('r1', 'A')], [dose('r2', 'A')])).toHaveLength(2)
  })
})

describe('queue round trip', () => {
  it('stores and reloads pending doses', async () => {
    await enqueueDose(dose('r1', 'A'))
    await enqueueDose(dose('r2', 'B', 'skipped'))
    const queue = await loadQueue()
    expect(queue.map((d) => [d.reminderId, d.status])).toEqual([
      ['r1', 'taken'],
      ['r2', 'skipped'],
    ])
  })

  it('ignores corrupt storage instead of throwing', async () => {
    store.set('pillseek.doseQueue.v1', '{ not json')
    expect(await loadQueue()).toEqual([])
  })

  it('drops entries that are not doses', async () => {
    store.set('pillseek.doseQueue.v1', JSON.stringify([dose('r1', 'A'), { nonsense: true }]))
    expect(await loadQueue()).toHaveLength(1)
  })
})

describe('flushQueue', () => {
  it('sends everything and empties the queue', async () => {
    await enqueueDose(dose('r1', 'A'))
    await enqueueDose(dose('r2', 'B'))
    const sent: string[] = []
    const count = await flushQueue(async (d) => {
      sent.push(d.reminderId)
    })
    expect(count).toBe(2)
    expect(sent).toEqual(['r1', 'r2'])
    expect(await loadQueue()).toEqual([])
  })

  it('keeps the ones that failed so nothing is lost', async () => {
    await enqueueDose(dose('r1', 'A'))
    await enqueueDose(dose('r2', 'B'))
    const count = await flushQueue(async (d) => {
      if (d.reminderId === 'r2') throw new Error('offline')
    })
    expect(count).toBe(1)
    const left = await loadQueue()
    expect(left).toHaveLength(1)
    expect(left[0]?.reminderId).toBe('r2')
  })

  it('does nothing on an empty queue', async () => {
    const send = vi.fn()
    expect(await flushQueue(send)).toBe(0)
    expect(send).not.toHaveBeenCalled()
  })
})
