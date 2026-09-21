-- Staff accounts live in profiles (Supabase auth) since 2026-09; admin_users is
-- the pre-Supabase login table (2 rows, no longer maintained). These five foreign
-- keys still required every editor id to exist there, so newer reviewers could
-- not upload or delete images ("Database error"), drafts they touched could fail,
-- and their audit_log rows were silently dropped. The ids stay as stored; the
-- audit log also keeps the actor's email.
ALTER TABLE pillfinder  DROP CONSTRAINT IF EXISTS pillfinder_updated_by_fkey;
ALTER TABLE pillfinder  DROP CONSTRAINT IF EXISTS pillfinder_deleted_by_fkey;
ALTER TABLE audit_log   DROP CONSTRAINT IF EXISTS audit_log_actor_id_fkey;
ALTER TABLE pill_drafts DROP CONSTRAINT IF EXISTS pill_drafts_created_by_fkey;
ALTER TABLE pill_drafts DROP CONSTRAINT IF EXISTS pill_drafts_published_by_fkey;
