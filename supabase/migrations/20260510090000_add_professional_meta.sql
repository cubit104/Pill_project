ALTER TABLE public.medication_guide
    ADD COLUMN IF NOT EXISTS professional_meta JSONB;

-- Existing professional_html rows contain the old XSLT iframe payload, so clear them
-- here to force a rebuild onto the new semantic article + professional_meta contract.
UPDATE public.medication_guide
SET professional_html = NULL
WHERE professional_html IS NOT NULL;
