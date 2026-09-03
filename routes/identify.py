"""Camera/photo pill identification: match extracted imprint tokens + color + shape
against the pillfinder table and return ranked candidates.

This endpoint is the shared "brain" for the web camera feature and the future
mobile app — both clients extract (or receive) imprint text plus physical
attributes and post them here. Matching is deliberately order-insensitive and
tolerant of a missing side: pills often carry imprints on both sides and users
may photograph only one.
"""

import logging
import re
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

import database
from utils import normalize_imprint, process_image_filenames

logger = logging.getLogger(__name__)

router = APIRouter()

# Same normalization used by /search so both features match identically:
# collapse ;,-and-whitespace separators to single spaces, uppercase.
_NORMALIZED_IMPRINT_SQL = "UPPER(REGEXP_REPLACE(COALESCE(splimprint, ''), '[;,\\s]+', ' ', 'g'))"

# Cap the candidate pool fetched from the DB before Python-side scoring.
_CANDIDATE_POOL_LIMIT = 500

# Scoring weights: imprint text is by far the strongest signal; color is the
# weakest (lighting and coatings shift perceived color).
_WEIGHT_IMPRINT = 0.60
_WEIGHT_SHAPE = 0.25
_WEIGHT_COLOR = 0.15


class IdentifyRequest(BaseModel):
    imprint_tokens: List[str] = Field(
        default_factory=list,
        description="Text fragments read from the pill (both sides pooled together)",
        max_length=20,
    )
    color: Optional[str] = Field(default=None, max_length=50)
    shape: Optional[str] = Field(default=None, max_length=50)
    limit: int = Field(default=10, ge=1, le=25)


class IdentifyCandidate(BaseModel):
    slug: str
    medicine_name: str
    splimprint: str
    color: str
    shape: str
    strength: str
    score: float
    matched_tokens: List[str]
    match_quality: str  # "exact" | "strong" | "partial"
    image_urls: List[str]


class IdentifyResponse(BaseModel):
    candidates: List[IdentifyCandidate]
    query_tokens: List[str]
    disclaimer: str


_DISCLAIMER = (
    "Results are informational only and not a medical identification. "
    "Always confirm with a pharmacist before taking any medication. "
    "If you suspect poisoning or overdose, call Poison Control at 1-800-222-1222."
)


def _clean_tokens(raw_tokens: List[str]) -> List[str]:
    """Uppercase, strip non-alphanumerics, drop empties and duplicates (order kept)."""
    seen = set()
    cleaned = []
    for token in raw_tokens:
        for part in re.split(r"[;,\s]+", str(token).strip().upper()):
            part = re.sub(r"[^A-Z0-9./-]", "", part)
            if part and part not in seen:
                seen.add(part)
                cleaned.append(part)
    return cleaned


def _attr_matches(query_value: Optional[str], row_value: Optional[str]) -> Optional[bool]:
    """Compare a color/shape input against a DB value.

    Returns None when the user did not supply the attribute (excluded from
    scoring), True/False otherwise. DB values may hold multiples ("WHITE;YELLOW").
    """
    if not query_value or not str(query_value).strip():
        return None
    q = str(query_value).strip().upper()
    row_tokens = {t for t in re.split(r"[;,\s]+", str(row_value or "").upper()) if t}
    return q in row_tokens


def _score_row(query_tokens, row_imprint_tokens, color_match, shape_match):
    """Weighted score in [0, 1] plus the matched token list."""
    matched = [t for t in query_tokens if t in row_imprint_tokens]
    if query_tokens:
        # Symmetric overlap: penalize both missing query tokens and rows whose
        # imprint has many tokens the user never saw (reduces false positives
        # from short partial reads like a lone "10").
        recall = len(matched) / len(query_tokens)
        precision = len(matched) / len(row_imprint_tokens) if row_imprint_tokens else 0.0
        imprint_score = (2 * recall * precision / (recall + precision)) if (recall + precision) else 0.0
    else:
        imprint_score = 0.0

    score = _WEIGHT_IMPRINT * imprint_score
    weight_used = _WEIGHT_IMPRINT if query_tokens else 0.0

    if shape_match is not None:
        score += _WEIGHT_SHAPE * (1.0 if shape_match else 0.0)
        weight_used += _WEIGHT_SHAPE
    if color_match is not None:
        score += _WEIGHT_COLOR * (1.0 if color_match else 0.0)
        weight_used += _WEIGHT_COLOR

    # Normalize by the weights actually in play so a tokens-only query can
    # still reach 1.0.
    final = score / weight_used if weight_used else 0.0
    return round(final, 4), matched


def _match_quality(score: float, matched: List[str], query_tokens: List[str]) -> str:
    if query_tokens and len(matched) == len(query_tokens) and score >= 0.9:
        return "exact"
    if score >= 0.6:
        return "strong"
    return "partial"


@router.post("/api/identify", response_model=IdentifyResponse)
def identify_pill(payload: IdentifyRequest):
    query_tokens = _clean_tokens(payload.imprint_tokens)
    has_color = bool(payload.color and payload.color.strip())
    has_shape = bool(payload.shape and payload.shape.strip())

    if not query_tokens and not (has_color or has_shape):
        raise HTTPException(
            status_code=422,
            detail="Provide at least one imprint token, or a color or shape.",
        )

    if not database.db_engine:
        if not database.connect_to_database():
            raise HTTPException(status_code=500, detail="Database connection not available")

    conditions = ["deleted_at IS NULL", "published = true"]
    params: dict = {}

    if query_tokens:
        # Candidate pool: any query token appears as a whole word in the
        # normalized imprint. Scoring then ranks within the pool.
        token_clauses = []
        for i, tok in enumerate(query_tokens):
            key = f"tok_{i}"
            token_clauses.append(
                f"{_NORMALIZED_IMPRINT_SQL} ~ ('(^| )' || :{key} || '( |$)')"
            )
            params[key] = re.escape(tok)
        conditions.append("(" + " OR ".join(token_clauses) + ")")
    else:
        # Attribute-only search: constrain in SQL since there is no token pool.
        if has_color:
            conditions.append("UPPER(COALESCE(splcolor_text, '')) LIKE :color_like")
            params["color_like"] = f"%{payload.color.strip().upper()}%"
        if has_shape:
            conditions.append("UPPER(COALESCE(splshape_text, '')) LIKE :shape_like")
            params["shape_like"] = f"%{payload.shape.strip().upper()}%"

    # Rank the pool by how many query tokens each row matches so common tokens
    # (e.g. "10") cannot push exact matches past the LIMIT.
    order_by = ""
    if query_tokens:
        hits = " + ".join(
            f"(CASE WHEN {_NORMALIZED_IMPRINT_SQL} ~ ('(^| )' || :tok_{i} || '( |$)') THEN 1 ELSE 0 END)"
            for i in range(len(query_tokens))
        )
        order_by = f" ORDER BY ({hits}) DESC"
    sql = (
        "SELECT slug, medicine_name, splimprint, splcolor_text, splshape_text, "
        "spl_strength, image_filename "
        "FROM pillfinder WHERE " + " AND ".join(conditions) + order_by + f" LIMIT {_CANDIDATE_POOL_LIMIT}"
    )

    try:
        with database.db_engine.connect() as conn:
            rows = conn.execute(text(sql), params).fetchall()
    except SQLAlchemyError as e:
        logger.error(f"Database error in /api/identify: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database error")

    best_by_key: dict[tuple, IdentifyCandidate] = {}
    for row in rows:
        slug, medicine_name, splimprint, color_text, shape_text, strength, image_filename = row
        if not slug:
            continue

        row_imprint_tokens = set(normalize_imprint(splimprint or "").split())
        color_match = _attr_matches(payload.color, color_text)
        shape_match = _attr_matches(payload.shape, shape_text)
        score, matched = _score_row(query_tokens, row_imprint_tokens, color_match, shape_match)

        if score <= 0:
            continue

        # Deduplicate visually identical entries (same name + same imprint set),
        # keeping the highest-scoring one.
        key = ((medicine_name or "").strip().lower(), " ".join(sorted(row_imprint_tokens)))
        if key in best_by_key and best_by_key[key].score >= score:
            continue

        best_by_key[key] = (
            IdentifyCandidate(
                slug=slug,
                medicine_name=medicine_name or "",
                splimprint=splimprint or "",
                color=color_text or "",
                shape=shape_text or "",
                strength=strength or "",
                score=score,
                matched_tokens=matched,
                match_quality=_match_quality(score, matched, query_tokens),
                image_urls=process_image_filenames(image_filename or "")["image_urls"],
            )
        )

    scored = list(best_by_key.values())
    scored.sort(key=lambda c: (-c.score, c.medicine_name, c.slug))

    return IdentifyResponse(
        candidates=scored[: payload.limit],
        query_tokens=query_tokens,
        disclaimer=_DISCLAIMER,
    )
