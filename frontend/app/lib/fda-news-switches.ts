import type { FdaNewsKind } from './fda-news'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'

/** The Admin → Settings switch behind each kind of FDA news card (routes/site_settings.py). */
export const FDA_NEWS_SWITCH: Record<FdaNewsKind, string> = {
  recall: 'fda_news_recalls_enabled',
  approval: 'fda_news_approvals_enabled',
  shortage: 'fda_news_shortages_enabled',
}

export type FdaNewsSwitches = Record<FdaNewsKind, boolean>

export const ALL_ON: FdaNewsSwitches = { recall: true, approval: true, shortage: true }

/** A kind is off only when the backend says so in as many words; anything else leaves it on. */
export function switchesFrom(flags: unknown): FdaNewsSwitches {
  const on = { ...ALL_ON }
  const values = (flags ?? {}) as Record<string, unknown>
  for (const kind of Object.keys(FDA_NEWS_SWITCH) as FdaNewsKind[]) if (values[FDA_NEWS_SWITCH[kind]] === false) on[kind] = false
  return on
}

/**
 * Which kinds are switched on, from the same /api/features answer the layout reads (so one request per
 * render, cached a minute). All on when the backend does not answer or does not know the switches yet:
 * the FDA news does not depend on the backend, only this off switch does.
 */
export async function fdaNewsSwitches(): Promise<FdaNewsSwitches> {
  try {
    const res = await fetch(`${API_BASE}/api/features`, { next: { revalidate: 60 } })
    return res.ok ? switchesFrom(await res.json()) : { ...ALL_ON }
  } catch {
    return { ...ALL_ON }
  }
}
