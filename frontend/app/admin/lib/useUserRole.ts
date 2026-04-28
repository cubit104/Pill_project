'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from './supabase'

export type UserRole = 'superuser' | 'editor' | 'reviewer' | null

export interface UserRoleState {
  role: UserRole
  isSuperuser: boolean
  isEditor: boolean
  isReviewer: boolean
  /** Check if the current role has permission for a specific action */
  can: (action: Permission) => boolean
  loading: boolean
}

export type Permission =
  | 'view_dashboard'
  | 'edit_pill'
  | 'soft_delete'
  | 'restore'
  | 'hard_delete'
  | 'approve_drafts'
  | 'view_audit_log'
  | 'manage_users'
  | 'access_settings'

const PERMISSION_MATRIX: Record<Permission, UserRole[]> = {
  view_dashboard:  ['superuser', 'editor', 'reviewer'],
  edit_pill:       ['superuser', 'editor', 'reviewer'],
  soft_delete:     ['superuser', 'editor', 'reviewer'],
  restore:         ['superuser', 'editor'],
  hard_delete:     ['superuser'],
  approve_drafts:  ['superuser', 'editor'],
  view_audit_log:  ['superuser', 'editor'],
  manage_users:    ['superuser'],
  access_settings: ['superuser'],
}

export function useUserRole(): UserRoleState {
  const [role, setRole] = useState<UserRole>(null)
  const [loading, setLoading] = useState(true)

  const fetchRole = useCallback(async () => {
    try {
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        setRole(null)
        setLoading(false)
        return
      }

      const res = await fetch('/api/admin/me', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setRole(data.role as UserRole)
      } else {
        setRole(null)
      }
    } catch {
      setRole(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRole()
  }, [fetchRole])

  const isSuperuser = role === 'superuser'
  const isEditor = role === 'editor'
  const isReviewer = role === 'reviewer'

  const can = useCallback(
    (action: Permission): boolean => {
      if (!role) return false
      return PERMISSION_MATRIX[action].includes(role)
    },
    [role],
  )

  return { role, isSuperuser, isEditor, isReviewer, can, loading }
}
