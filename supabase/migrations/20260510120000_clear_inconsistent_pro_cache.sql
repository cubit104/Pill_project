-- Clear rows where professional_html was written but professional_meta is null.
-- This indicates a partial write caused by the JSONB binding bug (StatementError f405).
-- The next request for these drugs will re-render and re-write both columns correctly.
UPDATE public.medication_guide
   SET professional_html = NULL,
       professional_meta = NULL
 WHERE professional_html IS NOT NULL
   AND professional_meta IS NULL;
