ALTER TABLE public.medication_guide
    ADD COLUMN IF NOT EXISTS professional_html TEXT,
    ADD COLUMN IF NOT EXISTS patient_html      TEXT;

CREATE INDEX IF NOT EXISTS idx_medication_guide_rxcui
    ON public.medication_guide(rxcui);
CREATE INDEX IF NOT EXISTS idx_medication_guide_ndc
    ON public.medication_guide(ndc);
CREATE INDEX IF NOT EXISTS idx_medication_guide_spl_set_id
    ON public.medication_guide(spl_set_id);
