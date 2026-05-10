-- Clear cached XSLT-format medguide HTML so all rows refill with the new
-- native semantic HTML format on next view.  Safe to run multiple times.
UPDATE public.medication_guide SET medguide_html = NULL;
