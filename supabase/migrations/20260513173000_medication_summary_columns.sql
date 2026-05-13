ALTER TABLE public.medication_guide
    ADD COLUMN IF NOT EXISTS medication_summary_json JSONB,
    ADD COLUMN IF NOT EXISTS medication_summary_html TEXT,
    ADD COLUMN IF NOT EXISTS medication_summary_source TEXT,
    ADD COLUMN IF NOT EXISTS medication_summary_generated_at TIMESTAMPTZ;
