# IDMyPills — Identify Any Medication

**IDMyPills** is a professional pill identification tool — search by imprint, drug name, NDC code, color, and shape. Backed by a Supabase PostgreSQL database, served by a FastAPI backend, with a modern Next.js + Tailwind CSS frontend.

## Architecture

```
idmypills.com → Render → FastAPI serves everything
                          ├── /api/*  → Python endpoints (search, details, filters, suggestions)
                          └── /*     → Next.js pre-built static pages (frontend/out/)
```

## Features

- Search pills by imprint, drug name, NDC code, color, and shape
- Autocomplete suggestions for drug names and imprints
- Filter lists for colors and shapes
- Full pill detail pages with SEO-friendly URLs (`/pill/{slug}`)
- Image gallery/carousel per pill
- NDC code lookup
- XML sitemap at `/sitemap.xml`
- Mobile-first responsive design (Next.js + Tailwind CSS)
- Schema.org structured data on pill detail pages

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
| `ALLOWED_ORIGINS` | Comma-separated list of allowed CORS origins | No (defaults to `https://pill0project.onrender.com,https://idmypills.com,https://www.idmypills.com`) |
| `SITE_URL` | Public site URL used in sitemap | No (defaults to `https://idmypills.com`) |

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
   - `ALLOWED_ORIGINS` — your deployed frontend URL (e.g. `https://idmypills.com`)
   - `SITE_URL` — `https://idmypills.com`

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
| `GET` | `/api/pill/{slug}` | Get pill by URL slug (JSON, used by frontend) |
| `GET` | `/pill/{slug}` | Serves pill detail page (Next.js HTML) |

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

## Frontend Development

```bash
cd frontend
npm install
npm run dev    # development server at http://localhost:3000
npm run build  # production static export to frontend/out/
```

## License

MIT — see [LICENSE](LICENSE).

