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
| GET | `/api/admin/pills/:id/pronunciation` | any | Resolved pronunciation preview for this pill |
| PUT | `/api/admin/pills/:id/pronunciation` | editor+ | Save manual pronunciation text |
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

---

## NDC Backfill

The `pillfinder` table has `ndc11` and `ndc9` columns.  Rows imported via the
XML pipeline may be missing these values.  The backfill job looks each missing
row up in **DailyMed** (primary, matched by RxCUI) and **openFDA** (fallback,
matched by `generic_name`), normalises the returned NDC to canonical 11-digit
HIPAA format, and writes the result back.

Extra package NDCs per drug are stored in the `pill_ndcs` sibling table so
they are never lost.  Ambiguous multi-product matches go into
`ndc_backfill_skipped` for manual review.

### Running the backfill

**Always dry-run first:**

```bash
python -m scripts.backfill_ndc11 --dry-run --limit 10
```

Each row prints a JSON line:
```json
{"pill_id": "...", "medicine_name": "Metformin", "outcome": "updated", "chosen_ndc11": "57664-0484-18", "extras_count": 1}
```

**Live run on a handful of rows:**

```bash
python -m scripts.backfill_ndc11 --limit 50
```

**Resume from where you left off:**

```bash
python -m scripts.backfill_ndc11 --limit 200 --offset 50
```

**All flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--dry-run` | false | Log only, no DB writes |
| `--limit N` | 10 | Process at most N rows |
| `--offset N` | 0 | Skip first N rows (for resuming) |
| `--match rxcui\|name\|auto` | auto | Match strategy |
| `--sleep-ms N` | 250 | Delay between API calls (ms) |

### After the run

Check `ndc_backfill_skipped` for anything that needs manual attention:

```sql
SELECT reason, COUNT(*) FROM ndc_backfill_skipped GROUP BY reason;
```

Rows with `reason='multiple_matches'` include a `candidates` JSONB column with
all the candidates found — inspect them and update `pillfinder` + `pill_ndcs`
manually.

### Admin API (superuser only)

You can also trigger the backfill from the admin UI or via API:

```
GET  /api/admin/backfill/ndc/preview?limit=10   # dry-run, returns per-row JSON
POST /api/admin/backfill/ndc/run?limit=50        # live run, returns summary counts
```

Both endpoints require a superuser JWT (`Authorization: Bearer <token>`).

### Scale-up strategy

1. Run `--dry-run --limit 10` and inspect the JSON output.
2. Run `--limit 50` (no dry-run) and verify a few rows in Supabase.
3. Check `ndc_backfill_skipped` — resolve any `multiple_matches` manually.
4. Scale up: `--limit 500 --offset 0`, then `--limit 500 --offset 500`, etc.
5. Once comfortable, schedule via cron or GitHub Actions without the FastAPI
   app needing to be up (the script connects to the DB directly via `DATABASE_URL`).

---

## Medication Guide Identifier Backfill

The `medication_guide` table stores rendered guide content. Some older rows may
already have `spl_set_id` and HTML populated but still be missing `ndc` and/or
`rxcui`. That causes identifier lookups to miss and forces unnecessary
re-fetches. This backfill fills only NULL/blank `medication_guide.ndc` and
`medication_guide.rxcui` values from the matching `pillfinder` row.

Resolution priority:

1. `spl_set_id`
2. `rxcui`
3. `ndc11`

Existing non-NULL identifiers are **never overwritten**.

### Running the backfill

**Always dry-run first:**

```bash
python scripts/backfill_medication_guide_identifiers.py --dry-run --limit 10
```

Each candidate row prints a JSON line showing what would change:

```json
{"medication_guide_id": 123, "old_ndc": null, "new_ndc": "54868-4735-00", "old_rxcui": "861689", "new_rxcui": "861689", "match_source": "spl_set_id", "outcome": "dry_run", "notes": "fill ndc from pillfinder.ndc11"}
```

**Live run in batches:**

```bash
python scripts/backfill_medication_guide_identifiers.py --limit 200
python scripts/backfill_medication_guide_identifiers.py --limit 200 --offset 200
```

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--dry-run` | false | Log only, no DB writes |
| `--limit N` | 10 | Process at most N rows |
| `--offset N` | 0 | Skip first N rows (for resuming) |
| `--sleep-ms N` | 250 | Delay between processed rows (ms) |

### Audit log query

Each processed live row writes one record to `medication_guide_identifier_backfill_log`:

```sql
SELECT medication_guide_id, old_ndc, new_ndc, old_rxcui, new_rxcui,
       match_source, outcome, notes, created_at
FROM medication_guide_identifier_backfill_log
ORDER BY created_at DESC;
```

### Rollback

Rollback is manual and limited to rows recorded in the audit log:

```sql
UPDATE medication_guide mg
SET ndc = log.old_ndc,
    rxcui = log.old_rxcui
FROM medication_guide_identifier_backfill_log log
WHERE log.medication_guide_id = mg.id
  AND log.outcome = 'updated'
  AND log.created_at >= NOW() - INTERVAL '1 day';
```

---

## Clinical Metadata Backfill

### Overview

The clinical metadata backfill populates NULL/empty clinical fields on `pillfinder` rows
using authoritative public APIs:

- **Primary source** — openFDA drug labels (`https://api.fda.gov/drug/label.json`)
- **Secondary source** — DailyMed SPL XML (for `active_ingredients` via `<activeMoiety>` elements)

**Strict NULL-only rule:** existing non-NULL values are **never** overwritten. Re-running on
already-populated rows is safe (idempotent).

### Target fields

| Field | Source | Normalization |
|---|---|---|
| `dosage_form` | `openfda.dosage_form[0]` | Title-case ("Tablet") |
| `route` | `openfda.route[0]` | Title-case ("Oral") |
| `rx_otc_status` | `openfda.product_type[0]` | `"HUMAN PRESCRIPTION DRUG"` → `"Rx"`, `"HUMAN OTC DRUG"` → `"OTC"` |
| `dea_schedule` | `openfda.dea_schedule[0]` | Pass-through (`CI`–`CV`) |
| `fda_pharma_class` | `openfda.pharm_class_epc[0]` | Pass-through string |
| `brand_names` | `openfda.brand_name[0]` | Title-case |
| `active_ingredients` | DailyMed SPL `<activeMoiety>` → fallback `openfda.substance_name` | Comma-separated |
| `inactive_ingredients` | openFDA `inactive_ingredient[0]` | Strip leading "Inactive ingredients:" prefix; collapse whitespace |

### CLI usage

```bash
# Preview first 10 rows (no writes)
python scripts/backfill_clinical_metadata.py --dry-run --limit 10

# Live run — fill 100 rows
python scripts/backfill_clinical_metadata.py --limit 100 --sleep-ms 300

# Only update specific fields
python scripts/backfill_clinical_metadata.py --only-fields dosage_form,route --limit 500

# Use NDC only (skip RxCUI lookup)
python scripts/backfill_clinical_metadata.py --match ndc --limit 50
```

**All flags:**

| Flag | Default | Description |
|---|---|---|
| `--dry-run` | False | Preview only; write nothing |
| `--limit N` | 10 | Max rows to process |
| `--offset N` | 0 | Skip first N rows (for resuming) |
| `--sleep-ms N` | 250 | Delay between API calls (ms) |
| `--only-fields FIELDS` | all | Comma-separated field names to restrict |
| `--match rxcui\|ndc\|auto` | auto | openFDA lookup strategy |

### Sample dry-run output

```json
{"pill_id": "uuid-...", "medicine_name": "Atorvastatin", "outcome": "dry_run", "changes": {"dosage_form": {"old": null, "new": "Tablet"}, "route": {"old": null, "new": "Oral"}, "rx_otc_status": {"old": null, "new": "Rx"}}, "match_source": "openfda_rxcui"}
{"pill_id": "uuid-...", "medicine_name": "Ibuprofen", "outcome": "dry_run", "changes": {"rx_otc_status": {"old": null, "new": "OTC"}, "brand_names": {"old": null, "new": "Advil"}}, "match_source": "openfda_rxcui"}
{"processed": 10, "updated": 8, "skipped_no_match": 1, "skipped_already_populated": 1, "errors": 0, "dry_run": true}
```

### Admin API endpoints

Both require a superuser JWT.

```
GET  /api/admin/backfill/clinical/preview
     ?limit=10&offset=0&match=auto&sleep_ms=250&only_fields=dosage_form,route

POST /api/admin/backfill/clinical/run
     ?limit=50&offset=0&match=auto&sleep_ms=250
```

### Audit log

Each processed live row writes one record to `clinical_metadata_backfill_log`:

```sql
SELECT pill_id, medicine_name, rxcui, ndc11, changes, match_source, outcome, notes, created_at
FROM clinical_metadata_backfill_log
ORDER BY created_at DESC;
```

The `changes` column is JSONB with `{"field": {"old": null, "new": "value"}, ...}` format.

```sql
-- Inspect what was changed for a specific pill
SELECT pill_id, changes, match_source, outcome, created_at
FROM clinical_metadata_backfill_log
WHERE pill_id = '<your-pill-uuid>'
ORDER BY created_at DESC;
```

### Rollback

Use the `changes` JSONB to reverse a run's writes:

```sql
-- Rollback all updates from the last 24 hours
DO $$
DECLARE
    rec RECORD;
    col TEXT;
    old_val TEXT;
BEGIN
    FOR rec IN
        SELECT pill_id, changes
        FROM clinical_metadata_backfill_log
        WHERE outcome = 'updated'
          AND created_at >= NOW() - INTERVAL '1 day'
    LOOP
        FOR col, old_val IN
            SELECT key, value->>'old'
            FROM jsonb_each(rec.changes)
        LOOP
            EXECUTE format(
                'UPDATE pillfinder SET %I = $1, updated_at = now() WHERE id = $2',
                col
            ) USING old_val, rec.pill_id;
        END LOOP;
    END LOOP;
END $$;
```
