ALTER TABLE public.medication_guide
    ADD COLUMN IF NOT EXISTS professional_meta JSONB;

UPDATE public.medication_guide
SET professional_html = NULL;
