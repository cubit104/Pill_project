import logging

from fastapi import APIRouter, HTTPException
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

import database

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/filters")
def get_filters():
    """Get available filters for colors and shapes"""
    if not database.db_engine:
        if not database.connect_to_database():
            raise HTTPException(status_code=500, detail="Database connection not available")

    try:
        def clean_shape(shape):
            shape = str(shape).strip().lower()
            replacements = {
                "capsule": ("Capsule", "💊"),
                "round": ("Round", "⚪"),
                "oval": ("Oval", "⬭"),
                "rectangle": ("Rectangle", "▭"),
                "triangle": ("Triangle", "🔺"),
                "square": ("Square", "◼"),
                "pentagon": ("Pentagon", "⬟"),
                "hexagon": ("Hexagon", "⬢"),
                "diamond": ("Diamond", "🔷"),
                "heart": ("Heart", "❤️"),
                "tear": ("Tear", "💧"),
                "trapezoid": ("Trapezoid", "⬯"),
            }
            for key, (name, icon) in replacements.items():
                if key in shape:
                    return {"name": name, "icon": icon}
            return {"name": shape.title(), "icon": "🔹"}

        standard_colors = {
            "White": "#FFFFFF",
            "Blue": "#0000FF",
            "Green": "#008000",
            "Red": "#FF0000",
            "Yellow": "#FFFF00",
            "Pink": "#FFC0CB",
            "Orange": "#FFA500",
            "Purple": "#800080",
            "Gray": "#808080",
            "Brown": "#A52A2A",
            "Beige": "#F5F5DC",
        }

        colors = [{"name": name, "hex": hexcode} for name, hexcode in standard_colors.items()]

        with database.db_engine.connect() as conn:
            shape_query = text("""
                SELECT DISTINCT splshape_text FROM pillfinder
                WHERE splshape_text IS NOT NULL AND splshape_text != ''
            """)
            result = conn.execute(shape_query)

            seen: set = set()
            unique_shapes = []

            for row in result:
                shape = row[0]
                if shape:
                    item = clean_shape(shape)
                    if item["name"] not in seen:
                        unique_shapes.append(item)
                        seen.add(item["name"])

        return {
            "colors": colors,
            "shapes": sorted(unique_shapes, key=lambda x: x["name"]),
        }

    except SQLAlchemyError:
        logger.exception("Database error in get_filters")
        raise HTTPException(status_code=500, detail="Internal server error")
    except Exception:
        logger.exception("Error getting filters")
        raise HTTPException(status_code=500, detail="Internal server error")
