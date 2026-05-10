ALTER TABLE public.medication_guide
    ADD COLUMN IF NOT EXISTS boxed_warning_html TEXT;
