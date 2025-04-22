import os
from fastapi import FastAPI, Query
from fastapi.responses import HTMLResponse
from sqlalchemy import create_engine, Column, String
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# FastAPI instance
app = FastAPI()

# Database configuration
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:Potato6200$supabase@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=verify-full")
IMAGE_BASE = os.getenv("IMAGE_BASE", "https://uqdwcxizabmxwflkbfrb.supabase.co/storage/v1/object/public/images")

# SQLAlchemy setup
Base = declarative_base()

# Define the pillfinder table as a SQLAlchemy model
class PillFinder(Base):
    __tablename__ = 'pillfinder'

    medicine_name = Column(String, primary_key=True)
    splshape_text = Column(String)
    splcolor_text = Column(String)
    splimprint = Column(String)
    image_filename = Column(String)

# Create SQLAlchemy engine and session
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

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
    db = SessionLocal()  # Get database session
    try:
        # Query the pillfinder table using SQLAlchemy
        pill = db.query(PillFinder).filter(PillFinder.medicine_name == medicine_name).first()

        if pill is None:
            return "<h3>No results found</h3>"

        # Construct HTML response
        html_content = f"""
        <h2>Search Results:</h2>
        <div>
            <h3>{pill.medicine_name}</h3>
            <p>Shape: {pill.splshape_text}</p>
            <p>Color: {pill.splcolor_text}</p>
            <p>Imprint: {pill.splimprint}</p>
            {"<img src='" + IMAGE_BASE + "/" + pill.image_filename + "' alt='" + pill.medicine_name + "' width='200'>" if pill.image_filename else "<p>No image available</p>"}
        </div>
        """

        return html_content
    finally:
        db.close()

# To run the server, bind to the correct port (for Render)
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=10000, reload=True)
