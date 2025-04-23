from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse
import psycopg2
from datetime import datetime

# Initialize FastAPI app
app = FastAPI()

# CORS settings - allow all origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8000",
        "https://your-production-domain.com"
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# Supabase Storage Base URL
IMAGE_BASE = "https://uqdwcxizabmxwflkbfrb.supabase.co/storage/v1/object/public/images"

# Database connection settings
DATABASE_URL = "postgresql://postgres.uqdwcxizabmxwflkbfrb:Potato6200$supabase@aws-0-us-east-1.pooler.supabase.com:5432/postgres"

def get_db_connection():
    conn = psycopg2.connect(DATABASE_URL)
    return conn

@app.get("/", response_class=HTMLResponse)
async def home():
    # Get current datetime for display
    current_time = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    
    return f"""
    <html>
        <head>
            <title>Pill Search</title>
            <style>
                body {{ font-family: Arial, sans-serif; margin: 20px; }}
                .search-form {{ margin: 20px 0; }}
                input {{ padding: 8px; width: 300px; }}
                button {{ padding: 8px 16px; background: #4CAF50; color: white; border: none; cursor: pointer; }}
                .footer {{ margin-top: 20px; font-size: 0.8em; color: #666; }}
            </style>
        </head>
        <body>
            <h2>Search for Medicine</h2>
            <form class="search-form" action="/search">
                <input type="text" name="medicine_name" placeholder="Enter medicine name" required>
                <button type="submit">Search</button>
            </form>
            <div class="footer">Current UTC Time: {current_time}</div>
        </body>
    </html>
    """

# Simple image endpoint - no query parameters needed
@app.get("/image/{image_filename}")
async def get_image(image_filename: str):
    # Create direct URL to Supabase storage
    image_url = f"{IMAGE_BASE}/{image_filename}"
    return RedirectResponse(url=image_url)

@app.get("/search", response_class=HTMLResponse)
async def search(medicine_name: str):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        query = """
            SELECT medicine_name, splshape_text, splcolor_text, splimprint, image_filename 
            FROM pillfinder
            WHERE LOWER(medicine_name) = LOWER(%s);
        """
        cursor.execute(query, (medicine_name,))
        records = cursor.fetchall()
        
        conn.close()

        if not records:
            return "<h3>No results found</h3>"

        html_content = f"""
        <html>
            <head>
                <title>Results for {medicine_name}</title>
                <style>
                    body {{ font-family: Arial, sans-serif; margin: 20px; }}
                    .pill-card {{ border: 1px solid #ddd; padding: 15px; margin-bottom: 20px; border-radius: 5px; }}
                    .pill-images {{ display: flex; flex-wrap: wrap; gap: 10px; }}
                    .pill-images img {{ max-width: 200px; height: auto; border: 1px solid #eee; }}
                </style>
            </head>
            <body>
                <h2>Search Results for "{medicine_name}":</h2>
                <a href="/">Back to Search</a>
        """

        for record in records:
            medicine_name = record[0]
            shape = record[1] or "Not specified"
            color = record[2] or "Not specified"
            imprint = record[3] or "Not specified"
            image_filenames = record[4]  # Comma-separated list of image filenames

            html_content += f"""
            <div class="pill-card">
                <h3>{medicine_name}</h3>
                <p><strong>Shape:</strong> {shape}</p>
                <p><strong>Color:</strong> {color}</p>
                <p><strong>Imprint:</strong> {imprint}</p>
                <p><strong>Images:</strong></p>
                <div class="pill-images">
            """

            # Process image filenames
            if image_filenames:
                # Set to track unique filenames
                processed_images = set()
                
                for filename in image_filenames.split(','):
                    # Clean up the filename
                    clean_filename = filename.strip()
                    
                    # Add extension if missing
                    if not clean_filename.lower().endswith(('.jpg', '.jpeg', '.png', '.gif')):
                        clean_filename += '.jpg'
                    
                    # Skip if we've already processed this filename
                    if clean_filename in processed_images:
                        continue
                    
                    processed_images.add(clean_filename)
                    
                    # Simple direct image link - no extra parameters needed
                    html_content += f"""
                    <img src="/image/{clean_filename}" alt="{medicine_name}" />
                    """
            else:
                html_content += "<p>No images available</p>"

            html_content += "</div></div>"

        current_time = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        html_content += f"""
                <div class="footer">Current UTC Time: {current_time}</div>
            </body>
        </html>
        """

        return html_content
        
    except Exception as e:
        return f"<h3>Error: {str(e)}</h3><p><a href='/'>Back to Search</a></p>"
