/**
 * Medicine cabinet for the website: the same Supabase account and tables as
 * the PillSeek app, so a member sees one cabinet everywhere. Sign-in is a
 * 6-digit email code (no passwords). Row-level security in the database keeps
 * each member to their own rows; pill details are not duplicated here and are
 * fetched from the PillSeek API by slug.
 */
import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient, User } from '@supabase/supabase-js'

// The anon key is public by design (it ships in every browser) and only grants what RLS allows.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://uqdwcxizabmxwflkbfrb.supabase.co'
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxZHdjeGl6YWJteHdmbGtiZnJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMyOTc1MzcsImV4cCI6MjA1ODg3MzUzN30.hdOFAF_-n07ltuIPBoIVHMDiUKQZUEKBTQozmtczzg8'

let client: SupabaseClient | null = null

export function cabinetSupabase(): SupabaseClient {
  if (!client) client = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  return client
}

// ---- Account -----------------------------------------------------------------

export interface CabinetUser {
  id: User['id']
  email: string | null
}

function friendlyAuthError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many attempts. Please wait a minute and try again.'
  if (m.includes('expired') || m.includes('invalid')) return 'That code is wrong or has expired. Request a new one.'
  if (m.includes('network') || m.includes('fetch')) return 'No connection. Check your internet and try again.'
  return message
}

/** Email a 6-digit code (creates the account on first use). */
export async function requestEmailCode(email: string): Promise<void> {
  const { error } = await cabinetSupabase().auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: true } })
  if (error) throw new Error(friendlyAuthError(error.message))
}

export async function verifyEmailCode(email: string, code: string): Promise<CabinetUser> {
  const { data, error } = await cabinetSupabase().auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.replace(/\D/g, ''), type: 'email' })
  if (error || !data.user) throw new Error(friendlyAuthError(error?.message ?? 'Could not verify the code'))
  return { id: data.user.id, email: data.user.email ?? null }
}

export async function currentUser(): Promise<CabinetUser | null> {
  const { data } = await cabinetSupabase().auth.getSession()
  const u = data.session?.user
  return u ? { id: u.id, email: u.email ?? null } : null
}

export function onAuthChange(cb: (user: CabinetUser | null) => void): () => void {
  const { data } = cabinetSupabase().auth.onAuthStateChange((_event, session) => {
    cb(session?.user ? { id: session.user.id, email: session.user.email ?? null } : null)
  })
  return () => data.subscription.unsubscribe()
}

export async function signOut(): Promise<void> {
  await cabinetSupabase().auth.signOut()
}

/** Delete the account and everything in it (cascades in the database). Admin accounts are refused. */
export async function deleteAccountData(): Promise<void> {
  const { error } = await cabinetSupabase().rpc('delete_own_account')
  if (error) fail('Could not delete the account', error)
}

// ---- Cabinet -----------------------------------------------------------------

export interface CabinetItem {
  id: string
  slug: string
  nickname: string | null
  notes: string | null
  position: number
  created_at: string
  /** Refill tracking (see lib/refill.ts). */
  pills_on_hand: number | null
  pills_counted_at: string | null
  pills_per_day: number | null
  fill_quantity: number | null
  refill_notify_days: number
}

export interface Reminder {
  id: string
  cabinet_item_id: string
  /** Local clock times, "HH:MM" 24h. */
  times: string[]
  /** 0 = Sunday … 6 = Saturday. */
  days: number[]
  dose: string | null
  enabled: boolean
  timezone: string | null
}

const ITEM_COLS = 'id, slug, nickname, notes, position, created_at, pills_on_hand, pills_counted_at, pills_per_day, fill_quantity, refill_notify_days'
const REMINDER_COLS = 'id, cabinet_item_id, times, days, dose, enabled, timezone'

function fail(prefix: string, error: { message: string } | null): never {
  throw new Error(`${prefix}: ${error?.message ?? 'unknown error'}`)
}

export async function listCabinet(): Promise<CabinetItem[]> {
  const { data, error } = await cabinetSupabase().from('cabinet_items').select(ITEM_COLS).order('position').order('created_at')
  if (error) fail('Could not load your cabinet', error)
  return (data ?? []) as CabinetItem[]
}

/** Add a pill; returns the existing row when it is already saved. */
export async function addToCabinet(userId: string, slug: string): Promise<CabinetItem> {
  const sb = cabinetSupabase()
  const { data: existing } = await sb.from('cabinet_items').select(ITEM_COLS).eq('slug', slug).maybeSingle()
  if (existing) return existing as CabinetItem
  const { data: last } = await sb.from('cabinet_items').select('position').order('position', { ascending: false }).limit(1).maybeSingle()
  const position = ((last as { position: number } | null)?.position ?? -1) + 1
  const { data, error } = await sb.from('cabinet_items').insert({ user_id: userId, slug, position }).select(ITEM_COLS).single()
  if (error || !data) fail('Could not add to your cabinet', error)
  return data as CabinetItem
}

export async function isInCabinet(slug: string): Promise<boolean> {
  const { data } = await cabinetSupabase().from('cabinet_items').select('id').eq('slug', slug).maybeSingle()
  return Boolean(data)
}

export type CabinetPatch = Partial<Omit<CabinetItem, 'id' | 'slug' | 'created_at'>>

export async function updateCabinetItem(id: string, patch: CabinetPatch): Promise<void> {
  const { error } = await cabinetSupabase().from('cabinet_items').update(patch).eq('id', id)
  if (error) fail('Could not save', error)
}

export async function removeFromCabinet(id: string): Promise<void> {
  const { error } = await cabinetSupabase().from('cabinet_items').delete().eq('id', id)
  if (error) fail('Could not remove', error)
}

export async function listReminders(): Promise<Reminder[]> {
  const { data, error } = await cabinetSupabase().from('reminders').select(REMINDER_COLS)
  if (error) fail('Could not load reminders', error)
  return (data ?? []) as Reminder[]
}

export async function saveReminder(userId: string, r: Omit<Reminder, 'id'> & { id?: string }): Promise<Reminder> {
  const row = { user_id: userId, cabinet_item_id: r.cabinet_item_id, times: r.times, days: r.days, dose: r.dose, enabled: r.enabled, timezone: r.timezone }
  const sb = cabinetSupabase()
  const q = r.id ? sb.from('reminders').update(row).eq('id', r.id) : sb.from('reminders').insert(row)
  const { data, error } = await q.select(REMINDER_COLS).single()
  if (error || !data) fail('Could not save the reminder', error)
  return data as Reminder
}

export async function deleteReminder(id: string): Promise<void> {
  const { error } = await cabinetSupabase().from('reminders').delete().eq('id', id)
  if (error) fail('Could not delete the reminder', error)
}

// ---- Display helpers -----------------------------------------------------------

export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm
  const suffix = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`
}

export function formatDays(days: number[]): string {
  const set = new Set(days)
  if (set.size === 7) return 'Every day'
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return 'Weekdays'
  if (set.size === 2 && set.has(0) && set.has(6)) return 'Weekends'
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return [...set].sort((a, b) => a - b).map((d) => names[d]).join(', ')
}
