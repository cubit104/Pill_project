-- Site-wide feature flags / settings editable from the admin dashboard.
CREATE TABLE IF NOT EXISTS public.site_settings (
    key         text PRIMARY KEY,
    value       jsonb NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  text
);

-- Camera pill identification (beta). Off until switched on in Admin → Settings.
INSERT INTO public.site_settings (key, value)
VALUES ('photo_id_enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- RLS is intentionally NOT enabled: the FastAPI backend connects directly via DATABASE_URL
-- (no PostgREST/JWT claims), matching the other API-managed tables (see
-- 20240101000009_disable_rls_on_admin_tables.sql). Write authorization is enforced in
-- routes/site_settings.py (superuser role required).
ALTER TABLE public.site_settings DISABLE ROW LEVEL SECURITY;
