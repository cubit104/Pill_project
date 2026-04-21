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

-- RLS: only superadmins can write; all admins can SELECT their own row
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "admin_users_select_own" ON public.admin_users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY IF NOT EXISTS "admin_users_superadmin_all" ON public.admin_users
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.id = auth.uid() AND au.role = 'superadmin' AND au.is_active = true
    )
  );

-- Seed superadmin (configure ADMIN_BOOTSTRAP_EMAIL env var in Supabase)
-- Run manually: INSERT INTO public.admin_users (id, email, role)
--   SELECT id, email, 'superadmin' FROM auth.users WHERE email = '<ADMIN_BOOTSTRAP_EMAIL>'
--   ON CONFLICT DO NOTHING;
