"""
Authoritative field schema for pillfinder editable columns.
Mirrors frontend/app/admin/lib/fieldSchema.ts — keep in sync.
"""
from typing import List, Dict, Any

FIELD_SCHEMA: List[Dict[str, Any]] = [
    # Tier 1 — Required
    {"key": "medicine_name",     "label": "Drug Name",              "tier": "required"},
    {"key": "author",            "label": "Manufacturer",           "tier": "required"},
    {"key": "spl_strength",      "label": "Strength",               "tier": "required"},
    {"key": "splimprint",        "label": "Imprint",                "tier": "required"},
    {"key": "splcolor_text",     "label": "Color",                  "tier": "required"},
    {"key": "splshape_text",     "label": "Shape",                  "tier": "required"},
    {"key": "slug",              "label": "Slug",                   "tier": "required"},

    # Tier 2 — Required or N/A
    {"key": "ndc9",              "label": "NDC-9",                  "tier": "required_or_na"},
    {"key": "ndc11",             "label": "NDC-11",                 "tier": "required_or_na"},
    {"key": "dosage_form",       "label": "Dosage Form",            "tier": "required_or_na"},
    {"key": "route",             "label": "Route",                  "tier": "required_or_na"},
    {"key": "spl_ingredients",   "label": "Active Ingredients",     "tier": "required_or_na"},
    {"key": "spl_inactive_ing",  "label": "Inactive Ingredients",   "tier": "required_or_na"},
    {"key": "dea_schedule_name", "label": "DEA Schedule",           "tier": "required_or_na"},
    {"key": "status_rx_otc",     "label": "Rx/OTC Status",          "tier": "required_or_na"},
    {"key": "image_alt_text",    "label": "Image Alt Text",         "tier": "required_or_na",
     "conditional": "has_image"},

    # Tier 3 — Optional
    {"key": "brand_names",       "label": "Brand Names",            "tier": "optional"},
    {"key": "splsize",           "label": "Size",                   "tier": "optional"},
    {"key": "meta_description",  "label": "Meta Description",       "tier": "optional"},
    {"key": "pharmclass_fda_epc","label": "FDA Pharma Class",       "tier": "optional"},
    {"key": "rxcui",             "label": "RxCUI",                  "tier": "optional"},
    {"key": "rxcui_1",           "label": "RxCUI Alt",              "tier": "optional"},
    {"key": "imprint_status",    "label": "Imprint Status",         "tier": "optional"},
    {"key": "tags",              "label": "Tags",                   "tier": "optional"},
]

# Indexed by key for fast lookup
FIELD_SCHEMA_BY_KEY: Dict[str, Dict[str, Any]] = {f["key"]: f for f in FIELD_SCHEMA}

TIER1_KEYS = [f["key"] for f in FIELD_SCHEMA if f["tier"] == "required"]
TIER2_KEYS = [f["key"] for f in FIELD_SCHEMA if f["tier"] == "required_or_na"]
TIER3_KEYS = [f["key"] for f in FIELD_SCHEMA if f["tier"] == "optional"]


def _is_empty(value: Any) -> bool:
    """Return True if the value is None or an empty/whitespace-only string."""
    if value is None:
        return True
    return str(value).strip() == ""


def _is_na(value: Any) -> bool:
    """Return True if the value is the N/A sentinel (case-insensitive)."""
    if value is None:
        return False
    return str(value).strip().upper() == "N/A"


def validate_pill(data: dict, strict: bool = False) -> list:
    """
    Validate pill data against the field schema.

    Args:
        data: dict of pill field values
        strict: if True, enforce Tier 1 + Tier 2 completeness (publish mode);
                if False, skip all completeness validation (draft-save mode allows partial data).

    Returns:
        List of error dicts: [{"field": str, "message": str}, ...]
    """
    errors = []

    # Tier 1: required when publishing
    if strict:
        for key in TIER1_KEYS:
            if _is_empty(data.get(key)):
                label = FIELD_SCHEMA_BY_KEY[key]["label"]
                errors.append({"field": key, "message": f"{label} is required"})

        has_image = str(data.get("has_image", "") or "").upper() == "TRUE"
        for key in TIER2_KEYS:
            schema_entry = FIELD_SCHEMA_BY_KEY[key]
            # Skip conditional fields when condition is not met
            if schema_entry.get("conditional") == "has_image" and not has_image:
                continue
            val = data.get(key)
            if _is_empty(val) and not _is_na(val):
                label = schema_entry["label"]
                errors.append({
                    "field": key,
                    "message": f"{label} is required or must be set to N/A",
                })

    return errors


def compute_completeness(data: dict) -> dict:
    """
    Compute completeness metrics for a pill.

    Returns:
        {
            "score": int (0–100),
            "missing_required": list[str],
            "needs_na_confirmation": list[str],
            "optional_empty": list[str],
        }
    """
    has_image = str(data.get("has_image", "") or "").upper() == "TRUE"

    missing_required = []
    needs_na = []
    optional_empty = []

    for f in FIELD_SCHEMA:
        key = f["key"]
        val = data.get(key)

        if f["tier"] == "required":
            if _is_empty(val):
                missing_required.append(key)
        elif f["tier"] == "required_or_na":
            if f.get("conditional") == "has_image" and not has_image:
                continue
            if _is_empty(val):
                needs_na.append(key)
        elif f["tier"] == "optional":
            if _is_empty(val):
                optional_empty.append(key)

    total = len(FIELD_SCHEMA)
    # Exclude conditional fields that don't apply from total
    if not has_image:
        conditional_skipped = sum(
            1 for f in FIELD_SCHEMA
            if f.get("conditional") == "has_image"
        )
        total -= conditional_skipped

    filled = total - len(missing_required) - len(needs_na) - len(optional_empty)
    # Use JS-compatible rounding (away from zero for .5) to keep backend/frontend aligned
    score = int(filled / total * 100 + 0.5) if total > 0 else 0

    return {
        "score": score,
        "missing_required": missing_required,
        "needs_na_confirmation": needs_na,
        "optional_empty": optional_empty,
    }
