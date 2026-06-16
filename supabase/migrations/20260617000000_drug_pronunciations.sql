CREATE TABLE IF NOT EXISTS public.drug_pronunciations (
    drug_name_lower    TEXT PRIMARY KEY,
    drug_name_display  TEXT NOT NULL,
    pronunciation_text TEXT,
    mp3_path           TEXT,
    source             TEXT NOT NULL DEFAULT 'medlineplus'
                       CHECK (source IN ('medlineplus', 'gemini', 'g2p', 'google_tts', 'manual')),
    medlineplus_url    TEXT,
    needs_review       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.drug_pronunciations IS
    'Drug pronunciation lookup keyed by lowercased drug name; populated from MedlinePlus or Gemini fallback.';

CREATE OR REPLACE FUNCTION public.trg_drug_pronunciations_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS drug_pronunciations_touch_updated_at ON public.drug_pronunciations;
CREATE TRIGGER drug_pronunciations_touch_updated_at
    BEFORE UPDATE ON public.drug_pronunciations
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_drug_pronunciations_touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_drug_pronunciations_name_prefix
    ON public.drug_pronunciations (drug_name_lower text_pattern_ops);

ALTER TABLE public.drug_pronunciations DISABLE ROW LEVEL SECURITY;
