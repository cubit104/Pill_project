# PillSeek — Identify Any Medication...

> Formerly known as IDMyPills.

**PillSeek** is a professional pill identification tool — search by imprint, drug name, NDC code, color, and shape. Backed by a Supabase PostgreSQL database, served by a FastAPI backend, with a modern Next.js + Tailwind CSS frontend.

## Architecture

```
pillseek.com → Render → FastAPI serves everything
                          ├── /api/*  → Python endpoints (search, details, filters, suggestions)
                          └── /*     → Next.js pre-built static pages (frontend/out/)
```

## Features

- Search pills by imprint, drug name, NDC code, color, and shape
- Autocomplete suggestions for drug names and imprints
- Filter lists for colors and shapes
- Full pill detail pages with SEO-friendly URLs (`/pill/{slug}`)
- NADAC-based **Pharmacy Cost Benchmark** (official CMS acquisition-cost pricing)
- Image gallery/carousel per pill
- NDC code lookup
- XML sitemap at `/sitemap.xml`
- Mobile-first responsive design (Next.js + Tailwind CSS)
- Schema.org structured data on pill detail pages
- **Admin dashboard** at `/admin` — manage pills, images, drafts, users (see below)

## Admin Dashboard

A form-based admin dashboard lives at `/admin`. It allows non-technical users to manage pill data, images, and content without writing SQL.

**Key features:**
- Magic link authentication (no passwords)
- Role-based access: `superadmin`, `editor`, `reviewer`, `readonly`
- Pill CRUD with soft delete and restore
- Draft + review + publish workflow for content changes
- Image upload to Supabase Storage
- Full audit log for every write action
- Optimistic locking to prevent lost updates

**Getting started with admin:**
1. Run the SQL migrations in `supabase/migrations/` against your Supabase project
2. Enable Magic Link auth in Supabase Dashboard → Authentication → Providers
3. Set the required environment variables (see `.env.example`)
4. Seed the first superadmin (see `ADMIN.md`)
5. Navigate to `/admin/login` and enter your email

See [`ADMIN.md`](./ADMIN.md) for architecture details and [`docs/admin-guide.md`](./docs/admin-guide.md) for the user guide.

## Requirements

- Python 3.10+
- Node.js 18+ (for building the frontend)
- PostgreSQL (Supabase)
- See `requirements.txt` for Python dependencies
- See `frontend/package.json` for frontend dependencies

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/cubit104/Pill_project.git
cd Pill_project
```

### 2. Create a virtual environment and install Python dependencies

```bash
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Configure environment variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

| Variable | Description | Required |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | ✅ Yes |
| `IMAGE_BASE` | Base URL for pill images on Supabase storage | No (has default) |
| `ALLOWED_ORIGINS` | Comma-separated list of allowed CORS origins | No (defaults to `https://pill0project.onrender.com,https://pill-project.vercel.app,https://pillseek.com,https://www.pillseek.com`) |
| `ALLOWED_ORIGINS_REGEX` | Regex pattern for additional CORS origins (e.g. Vercel preview URLs) | No (defaults to `https://pill-project-git-[a-z0-9\-]+\.vercel\.app`) |
| `SITE_URL` | Public site URL used in sitemap | No (defaults to `https://pillseek.com`) |
| `INDEXNOW_KEY` | IndexNow verification/submission key | No |
| `INDEXNOW_KEY_LOCATION` | Public IndexNow key file URL (defaults to `{SITE_URL}/{INDEXNOW_KEY}.txt`) | No |
| `NEXT_PUBLIC_TRENDING_MIN_VIEWS` | Minimum total pill views before showing "Trending This Week" on homepage (set to `0` on preview to verify without organic traffic) | No (defaults to `50`) |

### 4. Build the frontend

```bash
cd frontend
npm install
npm run build   # generates static export in frontend/out/
cd ..
```

### 5. Run the development server

```bash
uvicorn main:app --reload
```

The API and frontend will be available at `http://localhost:8000`.

## Deployment (Render)

The project includes a `Procfile` for Render deployments.

**Important:** Set your Render **Build Command** to:

```
bash build.sh
```

This runs `pip install -r requirements.txt` and then builds the Next.js frontend (`npm install && npm run build` in `frontend/`), producing the `frontend/out/` static export that FastAPI serves. Without this step, Render will only install Python packages and the new frontend will never be built — leaving the fallback `index.html` as the only page served.

1. Set environment variables in Render dashboard:
   - `DATABASE_URL` — your Supabase PostgreSQL connection string
   - `IMAGE_BASE` — Supabase storage base URL
   - `ALLOWED_ORIGINS` — your deployed frontend URL (e.g. `https://pillseek.com`)
   - `SITE_URL` — `https://pillseek.com`
   - `INDEXNOW_KEY` — generated IndexNow key
   - `INDEXNOW_KEY_LOCATION` — optional override, otherwise `{SITE_URL}/{INDEXNOW_KEY}.txt`

2. Set **Build Command** in Render dashboard:
   ```bash
   bash build.sh
   ```

## API Endpoints

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/` | Serves Next.js homepage |

### Search & Lookup

| Method | Path | Description |
|---|---|---|
| `GET` | `/search` | Serves search results page (Next.js) |
| `GET` | `/details` | Full details for a specific pill (JSON) |
| `GET` | `/ndc_lookup` | Lookup pill by NDC code (JSON) |
| `GET` | `/api/pill/{slug}` | Get pill by URL slug (JSON, used by frontend; includes `history_ndc`/`history_source` for price history resolution) |
| `GET` | `/pill/{slug}` | Serves pill detail page (Next.js HTML) |
| `GET` | `/api/prices/{ndc}` | NADAC benchmark + fair retail estimate |
| `GET` | `/api/prices/{ndc}/alternatives` | NADAC alternatives by active ingredient |
| `GET` | `/api/prices/{ndc}/history?weeks=52` | Weekly NADAC history points |

### Filters & Suggestions

| Method | Path | Description |
|---|---|---|
| `GET` | `/suggestions` | Autocomplete suggestions |
| `GET` | `/filters` | List of available pill colors and shapes |

### SEO

| Method | Path | Description |
|---|---|---|
| `GET` | `/sitemap.xml` | XML sitemap with all pill URLs |
| `GET` | `/robots.txt` | Served from Next.js static export |

### Query Parameters for `/search` (JSON API)

| Parameter | Type | Description |
|---|---|---|
| `q` | string | Search query |
| `type` | string | Search type: `imprint`, `drug`, or `ndc` |
| `color` | string | Pill color filter |
| `shape` | string | Pill shape filter |
| `page` | int | Page number (default: 1) |
| `per_page` | int | Results per page (default: 25, max: 100) |

## Database Schema

The `pillfinder` table includes these key columns for the frontend:

| Column | Description |
|---|---|
| `slug` | Unique URL-safe identifier (e.g. `aspirin-500mg-0069-0020-01`) |
| `meta_description` | Auto-generated SEO description |
| `medicine_name` | Drug name |
| `splimprint` | Imprint code |
| `splcolor_text` | Color |
| `splshape_text` | Shape |
| `image_filename` | Comma-separated image filenames |

## Running Tests

```bash
pip install pytest httpx
pytest tests/
```

## Pricing (NADAC Pharmacy Cost Benchmark)

- Source: CMS/data.medicaid.gov NADAC weekly data (free, official US government data)
- Purpose: show pharmacy acquisition-cost benchmark, not coupons and not out-of-pocket guarantees
- API route: `GET /api/prices/{ndc}` with `days_supply` and `units_per_day`
- Disclaimers are returned by API and shown in UI on the pill detail page

### Weekly refresh

```bash
python scripts/refresh_nadac.py --page-size 5000
```

GitHub Actions workflow: `.github/workflows/refresh-nadac.yml` (every Wednesday 14:00 UTC).

Required env vars:

- `DATABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NADAC_API_BASE_URL` (optional override)
- `NADAC_CATALOG_URL` (optional override)
- `RXNAV_API_BASE_URL` (optional override)

## Frontend Development

```bash
cd frontend
npm install
npm run dev    # development server at http://localhost:3000
npm run build  # production static export to frontend/out/
```

## Vercel Deployment (Two-Project Setup)

The frontend is split across two Vercel projects that build from the same repository:

| Project | Domain | Branch | `NEXT_PUBLIC_ENABLE_ADMIN` |
|---|---|---|---|
| `pill-project` | `pillseek.com` | `main` | unset / `false` |
| `pill-project-admin` | `admin.pillseek.com` | `develop` | `true` |

Both projects share the same Supabase database and Render backend (`API_BASE_URL`).

**How the split works:**

- `middleware.ts` checks `NEXT_PUBLIC_ENABLE_ADMIN` at request time.  When it is not `"true"`, any request to `/admin` or `/admin/*` is rewritten to a 404 page.  This means `pillseek.com/admin` is unreachable while `admin.pillseek.com/admin` works normally.
- The admin layout exports `robots: { index: false, follow: false }` so search engines never index `admin.pillseek.com`.
- `robots.ts` disallows `/admin/` for all crawlers on both domains.

**Environment variables per project:**

| Variable | `pill-project` | `pill-project-admin` |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ set | ✅ set (same value) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ set | ✅ set (same value) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ set | ✅ set (same value) |
| `API_BASE_URL` | ✅ set | ✅ set (same value) |
| `NEXT_PUBLIC_SITE_URL` | `https://pillseek.com` | `https://admin.pillseek.com` |
| `NEXT_PUBLIC_ENABLE_ADMIN` | *(unset)* | `true` |

## License

MIT — see [LICENSE](LICENSE).
