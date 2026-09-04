-- Learning loop for camera pill identification: one row per identification,
-- optional user verdict, and (only with explicit consent) the photos.
CREATE TABLE IF NOT EXISTS public.identify_feedback (
    capture_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at        timestamptz NOT NULL DEFAULT now(),
    imprint_read      text,
    tokens            jsonb,
    attrs_guess       jsonb,
    top_slugs         jsonb,
    consent           boolean NOT NULL DEFAULT false,
    photo_paths       jsonb,            -- storage object paths when consent = true
    verdict           text,             -- 'up' | 'down' | NULL (no feedback yet)
    chosen_slug       text,             -- pill the user confirmed
    corrected_imprint text,             -- what the user typed if they edited the read
    reviewed          boolean NOT NULL DEFAULT false,
    reviewed_label    text              -- editorial team's verified imprint (for training)
);
CREATE INDEX IF NOT EXISTS identify_feedback_created_idx ON public.identify_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS identify_feedback_verdict_idx ON public.identify_feedback (verdict) WHERE verdict IS NOT NULL;
-- API-managed table (FastAPI via DATABASE_URL); same convention as site_settings.
ALTER TABLE public.identify_feedback DISABLE ROW LEVEL SECURITY;

-- Private bucket for consented photos (service role only).
INSERT INTO storage.buckets (id, name, public)
VALUES ('user_pill_photos', 'user_pill_photos', false)
ON CONFLICT (id) DO NOTHING;
