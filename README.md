# Pill Identifier API

A FastAPI-based application for identifying pills and medications using visual characteristics, NDC codes, and drug names.

## Features

- **Pill Search**: Search by imprint, drug name, or NDC code
- **Visual Filters**: Filter by color and shape
- **Image Support**: Multiple images per medication
- **NDC Lookup**: National Drug Code validation and lookup
- **Cardiac Device Integration**: Separate service for cardiac monitoring (see `cardiac-monitor/` directory)

## Quick Start

### Prerequisites

- Python 3.8+ (recommended: Python 3.10 or 3.11)
- pip (Python package manager)

### Installation

#### Method 1: Standard pip installation (Recommended)

```bash
# Clone the repository
git clone <repository-url>
cd Pill_project

# Create a virtual environment (recommended)
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# If you need aiohttp for async HTTP features
pip install -r requirements-full.txt
```

#### Method 2: If you encounter compilation errors

If you see errors like `ERROR: Failed building wheel for aiohttp`, try these solutions:

**Option A: Install system dependencies (Linux/Ubuntu)**
```bash
sudo apt-get update
sudo apt-get install build-essential python3-dev libffi-dev
pip install -r requirements.txt
```

**Option B: Use conda (if available)**
```bash
conda env create -f environment.yml
conda activate pill_project
```

**Option C: Install with pre-compiled wheels only**
```bash
pip install --only-binary=all -r requirements.txt
```

**Option D: Docker (recommended for consistent environments)**
```bash
# Using docker-compose (includes database)
docker-compose up

# Or build and run manually
docker build -t pill-identifier .
docker run -p 8000:8000 pill-identifier
```

### Running the Application

```bash
# Start the development server
python main.py

# Or using uvicorn directly
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

The application will be available at:
- Main interface: http://localhost:8000
- API documentation: http://localhost:8000/docs
- Health check: http://localhost:8000/health

## API Endpoints

### Core Endpoints

- `GET /` - Main interface
- `GET /health` - Health check and system status
- `GET /search` - Search pills by various criteria
- `GET /details` - Get detailed information about a specific pill
- `GET /suggestions` - Get search suggestions
- `GET /filters` - Get available color and shape filters
- `GET /ndc_lookup` - Look up medication by NDC code

### Search Examples

**Search by imprint:**
```bash
curl "http://localhost:8000/search?q=A10&type=imprint"
```

**Search by drug name:**
```bash
curl "http://localhost:8000/search?q=aspirin&type=drug"
```

**Search with filters:**
```bash
curl "http://localhost:8000/search?q=round&type=imprint&color=white&shape=round"
```

## Environment Variables

Create a `.env` file in the project root:

```env
# Database configuration (if different from default)
DATABASE_URL=postgresql://user:password@host:port/database

# Image storage configuration
IMAGE_BASE=https://your-image-storage.com/path

# Optional: Logging level
LOG_LEVEL=INFO
```

## Deployment

### Local Development
```bash
python main.py
```

### Production (using Gunicorn)
```bash
pip install gunicorn
gunicorn main:app -w 4 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000
```

### Docker (recommended for production)
```bash
# Using docker-compose
docker-compose up -d

# Or using Docker directly
docker build -t pill-identifier .
docker run -p 8000:8000 -e DATABASE_URL="your_db_url" pill-identifier
```

### Heroku
The project includes a `Procfile` for Heroku deployment:
```bash
git add .
git commit -m "Deploy to Heroku"
git push heroku main
```

## Troubleshooting

### Common Installation Issues

**1. aiohttp compilation errors**
```
ERROR: Failed building wheel for aiohttp
error: command '/usr/bin/gcc' failed with exit code 1
```

**Solutions:**
- Install system build tools: `sudo apt-get install build-essential python3-dev`
- Use Python 3.10 or 3.11 (better wheel support)
- Try: `pip install --upgrade pip setuptools wheel`
- Use conda instead of pip for problematic packages

**2. ModuleNotFoundError: No module named 'fastapi'**

**Solutions:**
- Ensure virtual environment is activated
- Reinstall requirements: `pip install -r requirements.txt`
- Check Python path: `python -c "import sys; print(sys.path)"`

**3. Database connection errors**

**Solutions:**
- Check DATABASE_URL in environment variables
- Ensure PostgreSQL is running and accessible
- Verify credentials and network connectivity

**4. Missing image files**

The application gracefully handles missing images by showing placeholders. Check:
- IMAGE_BASE URL is accessible
- Image files exist in the configured storage
- Network connectivity to image storage

### Platform-Specific Notes

**GitHub Codespaces:**
- Use Python 3.10 or 3.11 for best compatibility
- Install build tools if needed: `sudo apt-get install build-essential`
- Consider using `--only-binary=all` flag for pip

**Windows:**
- Use Windows Subsystem for Linux (WSL) for better compatibility
- Install Microsoft C++ Build Tools if compilation is needed
- Consider using conda for easier dependency management

**macOS:**
- Install Xcode Command Line Tools: `xcode-select --install`
- Consider using Homebrew for system dependencies

## Package Versions

The requirements are pinned to specific versions to ensure compatibility and avoid compilation issues:

- **FastAPI stack**: Pinned to compatible versions (fastapi==0.104.1, uvicorn==0.24.0)
- **HTTP clients**: httpx==0.25.1, requests==2.31.0 (aiohttp is optional)
- **Database**: sqlalchemy==1.4.39, psycopg2-binary==2.9.9 (pre-compiled)
- **Data processing**: pandas==2.1.3 with compatible numpy version

### Why these versions?

1. **aiohttp is optional**: The main application doesn't require aiohttp unless you need specific async HTTP features
2. **Pre-built wheels**: All pinned versions have pre-built wheels for common platforms (Linux, Windows, macOS)
3. **Compatibility**: Versions are tested together to avoid dependency conflicts
4. **Stability**: Using mature, stable versions rather than cutting-edge releases

### Alternative installation files:

- `requirements.txt` - Core dependencies (recommended)
- `requirements-full.txt` - Includes aiohttp for async HTTP features
- `requirements-dev.txt` - Development dependencies
- `environment.yml` - Conda environment file

## Development

### Setting up development environment

```bash
# Clone and setup
git clone <repository-url>
cd Pill_project
python -m venv venv
source venv/bin/activate

# Install development dependencies
pip install -r requirements.txt

# Run tests (if available)
python -m pytest

# Run with hot reload
uvicorn main:app --reload
```

### Code Structure

```
Pill_project/
├── main.py                 # Main FastAPI application
├── ndc_module.py           # NDC handling logic
├── ndc_helper.py           # NDC utility functions
├── requirements.txt        # Python dependencies
├── Procfile               # Heroku deployment config
├── cardiac-monitor/       # Cardiac device integration service
│   └── backend/
│       ├── main.py
│       └── requirements.txt
├── static files (HTML, etc.)
└── README.md
```

## License

[Add your license information here]

## Contributing

[Add contribution guidelines here]

## Support

For issues and questions:
1. Check this README's troubleshooting section
2. Review the API documentation at `/docs`
3. Check the health endpoint for system status
4. [Add contact information or issue tracker]