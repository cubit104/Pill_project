# Pill Identifier API

A FastAPI-based REST API for identifying pills and medications using imprint codes, drug names, NDC codes, color, and shape. Backed by a Supabase PostgreSQL database with image carousel support.

## Features

- Search pills by imprint, drug name, NDC code, color, and shape
- Autocomplete suggestions for drug names and imprints
- Filter lists for colors and shapes
- Full pill details including images (carousel)
- NDC code lookup
- Connection pooling and query caching for performance

## Requirements

- Python 3.10+
- PostgreSQL (Supabase)
- See `requirements.txt` for Python dependencies

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/cubit104/Pill_project.git
cd Pill_project
```

### 2. Create a virtual environment and install dependencies

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
| `ALLOWED_ORIGINS` | Comma-separated list of allowed CORS origins | No (defaults to `https://pill0project.onrender.com`) |

### 4. Run the development server

```bash
uvicorn main:app --reload
```

The API will be available at `http://localhost:8000`.

## Deployment (Render)

The project includes a `Procfile` for Render/Heroku deployments. Set the following environment variables in your Render dashboard:

- `DATABASE_URL` — your Supabase PostgreSQL connection string
- `IMAGE_BASE` — Supabase storage base URL
- `ALLOWED_ORIGINS` — your deployed frontend URL (e.g. `https://pill0project.onrender.com`)

## API Endpoints

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/` | Root redirect |

### Search & Lookup

| Method | Path | Description |
|---|---|---|
| `GET` | `/search` | Search pills by imprint, name, color, shape |
| `GET` | `/details/{rxcui}` | Full details for a specific pill |
| `GET` | `/ndc/{ndc_code}` | Lookup pill by NDC code |

### Filters & Suggestions

| Method | Path | Description |
|---|---|---|
| `GET` | `/suggestions` | Autocomplete suggestions |
| `GET` | `/filters/colors` | List of available pill colors |
| `GET` | `/filters/shapes` | List of available pill shapes |

### Query Parameters for `/search`

| Parameter | Type | Description |
|---|---|---|
| `imprint` | string | Pill imprint code |
| `name` | string | Drug name (partial match) |
| `color` | string | Pill color |
| `shape` | string | Pill shape |
| `ndc` | string | NDC code |
| `page` | int | Page number (default: 1) |
| `limit` | int | Results per page (default: 20, max: 100) |

## Running Tests

```bash
pip install pytest httpx
pytest tests/
```

## License

MIT — see [LICENSE](LICENSE).
