-- Seed the bootstrap superadmin.
-- Replace <ADMIN_BOOTSTRAP_EMAIL> with the actual email or use a DO block.
-- This migration must be run after the admin user has signed up via Supabase Auth.
DO $$
DECLARE
  bootstrap_email TEXT := current_setting('app.admin_bootstrap_email', true);
  user_id UUID;
BEGIN
  IF bootstrap_email IS NOT NULL AND bootstrap_email != '' THEN
    SELECT id INTO user_id FROM auth.users WHERE email = bootstrap_email LIMIT 1;
    IF user_id IS NOT NULL THEN
      INSERT INTO public.admin_users (id, email, role, is_active)
      VALUES (user_id, bootstrap_email, 'superadmin', true)
      ON CONFLICT (id) DO NOTHING;
    END IF;
  END IF;
END $$;
