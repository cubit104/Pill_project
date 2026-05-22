-- Create pill_views table for tracking pill detail page views
CREATE TABLE IF NOT EXISTS pill_views (
    id BIGSERIAL PRIMARY KEY,
    slug TEXT NOT NULL,
    ip_hash TEXT,
    viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for trending queries (slug + time window)
CREATE INDEX IF NOT EXISTS idx_pill_views_slug_viewed_at
    ON pill_views (slug, viewed_at DESC);

-- Index for dedup lookups (slug + ip_hash + recent time)
CREATE INDEX IF NOT EXISTS idx_pill_views_dedup
    ON pill_views (slug, ip_hash, viewed_at DESC);
