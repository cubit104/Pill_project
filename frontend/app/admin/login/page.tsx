'use client'

export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { createClient } from '../lib/supabase'

type Tab = 'password' | 'magic'

export default function AdminLoginPage() {
  const [tab, setTab] = useState<Tab>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showForgot, setShowForgot] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotSent, setForgotSent] = useState(false)
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotError, setForgotError] = useState('')

  const supabase = createClient()

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      if (error.message.toLowerCase().includes('invalid')) {
        setError('Invalid email or password.')
      } else if (error.message.toLowerCase().includes('confirm')) {
        setError('Please confirm your email address before signing in.')
      } else {
        setError(error.message)
      }
    } else {
      // Redirect after successful login
      window.location.href = '/admin'
    }
    setLoading(false)
  }

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/admin` },
    })
    if (error) {
      setError(error.message)
    } else {
      setSent(true)
    }
    setLoading(false)
  }

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setForgotLoading(true)
    setForgotError('')
    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: `${window.location.origin}/admin/reset-password`,
    })
    if (error) {
      setForgotError(error.message)
    } else {
      setForgotSent(true)
    }
    setForgotLoading(false)
  }

  if (sent) {
    return (
      <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full text-center">
        <div className="text-4xl mb-4">📧</div>
        <h2 className="text-2xl font-bold mb-2">Check your email</h2>
        <p className="text-gray-600">
          We sent a magic link to <strong>{email}</strong>. Click it to sign in.
        </p>
        <button
          onClick={() => { setSent(false); setEmail('') }}
          className="mt-4 text-sm text-indigo-600 hover:underline"
        >
          ← Back to login
        </button>
      </div>
    )
  }

  return (
    <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full">
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold">💊 PillSeek Admin</h1>
        <p className="text-gray-600 mt-1">Sign in to continue</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-6">
        <button
          type="button"
          onClick={() => { setTab('password'); setError(''); setShowForgot(false) }}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            tab === 'password'
              ? 'text-indigo-600 border-b-2 border-indigo-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Password
        </button>
        <button
          type="button"
          onClick={() => { setTab('magic'); setError(''); setShowForgot(false) }}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            tab === 'magic'
              ? 'text-indigo-600 border-b-2 border-indigo-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Magic Link
        </button>
      </div>

      {tab === 'password' ? (
        <div className="space-y-4">
          <form onSubmit={handlePasswordLogin} className="space-y-4">
            <div>
              <label htmlFor="email-pw" className="block text-sm font-medium text-gray-700 mb-1">
                Email address
              </label>
              <input
                id="email-pw"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
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
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {/* Forgot password */}
          <div className="pt-2">
            {!showForgot ? (
              <button
                type="button"
                onClick={() => { setShowForgot(true); setForgotSent(false); setForgotError('') }}
                className="text-sm text-indigo-600 hover:underline"
              >
                Forgot password?
              </button>
            ) : forgotSent ? (
              <div className="bg-green-50 text-green-700 text-sm px-3 py-2 rounded-md">
                Check your email for a reset link.
              </div>
            ) : (
              <form onSubmit={handleForgotPassword} className="space-y-2">
                <p className="text-sm text-gray-600 font-medium">Reset your password</p>
                <input
                  type="email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                {forgotError && (
                  <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md">{forgotError}</div>
                )}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={forgotLoading}
                    className="flex-1 bg-indigo-600 text-white py-2 px-3 rounded-md text-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
                  >
                    {forgotLoading ? 'Sending…' : 'Send reset link'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowForgot(false)}
                    className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : (
        <form onSubmit={handleMagicLink} className="space-y-4">
          <div>
            <label htmlFor="email-ml" className="block text-sm font-medium text-gray-700 mb-1">
              Email address
            </label>
            <input
              id="email-ml"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
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
            {loading ? 'Sending…' : 'Send magic link'}
          </button>
        </form>
      )}
    </div>
  )
}
