# PostHog Integration

## What PostHog gives PillSeek

PostHog is an open-source product analytics platform that combines traffic analytics, user funnels, session replay, and retention cohorts in a single tool. For PillSeek it means understanding the full user journey — from the landing page to a pill detail search — and watching real session recordings to identify UX friction, all while keeping user data private by masking sensitive inputs and only creating person profiles for identified (logged-in) users.

---

## Public site setup

The public site integration is **zero-config for fresh clones** — the `.env.example` is pre-filled with the PillSeek PostHog project credentials:

```
NEXT_PUBLIC_POSTHOG_KEY=phc_Bsh2XTkDrpUftJrZqM9Cgwe3km9Wk7gLWzdvrCUVJRfF
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

These are **public-safe** values (PostHog project tokens are write-only). Just deploy and every page visit on the public site (`pillseek.com`) will be captured automatically.

The `PostHogProvider` is injected in `frontend/app/(public)/layout.tsx` — it wraps only the public route group. The admin app at `admin.pillseek.com` does **not** load PostHog.

---

## Admin dashboard setup

The `/admin/analytics` → **PostHog** tab calls the backend API to run queries against your PostHog project. This requires a **Personal API Key** (different from the public project token).

### Creating a Personal API Key

1. Log in to [app.posthog.com](https://app.posthog.com).
2. Click your avatar (top-right) → **Personal Settings**.
3. Scroll to **Personal API keys** → click **Create personal API key**.
4. Give it a descriptive label (e.g. `PillSeek admin dashboard`).
5. Set the **scopes**:
   - `query:read` — required for analytics queries
   - `session_recording:read` — required for the replays widget
   - `project:read` — required to read project metadata
6. Click **Create key** and copy the key immediately (it won't be shown again).

### Setting the environment variable on Vercel

1. Go to your Vercel dashboard → `pill-project-admin` → **Settings** → **Environment Variables**.
2. Add:
   - **Name**: `POSTHOG_PERSONAL_API_KEY`
   - **Value**: the key you just copied
   - **Environments**: Production + Preview
3. Click **Save**, then **Redeploy** (or trigger a new deploy).

The following variables have safe defaults already set in `.env.example` but can be overridden if needed:

| Variable | Default | Notes |
|---|---|---|
| `POSTHOG_PROJECT_ID` | `396739` | Your PostHog project numeric ID |
| `POSTHOG_HOST` | `https://us.i.posthog.com` | US Cloud. Change to `https://eu.i.posthog.com` for EU Cloud. |

---

## Privacy notes

The PostHog integration is configured with strict privacy defaults:

- **`maskAllInputs: true`** — All input fields are masked in session recordings. Users' search queries and any form data are never captured as text.
- **`maskTextSelector: '[data-private]'`** — Add `data-private` to any element to exclude its text from recordings.
- **`person_profiles: 'identified_only'`** — PostHog does not create persistent person profiles for anonymous visitors. This saves quota and reduces data exposure. Profiles are only created if you explicitly call `posthog.identify()` with a user ID (relevant for future authenticated features).
- **Do-Not-Track**: To opt a specific user out of all PostHog capture (e.g. for a GDPR opt-out page), call:
  ```ts
  import posthog from 'posthog-js'
  posthog.opt_out_capturing()
  ```
  To re-enable:
  ```ts
  posthog.opt_in_capturing()
  ```

---

## Disabling session replay

Session replay uses additional quota. If you need to turn it off:

1. Open `frontend/app/lib/posthog.tsx`.
2. Change `disable_session_recording: false` to `disable_session_recording: true`.
3. Deploy.

Replay will stop being recorded immediately for new sessions. Existing recordings remain accessible in the PostHog dashboard.

---

## Backend endpoints

All endpoints require admin authentication (Supabase Bearer token) and return HTTP 200 with `{ "configured": false }` if `POSTHOG_PERSONAL_API_KEY` is not set.

| Endpoint | Description |
|---|---|
| `GET /api/admin/analytics/posthog/overview?range=28d` | Pageviews, sessions, users, timeseries, top pages, top events, referrers, country/device breakdowns |
| `GET /api/admin/analytics/posthog/funnel?range=28d` | Core user journey funnel (landing → search → drug page) |
| `GET /api/admin/analytics/posthog/replays?limit=10` | Recent session recordings with deep-link URLs to PostHog UI |
| `GET /api/admin/analytics/posthog/retention?range=12w` | Weekly retention cohort grid |

Responses are cached server-side for **5 minutes** to respect PostHog API rate limits.

---

## Future work (out of scope for v1)

- **Feature flags** — PostHog supports A/B tests and gradual rollouts via `posthog.getFeatureFlag()`. Leave as a TODO for a future PR once we know which features to experiment on.
- **Custom events** — Add `posthog.capture('pill_identified', { drug_name, imprint })` calls on key user actions once the measurement strategy is defined.
- **Server-side capture** — Capture backend events (e.g. search query results) using the PostHog Python SDK if needed for funnel completeness.
- **Surveys** — PostHog supports in-app surveys; useful for NPS or feature feedback after launch.
