-- Drugs without a real FDA Medication Guide were storing synthesized content.
-- Null those rows so the next request re-checks via the new LOINC pre-check
-- and persists medguide_html = NULL (the canonical "no medguide" signal).
UPDATE public.medication_guide
   SET medguide_html = NULL,
       boxed_warning_html = NULL,
       professional_html = NULL,
       professional_meta = NULL;
