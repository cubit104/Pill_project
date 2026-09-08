/**
 * Accounts: Supabase Auth with a 6-digit email code (no passwords, no deep
 * links needed on the phone). The session is persisted with Capacitor
 * Preferences so it survives app restarts, and the same account works on the
 * website. Sign in with Apple / Google can be added as extra providers later.
 *
 * Configuration comes from VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
 * (the anon key is public by design; row-level security protects the data).
 */
import { Preferences } from '@capacitor/preferences'
import { createClient, type Session, type SupabaseClient, type User } from '@supabase/supabase-js'

// Defaults are the production project; the anon key is public by design (it ships in the
// website too) and only ever grants what row-level security allows. Override via .env.
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || 'https://uqdwcxizabmxwflkbfrb.supabase.co'
const anonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxZHdjeGl6YWJteHdmbGtiZnJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMyOTc1MzcsImV4cCI6MjA1ODg3MzUzN30.hdOFAF_-n07ltuIPBoIVHMDiUKQZUEKBTQozmtczzg8'

/** True when the app was built with Supabase credentials; otherwise account features hide. */
export const accountsEnabled = Boolean(url && anonKey)

const storage = {
  getItem: async (key: string) => (await Preferences.get({ key })).value,
  setItem: async (key: string, value: string) => {
    await Preferences.set({ key, value })
  },
  removeItem: async (key: string) => {
    await Preferences.remove({ key })
  },
}

let client: SupabaseClient | null = null

export function supabase(): SupabaseClient {
  if (!client) {
    if (!accountsEnabled) throw new Error('Accounts are not configured in this build')
    client = createClient(url, anonKey, {
      auth: { storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'implicit' },
    })
  }
  return client
}

export interface AuthUser {
  id: User['id']
  email: string | null
}

/** Send a 6-digit code to the address (creates the account on first use). */
export async function requestEmailCode(email: string): Promise<void> {
  const { error } = await supabase().auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: true } })
  if (error) throw new Error(friendlyAuthError(error.message))
}

/** Exchange the emailed code for a session. */
export async function verifyEmailCode(email: string, code: string): Promise<AuthUser> {
  const { data, error } = await supabase().auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.replace(/\D/g, ''), type: 'email' })
  if (error || !data.user) throw new Error(friendlyAuthError(error?.message ?? 'Could not verify the code'))
  return { id: data.user.id, email: data.user.email ?? null }
}

export async function currentSession(): Promise<Session | null> {
  if (!accountsEnabled) return null
  const { data } = await supabase().auth.getSession()
  return data.session
}

export function onAuthChange(cb: (user: AuthUser | null) => void): () => void {
  if (!accountsEnabled) return () => {}
  const { data } = supabase().auth.onAuthStateChange((_event, session) => {
    cb(session?.user ? { id: session.user.id, email: session.user.email ?? null } : null)
  })
  return () => data.subscription.unsubscribe()
}

export async function signOut(): Promise<void> {
  if (!accountsEnabled) return
  await supabase().auth.signOut()
}

function friendlyAuthError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many attempts. Please wait a minute and try again.'
  if (m.includes('expired') || m.includes('invalid')) return 'That code is wrong or has expired. Request a new one.'
  if (m.includes('network') || m.includes('fetch')) return 'No connection. Check your internet and try again.'
  return message
}
