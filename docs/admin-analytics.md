# Admin Analytics & SEO Monitoring

The `/admin/analytics` page provides a fully-featured analytics and SEO dashboard
combining Google Analytics 4, Google Search Console, Core Web Vitals (PageSpeed
Insights), and an automated page-health audit of your own database.

---

## Tabs

| Tab | Data source | Requires config? |
|-----|------------|-----------------|
| Overview | GA4 + Search Console + DB | GA4 + GSC |
| Traffic | GA4 | GA4 |
| SEO | Search Console | GSC |
| Performance | PageSpeed Insights API | PAGESPEED_API_KEY |
| Page Health | Your pill database | **None** |

All tabs gracefully show a "Not configured" card when the required env vars are
missing — they never crash.

---

## Why OAuth2 instead of a service account?

GA4 properties tied to a personal Google account cannot easily grant access to a
service account — the GA4 property owner must be the one who authorises access.
The **OAuth2 refresh-token flow** lets the property owner consent once and the
server uses that long-lived token indefinitely without further interaction.

---

## Environment Variables

Add these to your `.env` (local) and to your hosting provider's env settings
(Render / Railway / Fly / Vercel):

```env
# ── Google Analytics 4 ─────────────────────────────────────────────────────
GA4_PROPERTY_ID=123456789

# ── Google OAuth2 (GA4 + Search Console) ───────────────────────────────────
GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=your-client-secret
GOOGLE_OAUTH_REFRESH_TOKEN=your-long-lived-refresh-token

# ── Google Search Console ───────────────────────────────────────────────────
# Must match the exact verified URL in GSC (trailing slash matters!)
SEARCH_CONSOLE_SITE_URL=https://pillseek.com/

# ── PageSpeed Insights ──────────────────────────────────────────────────────
PAGESPEED_API_KEY=AIzaSy...
```

---

## Setting up Google Analytics 4 & Search Console (OAuth2 flow)

### Step 1 — Create OAuth 2.0 credentials in Google Cloud Console

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and select
   (or create) your project.
2. Navigate to **APIs & Services → Credentials → Create credentials → OAuth client ID**.
3. Choose **Application type: Desktop app** (simplest) and give it a name.
4. Note the **Client ID** and **Client Secret** — you'll need them below.
5. Back on the Credentials page, also make sure the **OAuth consent screen** is
   configured (add yourself as a test user if the app is in "testing" mode).

### Step 2 — Enable the required APIs

In **APIs & Services → Library**, enable:
- **Google Analytics Data API** (for GA4)
- **Google Search Console API** (for GSC)

### Step 3 — Find your GA4 Property ID

Go to [analytics.google.com](https://analytics.google.com) → Admin → Property →
**Property details** and copy the **Property ID** (numbers only, e.g. `123456789`).

### Step 4 — Run the bootstrap script to get a refresh token

Set your client credentials in the environment and run the helper script **once**
from your local machine:

```bash
export GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
export GOOGLE_OAUTH_CLIENT_SECRET=your-client-secret

# From the repository root:
pip install google-auth-oauthlib   # if not already installed
python scripts/get_ga_refresh_token.py
```

A browser window opens for you to log in with the Google account that owns the GA4
property and Search Console site.  After consent the script prints:

```
GOOGLE_OAUTH_REFRESH_TOKEN=1//0g...
```

Copy that value — it does not expire unless you explicitly revoke it.

### Step 5 — Add all values to your environment

```env
GA4_PROPERTY_ID=123456789
GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=your-client-secret
GOOGLE_OAUTH_REFRESH_TOKEN=1//0g...
SEARCH_CONSOLE_SITE_URL=https://pillseek.com/
```

Restart the backend service after updating env vars.

### Troubleshooting

| Symptom | Likely cause |
|---------|-------------|
| `configured: false` on GA4/GSC tabs | One or more OAuth env vars are empty |
| `Token has been expired or revoked` | The refresh token was revoked — re-run the bootstrap script |
| `Access Not Configured` | The GA Data API or Search Console API is not enabled in your GCP project |

---

## Setting up PageSpeed Insights

1. Go to [Google Cloud Console](https://console.cloud.google.com) → **APIs &
   Services → Library** → search **PageSpeed Insights API** → enable it.
2. Navigate to **APIs & Services → Credentials** → **Create credentials → API key**.
3. Restrict the key to the PageSpeed Insights API (recommended).
4. Set `PAGESPEED_API_KEY=<your-key>`.

Free tier: 25,000 requests/day — more than enough for manual audits.

---

## Page Health Audit

The **Page Health** tab requires **no external configuration** — it queries your
own pill database. It detects:

| Issue | Severity |
|-------|----------|
| Garbage `drug_name` (contains "Inert Ingredients", starts with digit, > 80 chars, has semicolons + counts) | Critical |
| Missing `meta_title` | Critical |
| Missing `meta_description` | Critical |
| `meta_title` < 30 or > 60 chars | Warning |
| `meta_description` < 100 or > 160 chars | Warning |
| Duplicate `meta_title` across pages | Warning |
| Duplicate `meta_description` across pages | Warning |
| `noindex` set | Warning |

Each issue row links to the pill edit screen (`/admin/pills/<id>`) so you can fix
it inline.

> **Note**: The `meta_title`, `meta_description`, and `noindex` columns may not
> exist in your DB yet. The endpoint gracefully falls back to a basic query if
> these columns are missing.

---

## Backend Endpoints

All endpoints require a valid admin Bearer token (same as other admin routes).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/analytics/ga4/overview?range=28d` | GA4 summary, timeseries, top pages, devices, countries |
| `GET` | `/api/admin/analytics/search-console/overview?range=28d` | GSC clicks, impressions, CTR, top queries, top pages |
| `POST` | `/api/admin/analytics/pagespeed/run` | `{ url, strategy }` → CWV metrics |
| `GET` | `/api/admin/analytics/page-health` | DB audit — SEO & data quality issues |

`range` accepts `7d`, `28d`, or `90d`.

If a service is not configured, endpoints return HTTP 200 with:
```json
{ "configured": false, "message": "..." }
```
rather than an error — the frontend renders a friendly setup card.

---

## Python Dependencies

Added to `requirements.txt`:
- `google-analytics-data` — GA4 Data API v1beta client
- `google-api-python-client` — Search Console API
- `google-auth` — Google authentication base library
- `google-auth-oauthlib` — OAuth2 flow helpers (refresh-token support)

Install locally:
```bash
pip install -r requirements.txt
```

