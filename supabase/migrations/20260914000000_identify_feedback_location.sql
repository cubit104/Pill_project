-- Where a capture came from, so foreign pills (not in the US catalog) are easy to
-- spot in Admin -> Photo Captures. Filled from Cloudflare's visitor-location
-- headers (Managed Transform "Add visitor location headers"); the IP itself is
-- never stored.
ALTER TABLE public.identify_feedback
    ADD COLUMN IF NOT EXISTS country text,   -- ISO 3166-1 alpha-2, e.g. US
    ADD COLUMN IF NOT EXISTS region  text,   -- state / province, as Cloudflare names it
    ADD COLUMN IF NOT EXISTS city    text;
CREATE INDEX IF NOT EXISTS identify_feedback_country_idx ON public.identify_feedback (country);
