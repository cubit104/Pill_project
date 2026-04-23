import os
import posixpath
import re
import logging
from functools import lru_cache
from typing import List, Dict, Any

import pandas as pd

logger = logging.getLogger(__name__)

# Supabase image base URL
IMAGE_BASE = os.getenv(
    "IMAGE_BASE",
    "https://uqdwcxizabmxwflkbfrb.supabase.co/storage/v1/object/public/images",
)

# Common image extensions to check
IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".tif"]
IMAGE_MIME_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
}

MAX_SUGGESTIONS = 10
MAX_IMAGES_PER_DRUG = 20


@lru_cache(maxsize=1000)
def normalize_text(text):
    """Normalize text for consistent display"""
    if not text or not isinstance(text, str):
        return ""

    preserve_terms = {
        'hcl': 'HCl',
        'mg': 'mg',
        'ml': 'mL',
        'mcg': 'mcg',
        'iu': 'IU',
        'fda': 'FDA',
        'usp': 'USP',
        'otc': 'OTC',
        'rx': 'Rx',
        'ndc': 'NDC',
        'dea': 'DEA',
        'rxcui': 'RxCUI',
        'er': 'ER',
        'sr': 'SR',
        'xr': 'XR',
        'dr': 'DR',
        'ir': 'IR',
        'ph': 'pH',
    }

    text = text.lower()
    sentences = re.split(r'([.!?]\s+)', text)
    result = []

    for i, part in enumerate(sentences):
        if i % 2 == 0:
            if part:
                part = part[0].upper() + part[1:] if part else part
                for term, replacement in preserve_terms.items():
                    part = re.sub(r'\b' + term + r'\b', replacement, part)
        result.append(part)

    normalized = ''.join(result)
    return normalized[0].upper() + normalized[1:] if normalized else ""


def clean_filename(filename: str) -> str:
    """Clean individual filename"""
    if pd.isna(filename) or not filename:
        return ""
    cleaned = re.sub(r'[^\w./-]', '', str(filename).strip())
    # Normalize and reject path traversal (..) or absolute paths
    normalized = posixpath.normpath(cleaned) if cleaned else ""
    if not normalized or normalized.startswith('/') or '..' in normalized.split('/'):
        return ""
    return normalized


def get_clean_image_list(image_str: str) -> List[str]:
    """Clean and normalize image filenames from DB (handles multiple extensions)"""
    if not image_str:
        return ["placeholder.jpg"]

    split_chars = re.split(r'[;,]', image_str)
    cleaned = []

    for name in split_chars:
        name = name.strip()
        if name.lower().endswith(tuple(IMAGE_EXTENSIONS)):
            cleaned.append(name)
        else:
            cleaned.append(f"{name}.jpg")

    return cleaned or ["placeholder.jpg"]


def split_image_filenames(filename: str) -> List[str]:
    """Split image filenames considering various separators"""
    if pd.isna(filename) or not filename:
        return []
    parts = re.split(r'[,;]+', str(filename))
    cleaned_parts = []
    for part in parts:
        cleaned_part = clean_filename(part)
        if cleaned_part:
            cleaned_parts.append(cleaned_part)
    return cleaned_parts


@lru_cache(maxsize=1000)
def normalize_imprint(value: str) -> str:
    """Normalize imprint value by standardizing format"""
    if pd.isna(value):
        return ""
    cleaned = re.sub(r'[;,\s]+', ' ', str(value)).strip().upper()
    return cleaned


@lru_cache(maxsize=1000)
def normalize_name(value: str) -> str:
    """Normalize drug name"""
    if pd.isna(value):
        return ""
    return str(value).strip().lower()


def get_unique_key(item: Dict) -> tuple:
    """Generate a unique key for deduplication"""
    return (
        normalize_name(item.get("medicine_name", "")),
        normalize_imprint(item.get("splimprint", "")),
        str(item.get("splcolor_text", "")).lower().strip(),
        str(item.get("splshape_text", "")).lower().strip(),
        str(item.get("rxcui", "")).strip()
    )


def generate_slug(medicine_name: str, spl_strength: str) -> str:
    """Generate a URL-safe slug from medicine name and strength.

    Format: {medicine_name}-{spl_strength} slugified
    Example: "Plavix" + "Clopidogrel bisulfate 300 mg" → "plavix-clopidogrel-bisulfate-300-mg"
    """
    parts = []
    if medicine_name:
        parts.append(str(medicine_name).strip())
    if spl_strength:
        parts.append(str(spl_strength).strip())
    combined = " ".join(parts)
    slug = combined.lower()
    slug = re.sub(r'[^a-z0-9]+', '-', slug)
    slug = slug.strip('-')
    return slug or "unknown"


def slugify_class(class_name: str) -> str:
    """Convert a pharmacologic class name to a URL-safe slug.

    Example: "HMG-CoA Reductase Inhibitors" → "hmg-coa-reductase-inhibitors"
             "ACE Inhibitors [EPC]" → "ace-inhibitors-epc"
    """
    if not class_name:
        return "unknown"
    slug = str(class_name).lower()
    slug = re.sub(r'[^a-z0-9]+', '-', slug)
    slug = slug.strip('-')
    return slug or "unknown"


def get_image_url(filename: str) -> str:
    """Get image URL from filename, removing validation"""
    if not filename:
        return f"{IMAGE_BASE}/placeholder.jpg"

    first_filename = filename.split(',')[0].strip()
    if not first_filename:
        return f"{IMAGE_BASE}/placeholder.jpg"

    return f"{IMAGE_BASE}/{first_filename}"


def get_image_urls(filenames_str: str) -> List[str]:
    """Get multiple image URLs from a comma/semicolon separated string"""
    if not filenames_str:
        return [f"{IMAGE_BASE}/placeholder.jpg"]

    parts = re.split(r'[,;]+', filenames_str)
    urls = []

    for part in parts:
        clean_part = part.strip()
        if clean_part:
            urls.append(f"{IMAGE_BASE}/{clean_part}")

    return urls or [f"{IMAGE_BASE}/placeholder.jpg"]


def process_image_filenames(image_filename: str) -> dict:
    """Process image filenames into required format for API responses"""
    if not image_filename:
        placeholder = f"{IMAGE_BASE}/placeholder.jpg"
        return {
            "image_urls": [placeholder],
            "has_multiple_images": False,
            "carousel_images": [{"id": 0, "url": placeholder}]
        }

    image_urls = get_image_urls(image_filename)

    return {
        "image_urls": image_urls[:MAX_IMAGES_PER_DRUG],
        "has_multiple_images": len(image_urls) > 1,
        "carousel_images": [
            {"id": i, "url": url} for i, url in enumerate(image_urls[:MAX_IMAGES_PER_DRUG])
        ]
    }


def normalize_fields(data: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize text fields in a data dictionary"""
    fields_to_normalize = [
        "medicine_name", "splcolor_text", "splshape_text",
        "dailymed_pharma_class_epc", "pharmclass_fda_epc",
        "dosage_form", "spl_strength", "spl_ingredients", "spl_inactive_ing",
        "status_rx_otc", "dea_schedule_name", "splroute", "route"
    ]

    for field in fields_to_normalize:
        if field in data and data[field]:
            data[field] = normalize_text(str(data[field]))

    return data
