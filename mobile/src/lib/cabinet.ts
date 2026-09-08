/**
 * Medicine cabinet data: the user's saved pills and reminders, stored in
 * Supabase (row-level security keeps each user to their own rows) and read
 * straight from the app with the signed-in session. Pill details (name,
 * photo, price) are not duplicated here; they come from the PillSeek API by slug.
 */
import { supabase } from './auth'

export interface CabinetItem {
  id: string
  slug: string
  nickname: string | null
  notes: string | null
  position: number
  created_at: string
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

export interface DoseEvent {
  id: string
  reminder_id: string
  scheduled_at: string
  status: 'taken' | 'skipped'
  acted_at: string
}

function fail(prefix: string, error: { message: string } | null): never {
  throw new Error(`${prefix}: ${error?.message ?? 'unknown error'}`)
}

export async function listCabinet(): Promise<CabinetItem[]> {
  const { data, error } = await supabase().from('cabinet_items').select('id, slug, nickname, notes, position, created_at').order('position').order('created_at')
  if (error) fail('Could not load your cabinet', error)
  return (data ?? []) as CabinetItem[]
}

/** Add a pill; returns the existing row when it is already saved. */
export async function addToCabinet(userId: string, slug: string): Promise<CabinetItem> {
  const { data: existing } = await supabase().from('cabinet_items').select('id, slug, nickname, notes, position, created_at').eq('slug', slug).maybeSingle()
  if (existing) return existing as CabinetItem
  const { data: last } = await supabase().from('cabinet_items').select('position').order('position', { ascending: false }).limit(1).maybeSingle()
  const position = ((last as { position: number } | null)?.position ?? -1) + 1
  const { data, error } = await supabase()
    .from('cabinet_items')
    .insert({ user_id: userId, slug, position })
    .select('id, slug, nickname, notes, position, created_at')
    .single()
  if (error || !data) fail('Could not add to your cabinet', error)
  return data as CabinetItem
}

export async function updateCabinetItem(id: string, patch: Partial<Pick<CabinetItem, 'nickname' | 'notes' | 'position'>>): Promise<void> {
  const { error } = await supabase().from('cabinet_items').update(patch).eq('id', id)
  if (error) fail('Could not save', error)
}

export async function removeFromCabinet(id: string): Promise<void> {
  const { error } = await supabase().from('cabinet_items').delete().eq('id', id)
  if (error) fail('Could not remove', error)
}

export async function reorderCabinet(ids: string[]): Promise<void> {
  await Promise.all(ids.map((id, position) => supabase().from('cabinet_items').update({ position }).eq('id', id)))
}

// ---- Reminders ---------------------------------------------------------------

export async function listReminders(): Promise<Reminder[]> {
  const { data, error } = await supabase().from('reminders').select('id, cabinet_item_id, times, days, dose, enabled, timezone')
  if (error) fail('Could not load reminders', error)
  return (data ?? []) as Reminder[]
}

export async function saveReminder(userId: string, r: Omit<Reminder, 'id'> & { id?: string }): Promise<Reminder> {
  const row = { user_id: userId, cabinet_item_id: r.cabinet_item_id, times: r.times, days: r.days, dose: r.dose, enabled: r.enabled, timezone: r.timezone }
  const q = r.id ? supabase().from('reminders').update(row).eq('id', r.id) : supabase().from('reminders').insert(row)
  const { data, error } = await q.select('id, cabinet_item_id, times, days, dose, enabled, timezone').single()
  if (error || !data) fail('Could not save the reminder', error)
  return data as Reminder
}

export async function deleteReminder(id: string): Promise<void> {
  const { error } = await supabase().from('reminders').delete().eq('id', id)
  if (error) fail('Could not delete the reminder', error)
}

/** Mark a scheduled dose taken or skipped (idempotent per reminder + time). */
export async function recordDose(userId: string, reminderId: string, scheduledAt: Date, status: DoseEvent['status']): Promise<void> {
  const { error } = await supabase()
    .from('dose_events')
    .upsert({ user_id: userId, reminder_id: reminderId, scheduled_at: scheduledAt.toISOString(), status, acted_at: new Date().toISOString() }, { onConflict: 'reminder_id,scheduled_at' })
  if (error) fail('Could not record the dose', error)
}

export async function listDoseEvents(since: Date): Promise<DoseEvent[]> {
  const { data, error } = await supabase().from('dose_events').select('id, reminder_id, scheduled_at, status, acted_at').gte('scheduled_at', since.toISOString())
  if (error) fail('Could not load dose history', error)
  return (data ?? []) as DoseEvent[]
}

/** Delete the account and everything in it (cascades in the database). */
export async function deleteAccountData(): Promise<void> {
  const { error } = await supabase().rpc('delete_own_account')
  if (error) fail('Could not delete the account', error)
}
