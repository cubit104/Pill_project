-- Create admin_users table
CREATE TABLE IF NOT EXISTS public.admin_users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('superadmin', 'editor', 'reviewer', 'readonly')),
  full_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true
);

-- SECURITY DEFINER helper to avoid infinite recursion in RLS policies.
-- This function queries admin_users directly bypassing RLS (runs as definer).
CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE id = auth.uid() AND role = 'superadmin' AND is_active = true
  );
$$;

-- RLS: only superadmins can write; all admins can SELECT their own row
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "admin_users_select_own" ON public.admin_users
  FOR SELECT USING (auth.uid() = id);

-- Use the SECURITY DEFINER function to avoid recursive policy evaluation
CREATE POLICY IF NOT EXISTS "admin_users_superadmin_all" ON public.admin_users
  FOR ALL USING (public.is_superadmin());

-- Superadmin seeding is handled by 20240101000005_seed_superadmin.sql
