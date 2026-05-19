# OPERATIONS

## Production outage runbook

Use this checklist when the 2026-05-19 outage pattern reappears:

1. Confirm `/health` and `/api/admin/db/pool` before assuming Supabase is the issue.
2. Restart the Render service so workers reconnect with a clean pool.
3. Restart Supabase / the pooler if client slots are exhausted.
4. If needed, terminate stale sessions with the SQL below.

```sql
SELECT pid, usename, application_name, state, query_start, state_change, query
FROM pg_stat_activity
WHERE datname = current_database()
ORDER BY state_change ASC;

SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = current_database()
  AND state IN ('idle', 'idle in transaction', 'idle in transaction (aborted)')
  AND state_change < NOW() - INTERVAL '1 minute'
  AND pid <> pg_backend_pid();
```

Use this endpoint when DB-related alerts fire to confirm pool state before assuming Supabase is the issue: `GET /api/admin/db/pool`

## DB pool tuning

Keep `Render workers × (pool_size + max_overflow)` well below Supabase pooler's `max_client_conn`.

With the production defaults:

- `DB_POOL_SIZE=5`
- `DB_MAX_OVERFLOW=2`
- `2 workers × (5 + 2) = 14`

That leaves headroom for admin traffic, one-off scripts, and migrations on Supabase Micro (`max_client_conn = 200`).

## When to upgrade Supabase compute

Upgrade compute when you see any of these consistently:

- steady-state connections approaching or exceeding 200
- repeated `FATAL: Max client connections reached`
- frequent pool starvation even after keeping worker pool math conservative

## Manual slug regeneration

Run slug regeneration manually instead of on startup:

```bash
python -m scripts.regenerate_slugs
```
