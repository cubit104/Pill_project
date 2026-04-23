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

## Field Schema & Completeness

### 24-column editable schema (single source of truth)

Defined in `routes/admin/field_schema.py` (Python) and `frontend/app/admin/lib/fieldSchema.ts` (TypeScript).

| # | Column | Label | Tier |
|---|--------|-------|------|
| 1 | `medicine_name` | Drug Name | **Required** |
| 2 | `author` | Manufacturer | **Required** |
| 3 | `spl_strength` | Strength | **Required** |
| 4 | `splimprint` | Imprint | **Required** |
| 5 | `splcolor_text` | Color | **Required** |
| 6 | `splshape_text` | Shape | **Required** |
| 7 | `slug` | Slug | **Required** |
| 8 | `ndc9` | NDC-9 | Required or N/A |
| 9 | `ndc11` | NDC-11 | Required or N/A |
| 10 | `dosage_form` | Dosage Form | Required or N/A |
| 11 | `route` | Route | Required or N/A |
| 12 | `spl_ingredients` | Active Ingredients | Required or N/A |
| 13 | `spl_inactive_ing` | Inactive Ingredients | Required or N/A |
| 14 | `dea_schedule_name` | DEA Schedule | Required or N/A |
| 15 | `status_rx_otc` | Rx/OTC Status | Required or N/A |
| 16 | `image_alt_text` | Image Alt Text | Required or N/A *(only when `has_image = 'TRUE'`)* |
| 17 | `brand_names` | Brand Names | Optional |
| 18 | `splsize` | Size | Optional |
| 19 | `meta_description` | Meta Description | Optional |
| 20 | `pharmclass_fda_epc` | FDA Pharma Class | Optional |
| 21 | `rxcui` | RxCUI | Optional |
| 22 | `rxcui_1` | RxCUI Alt | Optional |
| 23 | `imprint_status` | Imprint Status | Optional |
| 24 | `tags` | Tags | Optional |

**Not user-editable via form:** `image_filename` (via upload/delete), `has_image` (derived), `id`, `updated_at`, `updated_by`, `deleted_at`, `deleted_by`, `idempotency_key`.

### Tier definitions

- **Tier 1 — Required**: Must have a value to publish. Publishing blocked with HTTP 422 if empty.
- **Tier 2 — Required or N/A**: Must have a value **or** be explicitly set to the string `'N/A'` (case-insensitive) to publish. The UI shows an `[N/A]` button next to each Tier-2 field.
- **Tier 3 — Optional**: Empty is fine for publishing.

### N/A convention

Store the literal string `'N/A'` in the database column when an editor confirms a Tier-2 field doesn't apply (e.g. DEA schedule for OTC drugs). This avoids a schema migration. Completeness logic treats `'N/A'` as **complete** but distinguishable from an empty value.

### Completeness bar (pill edit page)

A progress bar at the top of `/admin/pills/[id]` shows:
- **Score** 0–100% (fraction of applicable fields that are filled)
- **Red** warning: count of Tier-1 fields missing
- **Yellow** warning: count of Tier-2 fields needing N/A confirmation
- **Green**: all required fields complete

### Completeness badges (pills list)

Each row in `/admin/pills` shows a small badge:
- 🟢 `100%` — fully complete
- 🟡 `N%` — only Tier-2/3 gaps
- 🔴 `N%` — one or more Tier-1 fields missing

---

## API Endpoints

All endpoints require a valid Supabase JWT passed as `Authorization: Bearer <token>`.

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/admin/me` | any | Current admin info |
| GET | `/api/admin/stats` | any | Dashboard KPIs |
| GET | `/api/admin/pills` | any | Paginated pill list (supports `?completeness=red\|yellow\|green`) |
| GET | `/api/admin/pills/:id` | any | Single pill + drafts |
| GET | `/api/admin/pills/:id/completeness` | any | Completeness metrics for a pill |
| GET | `/api/admin/pills/incomplete` | any | Paginated list of incomplete pills, sorted worst-first |
| POST | `/api/admin/pills` | editor+ | Create pill (add `?publish=true` for strict validation) |
| PUT | `/api/admin/pills/:id` | editor+ | Update pill — add `?publish=true` for strict Tier 1+2 validation (reviewer+ for critical fields) |
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

### `?publish=true` flag

When appended to `POST /api/admin/pills` or `PUT /api/admin/pills/:id`, the server runs strict validation (Tier 1 + Tier 2). On failure it returns:

```json
HTTP 422
{
  "detail": "Validation failed",
  "errors": [
    { "field": "medicine_name", "message": "Drug Name is required" }
  ]
}
```

### `GET /api/admin/pills/:id/completeness`

Returns:
```json
{
  "score": 72,
  "missing_required": ["author", "slug"],
  "needs_na_confirmation": ["ndc9", "dea_schedule_name"],
  "optional_empty": ["brand_names", "splsize"]
}
```

### `GET /api/admin/pills/incomplete`

Query params: `?tier=required|required_or_na&page=1&per_page=20`

Returns pills sorted by lowest completeness score first, with `missing_required` and `needs_na_confirmation` lists per row.

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
