ALTER TABLE public.medication_guide
    ADD COLUMN IF NOT EXISTS medguide_html TEXT;
