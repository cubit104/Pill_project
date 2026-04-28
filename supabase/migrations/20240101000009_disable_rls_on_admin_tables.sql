-- Idempotent: safe to re-run.
--
-- Disable Row Level Security on admin-managed tables.
--
-- Rationale: this FastAPI backend connects directly to Postgres via SQLAlchemy
-- using DATABASE_URL (service-role style connection), NOT via PostgREST.
-- That means `auth.uid()` is always NULL in these sessions, which caused
-- every INSERT/UPDATE against pill_drafts/audit_log/admin_users to fail
-- silently with a generic 500 "Database error", because the RLS WITH CHECK
-- policies rely on auth.uid().
--
-- Authorization is already enforced at the FastAPI layer via the
-- `get_admin_user` dependency in routes/admin/auth.py, so RLS on these
-- tables is both redundant and broken for this architecture.
--
-- If you later add PostgREST / supabase-js direct access to these tables,
-- re-enable RLS and design policies that work for both contexts.

ALTER TABLE public.pill_drafts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log   DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_users DISABLE ROW LEVEL SECURITY;
