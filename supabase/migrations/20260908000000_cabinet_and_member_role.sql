-- Medicine cabinet (accounts + sync) and a safe default role for public sign-ups.
--
-- 1. Public users: until now every new auth.users row was inserted into
--    public.profiles with role 'reviewer' (an ADMIN role). Opening sign-up to the
--    public would have made every app user an admin reviewer. New users now get
--    the non-admin role 'member'; admins are still created explicitly by
--    superusers (routes/admin/users.py upserts the role).
-- 2. Cabinet tables, owned by the user, protected with row-level security so a
--    signed-in user can only ever read or write their own rows. The app talks to
--    these tables directly through Supabase (PostgREST) with the user's JWT.

-- ---------------------------------------------------------------------------
-- 1. Non-admin default role
-- ---------------------------------------------------------------------------
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'member';

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO public.profiles (id, email, role)
    VALUES (NEW.id, NEW.email, 'member')   -- non-admin default; admins are promoted explicitly
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END
$$;

-- Ensure the trigger exists (it did on the live project; fresh environments need it).
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 2. Cabinet
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END
$$;

CREATE TABLE IF NOT EXISTS public.cabinet_items (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    slug        text NOT NULL,                 -- pillfinder.slug (pill data stays in pillfinder)
    nickname    text,                          -- "morning pill"
    notes       text,
    position    integer NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, slug),
    CHECK (char_length(slug) <= 200),
    CHECK (nickname IS NULL OR char_length(nickname) <= 80),
    CHECK (notes IS NULL OR char_length(notes) <= 2000)
);
CREATE INDEX IF NOT EXISTS cabinet_items_user_idx ON public.cabinet_items (user_id, position);

CREATE TABLE IF NOT EXISTS public.reminders (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    cabinet_item_id uuid NOT NULL REFERENCES public.cabinet_items(id) ON DELETE CASCADE,
    times           text[] NOT NULL,           -- local clock times, 'HH:MM'
    days            integer[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}',  -- 0 = Sunday
    dose            text,                      -- "1 tablet", "2 capsules"
    enabled         boolean NOT NULL DEFAULT true,
    timezone        text,                      -- IANA name captured from the device
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CHECK (array_length(times, 1) BETWEEN 1 AND 12),
    CHECK (dose IS NULL OR char_length(dose) <= 80)
);
CREATE INDEX IF NOT EXISTS reminders_user_idx ON public.reminders (user_id);
CREATE INDEX IF NOT EXISTS reminders_item_idx ON public.reminders (cabinet_item_id);

CREATE TABLE IF NOT EXISTS public.dose_events (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    reminder_id  uuid NOT NULL REFERENCES public.reminders(id) ON DELETE CASCADE,
    scheduled_at timestamptz NOT NULL,         -- the dose this event answers
    status       text NOT NULL CHECK (status IN ('taken', 'skipped')),
    acted_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (reminder_id, scheduled_at)
);
CREATE INDEX IF NOT EXISTS dose_events_user_time_idx ON public.dose_events (user_id, scheduled_at DESC);

DROP TRIGGER IF EXISTS cabinet_items_touch ON public.cabinet_items;
CREATE TRIGGER cabinet_items_touch BEFORE UPDATE ON public.cabinet_items
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS reminders_touch ON public.reminders;
CREATE TRIGGER reminders_touch BEFORE UPDATE ON public.reminders
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Row-level security: each user sees and edits only their own rows.
ALTER TABLE public.cabinet_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dose_events   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own cabinet items" ON public.cabinet_items;
CREATE POLICY "own cabinet items" ON public.cabinet_items
    FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "own reminders" ON public.reminders;
CREATE POLICY "own reminders" ON public.reminders
    FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "own dose events" ON public.dose_events;
CREATE POLICY "own dose events" ON public.dose_events
    FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cabinet_items, public.reminders, public.dose_events TO authenticated;
REVOKE ALL ON public.cabinet_items, public.reminders, public.dose_events FROM anon;

-- ---------------------------------------------------------------------------
-- 3. Self-service account deletion (App Store / Play requirement). Deleting the
--    auth.users row cascades to profiles, cabinet_items, reminders, dose_events.
--    Admin accounts must be removed by a superuser instead.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_own_account() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
    uid uuid := auth.uid();
    r   text;
BEGIN
    IF uid IS NULL THEN
        RAISE EXCEPTION 'not signed in';
    END IF;
    SELECT role::text INTO r FROM public.profiles WHERE id = uid;
    IF r IN ('superuser', 'superadmin', 'editor', 'reviewer')
       OR EXISTS (SELECT 1 FROM public.admin_users a WHERE a.id = uid) THEN   -- legacy admin table too
        RAISE EXCEPTION 'admin accounts cannot self-delete';
    END IF;
    DELETE FROM auth.users WHERE id = uid;
END
$$;
REVOKE ALL ON FUNCTION public.delete_own_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_own_account() TO authenticated;
