-- Cache bust because boxed-warning HTML and pro-tab HTML rendering changed
-- (dedupe LIs, WARNING heading, pro callout wrapper).
-- Does NOT touch medguide_html — that's intentionally preserved since
-- this PR makes no medguide rendering changes.
UPDATE public.medication_guide
   SET boxed_warning_html = NULL,
       professional_html = NULL,
       professional_meta = NULL;
