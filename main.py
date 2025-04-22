import os
import psycopg2
from fastapi import FastAPI, Query
from fastapi.responses import HTMLResponse
import uvicorn  # Import uvicorn to run the app

# FastAPI instance
app = FastAPI()

# Get environment variables (Render will inject them)
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:Potato6200$supabase@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=verify-full")
IMAGE_BASE = os.getenv("IMAGE_BASE", "https://uqdwcxizabmxwflkbfrb.supabase.co/storage/v1/object/public/images")

# Establish a connection to PostgreSQL
def get_db_connection():
    conn = psycopg2.connect(DATABASE_URL)
    return conn

# Home route with search form
@app.get("/", response_class=HTMLResponse)
async def home():
    return """
    <html>
        <head><title>Pill Search</title></head>
        <body>
            <h2>Search for Medicine</h2>
            <form action="/search">
                <input type="text" name="medicine_name" placeholder="Enter medicine name" required>
                <button type="submit">Search</button>
            </form>
        </body>
    </html>
    """

# Search route to fetch data from the database and display results
@app.get("/search", response_class=HTMLResponse)
async def search(medicine_name: str):
    conn = get_db_connection()
    cursor = conn.cursor()

    # Change query to use exact match instead of ILIKE
    query = """
        SELECT medicine_name, splshape_text, splcolor_text, splimprint, image_filename 
        FROM pillfinder
        WHERE medicine_name = %s;
    """
    cursor.execute(query, (medicine_name,))
    records = cursor.fetchall()

    conn.close()

    if not records:
        return "<h3>No results found</h3>"

    # Start constructing the HTML content
    html_content = "<h2>Search Results:</h2>"
    for record in records:
        medicine_name = record[0]
        shape = record[1]
        color = record[2]
        imprint = record[3]
        image_filename = record[4]

        # Handle various image formats (jpg, jpeg, png, etc.)
        if image_filename:
            image_url = f"{IMAGE_BASE}/{image_filename}"
        else:
            image_url = None

        html_content += f"""
        <div>
            <h3>{medicine_name}</h3>
            <p>Shape: {shape}</p>
            <p>Color: {color}</p>
            <p>Imprint: {imprint}</p>
            {f'<img src="{image_url}" alt="{medicine_name}" width="200">' if image_url else '<p>No image available</p>'}
        </div>
        """

    return html_content

# To run the server, bind to the correct port (for Render)
if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=10000, reload=True)
