-- Find a doctor: one row per provider we have enriched, so the map pins, the
-- CMS clinician details and the Google Places details are fetched once and
-- reused. Google's terms allow caching their data for 30 days; the code
-- refreshes anything older than that. Nothing here is user data.
CREATE TABLE IF NOT EXISTS provider_cache (
    npi          text PRIMARY KEY,
    lat          double precision,
    lon          double precision,
    geocoded_at  timestamptz,
    cms          jsonb,
    cms_at       timestamptz,
    google       jsonb,
    google_at    timestamptz,
    updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE provider_cache IS 'Find a doctor: cached geocode / CMS / Google details per NPI (30-day refresh).';
