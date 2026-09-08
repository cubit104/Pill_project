-- Lock the Supabase REST API (roles anon / authenticated) down to what the app needs.
--
-- Before this: every public table had full SELECT/INSERT/UPDATE/DELETE granted to
-- anon and authenticated, and 27 tables had no row-level security. The anon key is
-- public (it ships in the website's JavaScript for the admin login), so anyone could
-- read or edit pillfinder, admin_users, audit_log, site_settings… straight through
-- PostgREST, bypassing the FastAPI backend.
--
-- The website and scripts never use these API roles for data: everything goes
-- through the backend, which connects as `postgres` (BYPASSRLS). Only the mobile
-- app talks to PostgREST, and only for its own cabinet tables. So:
--   1. revoke everything from anon/authenticated,
--   2. grant back only the cabinet tables (RLS-protected) and the self-delete function,
--   3. enable RLS on every public table (no policy = denied for API roles),
--   4. stop future tables/functions from inheriting API-role grants.

-- 1. Revoke ------------------------------------------------------------------
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;   -- tables, views, materialized views
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
DO $$
DECLARE f record;
BEGIN
    -- Only our own functions; extension members (pg_trgm etc.) are left alone.
    FOR f IN
        SELECT p.oid::regprocedure AS sig
        FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated, PUBLIC', f.sig);
    END LOOP;
END $$;

-- 2. Grant back the minimum ---------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cabinet_items, public.reminders, public.dose_events TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_own_account() TO authenticated;
-- profiles stays backend-only: its "superusers read all" policy is self-referencing
-- (infinite recursion when read through PostgREST) and nothing reads it via the API.

-- 3. Row-level security everywhere -------------------------------------------
DO $$
DECLARE t record;
BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    END LOOP;
END $$;

-- 4. Future objects: no API-role grants by default ---------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
