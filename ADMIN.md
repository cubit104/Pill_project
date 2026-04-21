# PillSeek Admin Dashboard

## Overview

The admin dashboard lives at `/admin/*` and provides a form-based UI for managing pill data, images, and content without writing SQL.

**Target users:** 2–5 admins, including a PharmD reviewer.

---

## Architecture

```
Browser /admin/* (Next.js App Router)
    │
    │  Supabase Auth (magic link)
    │
    ▼
FastAPI /api/admin/* (requires Supabase JWT + admin_users membership)
    │
    ├── pillfinder (soft-delete aware)
    ├── pill_drafts (draft/review/publish workflow)
    ├── audit_log (append-only)
    └── admin_users (role-based access)
```

---

## Roles

| Role        | Capabilities |
|-------------|-------------|
| `superadmin` | All actions + manage admin users, hard operations |
| `editor`     | Create/edit/delete (soft) pills, upload images, save drafts |
| `reviewer`   | All editor actions + edit critical medical fields, approve/publish drafts |
| `readonly`   | View-only dashboard access |

---

## Critical Fields (require reviewer role)

These fields, when edited, **require reviewer approval** before publishing. Editors cannot directly update these fields — they are forced through the draft workflow.

| Field | Description |
|-------|-------------|
| `spl_strength` | Drug strength/dosage |
| `spl_ingredients` | Active ingredients |
| `dea_schedule_name` | DEA controlled substance schedule |
| `pharmclass_fda_epc` | FDA pharmacologic class |
| `dosage_form` | Dosage form (tablet, capsule, etc.) |
| `route` | Route of administration |

Non-critical fields (editors can edit directly, still audit-logged):
- `medicine_name` (with warning)
- `splimprint`
- `splcolor_text`
- `splshape_text`
- `image_filename`
- `meta_description`

---

## Database Tables

### `admin_users`
Stores admin team members with their roles.

```sql
CREATE TABLE public.admin_users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('superadmin', 'editor', 'reviewer', 'readonly')),
  full_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true
);
```

### `pill_drafts`
Stores draft content waiting for review and publish.

Status flow: `draft` → `pending_review` → `approved` → `published`  
Or: `pending_review` → `rejected`

### `audit_log`
Append-only audit trail for all admin actions. No UPDATE or DELETE is allowed — enforced via RLS.

### `pillfinder` changes
Added `deleted_at`, `deleted_by`, `updated_at`, `updated_by` columns for soft-delete and audit support.

---

## API Endpoints

All endpoints require a valid Supabase JWT passed as `Authorization: Bearer <token>`.

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/admin/me` | any | Current admin info |
| GET | `/api/admin/stats` | any | Dashboard KPIs |
| GET | `/api/admin/pills` | any | Paginated pill list |
| GET | `/api/admin/pills/:id` | any | Single pill + drafts |
| POST | `/api/admin/pills` | editor+ | Create pill |
| PUT | `/api/admin/pills/:id` | editor+ | Update pill (reviewer+ for critical fields) |
| DELETE | `/api/admin/pills/:id` | editor+ | Soft delete |
| POST | `/api/admin/pills/:id/restore` | editor+ | Restore deleted |
| POST | `/api/admin/pills/:id/drafts` | editor+ | Create draft |
| GET | `/api/admin/drafts` | any | List drafts |
| POST | `/api/admin/drafts/:id/submit` | editor+ | Submit for review |
| POST | `/api/admin/drafts/:id/approve` | reviewer+ | Approve |
| POST | `/api/admin/drafts/:id/publish` | reviewer+ | Publish (applies to pillfinder) |
| POST | `/api/admin/drafts/:id/reject` | reviewer+ | Reject with notes |
| POST | `/api/admin/pills/:id/images` | editor+ | Upload image |
| DELETE | `/api/admin/pills/:id/images/:fn` | editor+ | Delete image |
| GET | `/api/admin/audit` | any | Audit log |
| GET | `/api/admin/users` | superadmin | List admins |
| POST | `/api/admin/users` | superadmin | Invite admin |
| PUT | `/api/admin/users/:id` | superadmin | Update role |
| DELETE | `/api/admin/users/:id` | superadmin | Deactivate |

---

## Safety Features

1. **Soft delete only** — pills are never hard-deleted by editors/reviewers
2. **Audit log** — every write is logged with actor, action, before/after diff, IP
3. **Optimistic locking** — PUT must include `updated_at` from GET; returns 409 on conflict
4. **Role gating** — both frontend and API enforce role requirements
5. **Input sanitization** — all user input is bleach-cleaned before DB write
6. **Confirmation dialogs** — destructive actions require explicit confirmation

---

## Setup

### 1. Run migrations
Apply SQL files in `supabase/migrations/` in order to your Supabase project.

### 2. Enable Magic Link auth
In Supabase Dashboard → Authentication → Providers → Email, ensure "Magic Link" is enabled.

### 3. Seed superadmin
After the first admin signs in via magic link, run the seed migration or manually insert:
```sql
INSERT INTO public.admin_users (id, email, role, is_active)
SELECT id, email, 'superadmin', true
FROM auth.users
WHERE email = '<your-email>'
ON CONFLICT DO NOTHING;
```

### 4. Set environment variables
See `.env.example` for all required vars. Key ones:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_BOOTSTRAP_EMAIL`

---

## Migrations location
`supabase/migrations/`
