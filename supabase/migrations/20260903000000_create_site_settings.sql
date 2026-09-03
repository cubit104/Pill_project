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

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
-- The API reads/writes with the service role; no anon access needed.
