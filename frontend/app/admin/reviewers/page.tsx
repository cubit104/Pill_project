'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, UserCheck, Plus, UserCircle } from 'lucide-react'
import { createClient } from '../lib/supabase'

interface Reviewer {
  id: string
  name: string
  slug: string
  credentials: string
  role: string
  specialty: string | null
  avatar_url: string | null
  is_public: boolean
  is_active: boolean
}

const ROLE_LABELS: Record<string, string> = {
  medical_reviewer: 'Medical Reviewer',
  author: 'Author',
  editor: 'Editor',
  fact_checker: 'Fact Checker',
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: 'Bearer ' + token }
}

export default function ReviewersListPage() {
  const [reviewers, setReviewers] = useState<Reviewer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) { setError('Not authenticated'); setLoading(false); return }

        const res = await fetch('/api/admin/reviewers', {
          headers: authHeader(session.access_token),
        })
        if (!res.ok) throw new Error('Failed to load reviewers')
        const data = await res.json()
        setReviewers(data)
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Error loading reviewers')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <UserCheck className="w-6 h-6 text-indigo-400" />
          <h1 className="text-2xl font-bold text-gray-900">Reviewers</h1>
        </div>
        <Link
          href="/admin/reviewers/new"
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Reviewer
        </Link>
      </div>

      {loading && (
        <div className="text-gray-400 text-sm">Loading reviewers…</div>
      )}

      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="flex items-start gap-2 bg-red-50 border border-red-300 text-red-800 font-medium rounded-md p-3 text-sm mb-4"
        >
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && reviewers.length === 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-8 text-center">
          <UserCircle className="w-12 h-12 text-gray-500 mx-auto mb-3" />
          <p className="text-gray-300 font-medium">No reviewers yet</p>
          <p className="text-gray-500 text-sm mt-1">
            Add your first medical reviewer to improve E-E-A-T signals.
          </p>
          <Link
            href="/admin/reviewers/new"
            className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Reviewer
          </Link>
        </div>
      )}

      {!loading && reviewers.length > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-750 border-b border-gray-700">
              <tr>
                <th className="px-4 py-3 text-left text-gray-300 font-medium w-12">Avatar</th>
                <th className="px-4 py-3 text-left text-gray-300 font-medium">Name</th>
                <th className="px-4 py-3 text-left text-gray-300 font-medium hidden sm:table-cell">Credentials</th>
                <th className="px-4 py-3 text-left text-gray-300 font-medium hidden md:table-cell">Specialty</th>
                <th className="px-4 py-3 text-left text-gray-300 font-medium hidden lg:table-cell">Role</th>
                <th className="px-4 py-3 text-left text-gray-300 font-medium">Status</th>
                <th className="px-4 py-3 text-right text-gray-300 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {reviewers.map((r) => (
                <tr key={r.id} className="hover:bg-gray-750 transition-colors">
                  <td className="px-4 py-3">
                    <div className="w-8 h-8 rounded-full overflow-hidden bg-gray-700 flex items-center justify-center">
                      {r.avatar_url ? (
                        <img src={r.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <UserCircle className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-medium text-white">{r.name}</td>
                  <td className="px-4 py-3 text-gray-300 hidden sm:table-cell">{r.credentials || '—'}</td>
                  <td className="px-4 py-3 text-gray-300 hidden md:table-cell">{r.specialty || '—'}</td>
                  <td className="px-4 py-3 text-gray-300 hidden lg:table-cell">
                    {ROLE_LABELS[r.role] ?? r.role}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                          r.is_active
                            ? 'bg-emerald-900/50 text-emerald-300'
                            : 'bg-gray-700 text-gray-400'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${r.is_active ? 'bg-emerald-400' : 'bg-gray-500'}`} />
                        {r.is_active ? 'Active' : 'Inactive'}
                      </span>
                      <span
                        className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${
                          r.is_public
                            ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/50'
                            : 'bg-gray-700 text-gray-300'
                        }`}
                      >
                        {r.is_public ? 'Public' : 'Private'}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/reviewers/${r.id}`}
                      className="text-indigo-400 hover:text-indigo-300 text-sm font-medium transition-colors"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
