'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../lib/supabase'

export default function ResetPasswordPage() {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const router = useRouter()
  // Stable client ref — avoids re-creating on every render and re-subscribing the auth listener
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current

  useEffect(() => {
    // Listen for PASSWORD_RECOVERY event as a defensive measure
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        // Session is already set via the recovery token in the URL hash;
        // this handler fires as additional confirmation.
      }
    })
    return () => subscription.unsubscribe()
  }, [supabase])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
    setLoading(false)

    if (updateError) {
      setError(updateError.message)
    } else {
      setSuccess(true)
    }
  }

  useEffect(() => {
    if (!success) return
    // Check whether the recovery flow left the user in an active session.
    // Redirect to dashboard if they have one, or back to login if not.
    const redirectTimer = setTimeout(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      router.push(session ? '/admin' : '/admin/login')
    }, 1500)
    return () => clearTimeout(redirectTimer)
  }, [success, supabase, router])

  if (success) {
    return (
      <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full text-center">
        <div className="text-4xl mb-4">✅</div>
        <h2 className="text-2xl font-bold mb-2">Password updated</h2>
        <p className="text-gray-600">Redirecting you to the dashboard…</p>
      </div>
    )
  }

  return (
    <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full">
      <div className="flex flex-col items-center mb-6">
        <div className="flex items-center gap-2">
          <img
            src="/logo-mark.svg"
            alt=""
            width={40}
            height={40}
            className="h-10 w-10 object-contain"
          />
          <h1 className="text-2xl font-bold">
            <span className="text-slate-900">Pill</span><span className="text-emerald-700">Seek</span>
            <span className="ml-1 font-normal text-slate-600">Admin</span>
          </h1>
        </div>
        <p className="text-gray-600 mt-1">Set new password</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="new-password" className="block text-sm font-medium text-gray-700 mb-1">
            New password
          </label>
          <input
            id="new-password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="••••••••"
            required
            minLength={8}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700 mb-1">
            Confirm new password
          </label>
          <input
            id="confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
            required
            minLength={8}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {error && (
          <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md">{error}</div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-indigo-600 text-white py-2 px-4 rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
        >
          {loading ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </div>
  )
}
