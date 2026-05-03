-- Migration: create unknown_condition_requests table for logging 404 hits.
-- Follows the schema-qualification and naming conventions used in this repo.

CREATE TABLE IF NOT EXISTS public.unknown_condition_requests (
    id          SERIAL PRIMARY KEY,
    slug        TEXT NOT NULL,
    count       INTEGER NOT NULL DEFAULT 1,
    first_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_agent  TEXT,
    referrer    TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unknown_condition_slug
    ON public.unknown_condition_requests (slug);
