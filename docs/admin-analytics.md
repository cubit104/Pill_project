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

## Environment Variables

Add these to your `.env` (local) and to your hosting provider's env settings
(Render / Railway / Fly):

```env
# ── Google Analytics 4 ─────────────────────────────────────────────────────
GA4_PROPERTY_ID=123456789
# Either paste the entire service account JSON as a single-line string:
GA4_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"..."}
# Or provide an absolute path to the JSON file:
# GA4_SERVICE_ACCOUNT_JSON=/etc/secrets/ga4-service-account.json

# ── Google Search Console ───────────────────────────────────────────────────
# Must match the exact verified URL in GSC (trailing slash matters!)
SEARCH_CONSOLE_SITE_URL=https://pillseek.com/

# ── PageSpeed Insights ──────────────────────────────────────────────────────
PAGESPEED_API_KEY=AIzaSy...
```

---

## Setting up Google Analytics 4

1. Go to [analytics.google.com](https://analytics.google.com) → Admin → Property
   → **Property details** and copy the **Property ID** (numbers only).
2. In [Google Cloud Console](https://console.cloud.google.com):
   - Create or select a project.
   - Navigate to **IAM & Admin → Service Accounts** → **Create Service Account**.
   - Give it a name (e.g. `pillseek-analytics`).
   - Download a **JSON key** for the service account.
3. Back in GA4 → Admin → **Account access management** → add the service account's
   email with **Viewer** role.
4. Set `GA4_PROPERTY_ID` to your property ID (e.g. `"320154789"`).
5. Set `GA4_SERVICE_ACCOUNT_JSON` to the full JSON key (as one line) **or** to the
   absolute path of the saved JSON file.

---

## Setting up Google Search Console

1. Verify your site at [search.google.com/search-console](https://search.google.com/search-console).
2. In Search Console → **Settings → Users and permissions** → **Add user** → paste the
   service account email from the GA4 setup above → grant **Restricted** access.
3. Set `SEARCH_CONSOLE_SITE_URL` to the exact verified URL (e.g. `https://pillseek.com/`).
   > ⚠️ The URL must match *exactly* — including or excluding the trailing slash.

The same service account JSON (`GA4_SERVICE_ACCOUNT_JSON`) is reused for both GA4
and Search Console — no separate credential is needed.

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
- `google-auth` — Service account authentication

Install locally:
```bash
pip install -r requirements.txt
```
