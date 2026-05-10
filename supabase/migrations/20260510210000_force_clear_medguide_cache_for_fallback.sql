-- Force clear medguide_html for rows that may have failed the inline-only
-- fetch; the new standalone medguide.cfm fallback will populate them on
-- next read.
UPDATE public.medication_guide
   SET medguide_html = NULL,
       fetched_at = NULL  -- force lazy-fill path on next read
 WHERE medguide_html IS NULL
    OR LENGTH(TRIM(medguide_html)) < 200;
