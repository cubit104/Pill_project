/**
 * Persistent storage via @capacitor/preferences (UserDefaults / SharedPreferences,
 * localStorage on the web).
 */
import { Preferences } from '@capacitor/preferences'

const KEY_RECENT = 'pillseek.recent.v1'
const KEY_CONSENT = 'pillseek.consent.v1'
const KEY_LAST_TAB = 'pillseek.lastTab.v1'
const KEY_WELCOME = 'pillseek.welcomeSeen.v1'
const KEY_INTERACTIONS = 'pillseek.interactionDrugs.v1'

export const RECENT_LIMIT = 20

export interface RecentPhotoItem {
  id: string
  kind: 'photo'
  at: number
  /** JPEG data URL, <= 200px. */
  thumb: string | null
  imprintRead: string
  topName: string | null
  topSlug: string | null
  topScore: number | null
  matchCount: number
}

export interface RecentSearchItem {
  id: string
  kind: 'search'
  at: number
  query: string
  type: 'imprint' | 'drug' | 'ndc'
  color: string | null
  shape: string | null
  total: number
  topName: string | null
  topSlug: string | null
  topImage: string | null
}

export type RecentItem = RecentPhotoItem | RecentSearchItem

function isRecentItem(v: unknown): v is RecentItem {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.id === 'string' && (o.kind === 'photo' || o.kind === 'search') && typeof o.at === 'number'
}

export async function loadRecent(): Promise<RecentItem[]> {
  try {
    const { value } = await Preferences.get({ key: KEY_RECENT })
    if (!value) return []
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isRecentItem).sort((a, b) => b.at - a.at).slice(0, RECENT_LIMIT)
  } catch {
    return []
  }
}

async function saveRecent(items: RecentItem[]): Promise<void> {
  try {
    await Preferences.set({ key: KEY_RECENT, value: JSON.stringify(items.slice(0, RECENT_LIMIT)) })
  } catch {
    /* storage is best-effort */
  }
}

export async function addRecent(item: RecentItem): Promise<RecentItem[]> {
  const current = await loadRecent()
  // Collapse identical consecutive searches so the list stays useful.
  const filtered = current.filter((existing) => {
    if (item.kind === 'search' && existing.kind === 'search') {
      return !(
        existing.query === item.query &&
        existing.type === item.type &&
        existing.color === item.color &&
        existing.shape === item.shape
      )
    }
    return existing.id !== item.id
  })
  const next = [item, ...filtered].slice(0, RECENT_LIMIT)
  await saveRecent(next)
  return next
}

export async function removeRecent(id: string): Promise<RecentItem[]> {
  const next = (await loadRecent()).filter((i) => i.id !== id)
  await saveRecent(next)
  return next
}

export async function clearRecent(): Promise<void> {
  try {
    await Preferences.remove({ key: KEY_RECENT })
  } catch {
    /* ignore */
  }
}

/** Consent to keep photos for training. Default ON. */
export async function loadConsent(): Promise<boolean> {
  try {
    const { value } = await Preferences.get({ key: KEY_CONSENT })
    if (value === null) return true
    return value === '1'
  } catch {
    return true
  }
}

export async function saveConsent(on: boolean): Promise<void> {
  try {
    await Preferences.set({ key: KEY_CONSENT, value: on ? '1' : '0' })
  } catch {
    /* ignore */
  }
}

export async function loadLastTab(): Promise<string | null> {
  try {
    const { value } = await Preferences.get({ key: KEY_LAST_TAB })
    return value
  } catch {
    return null
  }
}

export async function saveLastTab(path: string): Promise<void> {
  try {
    await Preferences.set({ key: KEY_LAST_TAB, value: path })
  } catch {
    /* ignore */
  }
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export async function loadWelcomeSeen(): Promise<boolean> {
  try {
    const { value } = await Preferences.get({ key: KEY_WELCOME })
    return value === '1'
  } catch {
    return true // never trap the user on the welcome screen if storage fails
  }
}

export async function saveWelcomeSeen(): Promise<void> {
  try {
    await Preferences.set({ key: KEY_WELCOME, value: '1' })
  } catch {
    /* ignore */
  }
}

/** Medicines the user last entered in the interactions checker. */
export async function loadInteractionDrugs(): Promise<string[]> {
  try {
    const { value } = await Preferences.get({ key: KEY_INTERACTIONS })
    const parsed: unknown = value ? JSON.parse(value) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

const KEY_LAST_EMAIL = 'pillseek.lastEmail.v1'

/** Last email used to sign in, so a returning user only types the code. */
export async function loadLastEmail(): Promise<string> {
  try {
    return (await Preferences.get({ key: KEY_LAST_EMAIL })).value ?? ''
  } catch {
    return ''
  }
}

export async function saveLastEmail(email: string): Promise<void> {
  try {
    await Preferences.set({ key: KEY_LAST_EMAIL, value: email.trim().toLowerCase() })
  } catch {
    /* ignore */
  }
}

export async function saveInteractionDrugs(drugs: string[]): Promise<void> {
  try {
    await Preferences.set({ key: KEY_INTERACTIONS, value: JSON.stringify(drugs.slice(0, 10)) })
  } catch {
    /* ignore */
  }
}
