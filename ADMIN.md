# PillSeek Admin Dashboard

## Overview

The admin dashboard lives at `admin.pillseek.com/admin/*` (Vercel project `pill-project-admin`, env `NEXT_PUBLIC_ENABLE_ADMIN=true`). The public domain `pillseek.com` blocks all `/admin/*` routes.

**Target users:** Site owner (superuser) and small team (editors, reviewers).

---

## Architecture

```
Browser /admin/* (Next.js App Router — admin.pillseek.com)
    │
    │  Supabase Auth (email+password or magic link)
    │
    ▼
FastAPI /api/admin/* (requires Supabase JWT + profiles membership)
    │
    ├── pillfinder (soft-delete + hard-delete aware)
    ├── pill_drafts (draft/review/publish workflow)
    ├── audit_log (append-only)
    └── profiles (role-based access — Supabase native table)
```

---

## Roles & Permission Matrix

| Action | superuser | editor | reviewer |
|---|---|---|---|
| View dashboard | ✅ | ✅ | ✅ |
| Edit pill data | ✅ | ✅ | ✅ |
| Soft delete (move to trash) | ✅ | ✅ | ✅ |
| Restore from trash | ✅ | ✅ | ❌ |
| Hard delete (permanent) | ✅ | ❌ | ❌ |
| Approve drafts | ✅ | ✅ | ❌ |
| View audit log | ✅ | ✅ | ❌ |
| Manage users (create/edit/delete/reset password) | ✅ | ❌ | ❌ |
| Access `/admin/settings/*` | ✅ | ❌ | ❌ |

---

## Login

The login page at `admin.pillseek.com/admin/login` supports two methods:

1. **Password** (default tab): email + password → `supabase.auth.signInWithPassword`
2. **Magic Link**: email → `supabase.auth.signInWithOtp`

---

## Bootstrapping the First Superuser

The `profiles` table is created and maintained by Supabase. To bootstrap yourself as superuser, run once in the Supabase SQL Editor:

```sql
UPDATE public.profiles
SET user_role = 'superuser'
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'your-email@example.com'
);
```

All subsequent user management happens from `admin.pillseek.com/admin/settings/users` — no more touching the Supabase dashboard.

---

## User Management (admin.pillseek.com/admin/settings/users)

Superusers can:
- **Add User** — email + password + optional full name + role (creates auth user + sets profile role in one click)
- **Edit** — change role, enable/disable account
- **Reset Password** — send password reset email via Supabase
- **Delete** — permanently delete user (cascades to profiles)

Superusers cannot delete or demote their own account (UI prevents it; backend enforces it too).

---

## Environment Variables

### Frontend (Vercel)
| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `NEXT_PUBLIC_ENABLE_ADMIN` | `true` on admin.pillseek.com, not set on pillseek.com |

### Backend (Render)
| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | **Required** — Supabase service role (admin) key for user management API |
| `DATABASE_URL` | Supabase PostgreSQL connection string |
| `IMAGE_BASE` | Supabase storage base URL |
| `ALLOWED_ORIGINS` | Comma-separated allowed CORS origins |

> ⚠️ **Important:** `SUPABASE_SERVICE_ROLE_KEY` must be set on the Render backend for the user management endpoints to work. Get it from Supabase Dashboard → Settings → API → service_role key.

---

## API Endpoints

All endpoints require a valid Supabase JWT passed as `Authorization: Bearer <token>`.

| Method | Path | Min Role | Description |
|---|---|---|---|
| GET | `/api/admin/me` | any | Current user info + role |
| GET | `/api/admin/stats` | any | Dashboard KPIs |
| GET | `/api/admin/pills` | any | Paginated pill list |
| GET | `/api/admin/pills/:id` | any | Single pill + drafts |
| POST | `/api/admin/pills` | reviewer+ | Create pill |
| PUT | `/api/admin/pills/:id` | reviewer+ | Update pill |
| DELETE | `/api/admin/pills/:id` | reviewer+ | Soft delete |
| DELETE | `/api/admin/pills/:id/hard` | **superuser** | Hard delete (permanent) |
| POST | `/api/admin/pills/:id/restore` | editor+ | Restore from trash |
| POST | `/api/admin/pills/:id/drafts` | reviewer+ | Create draft |
| GET | `/api/admin/drafts` | any | List drafts |
| POST | `/api/admin/drafts/:id/approve` | editor+ | Approve |
| POST | `/api/admin/drafts/:id/reject` | editor+ | Reject |
| POST | `/api/admin/drafts/:id/publish` | editor+ | Publish |
| GET | `/api/admin/audit` | editor+ | Audit log |
| GET | `/api/admin/users` | **superuser** | List all users |
| POST | `/api/admin/users` | **superuser** | Create user with password |
| PATCH | `/api/admin/users/:id` | **superuser** | Update role / disabled |
| POST | `/api/admin/users/:id/reset-password` | **superuser** | Send password reset email |
| DELETE | `/api/admin/users/:id` | **superuser** | Delete user permanently |

---

## Database Tables

### `profiles` (Supabase-native, with RLS)
```sql
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  user_role user_role NOT NULL DEFAULT 'reviewer',  -- enum: superuser, editor, reviewer
  full_name TEXT
);

-- Auto-insert trigger (already applied):
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

### `admin_users` (legacy, kept for backward compatibility)
Existing rows continue to work. New users should be created via `/admin/settings/users`.

### `pill_drafts`
Status flow: `draft` → `pending_review` → `approved` → `published`
Or: `pending_review` → `rejected`

### `audit_log`
Append-only audit trail. No UPDATE/DELETE allowed (enforced via RLS).

---

## Safety Features

1. **Dual delete system** — soft delete (trash) available to all roles; hard delete only for superuser
2. **Audit log** — every write is logged with actor, action, before/after diff, IP
3. **Role enforcement** — both frontend (UI hiding) and backend API enforce roles
4. **No self-modification** — superuser cannot delete or demote their own account
5. **Input sanitisation** — all user input is bleach-cleaned before DB write
6. **Confirmation dialogs** — destructive actions require explicit confirmation

---

## Migrations

SQL migrations are in `supabase/migrations/`. The `profiles` table and its trigger were created manually in Supabase by the site owner and do not have a migration file in this repo.
