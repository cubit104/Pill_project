"""Drug-level search for the mobile app.

Three read-only endpoints backed by the ``drug_summary`` materialized view
(supabase/migrations/20260906000000_drug_summary.sql):

* ``GET /api/drugs/lookup``  – paginated drugs matching a name (one row per drug
  with its strengths and pill count), instead of one row per pill.
* ``GET /api/drugs/suggest`` – live suggestions while typing: drug names, or
  NDC codes (digits, dashes optional) with the drug name beside each.
* ``GET /api/drugs/pills``   – the pills of one drug, optionally one strength.

The website keeps using ``/api/search``; nothing here changes existing routes.

Freshness: a trigger on ``pillfinder`` marks ``drug_summary_state.stale``; the
first request after that refreshes the view (CONCURRENTLY, about a second).
"""

from __future__ import annotations

import logging
import re
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError

import database
from utils import process_image_filenames

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/drugs", tags=["drug-search"])

CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=600"
MAX_SUGGESTIONS = 20


# ---- Response models --------------------------------------------------------


class StrengthDetail(BaseModel):
    label: str
    pill_count: int = 0
    image_url: Optional[str] = None
    slug: Optional[str] = None


class DrugRow(BaseModel):
    name: str
    key: str
    brand_names: Optional[str] = None
    ingredients: Optional[str] = None
    strengths: List[str] = []
    strength_details: List[StrengthDetail] = []
    pill_count: int = 0
    image_url: Optional[str] = None
    slug: Optional[str] = None
    rxcui: Optional[str] = None


class DrugLookupResponse(BaseModel):
    results: List[DrugRow]
    total: int
    page: int
    per_page: int
    total_pages: int


class NdcSuggestion(BaseModel):
    ndc: str
    ndc9: Optional[str] = None
    drug_name: str
    strength: Optional[str] = None
    imprint: Optional[str] = None
    slug: Optional[str] = None
    image_url: Optional[str] = None


class SuggestResponse(BaseModel):
    mode: str
    drugs: List[DrugRow] = []
    ndcs: List[NdcSuggestion] = []


class PillRow(BaseModel):
    drug_name: str
    imprint: str = ""
    color: Optional[str] = None
    shape: Optional[str] = None
    ndc: Optional[str] = None
    rxcui: Optional[str] = None
    slug: Optional[str] = None
    strength: Optional[str] = None
    manufacturer: Optional[str] = None
    image_url: Optional[str] = None
    images: List[str] = []
    has_multiple_images: bool = False


class DrugPillsResponse(BaseModel):
    drug: Optional[DrugRow]
    strength: Optional[str]
    results: List[PillRow]
    total: int
    page: int
    per_page: int
    total_pages: int


# ---- Helpers ----------------------------------------------------------------


def _engine():
    if not database.db_engine and not database.connect_to_database():
        raise HTTPException(status_code=503, detail="Database unavailable")
    return database.db_engine


def _image_url(filename: Optional[str]) -> Optional[str]:
    if not filename:
        return None
    urls = process_image_filenames(filename).get("image_urls") or []
    return urls[0] if urls else None


def _drug_row(r) -> DrugRow:
    m = r._mapping
    return DrugRow(
        name=m["name"],
        key=m["key"],
        brand_names=m.get("brand_names"),
        ingredients=m.get("ingredients"),
        strengths=list(m.get("strengths") or []),
        strength_details=[
            StrengthDetail(
                label=str(d.get("label") or ""),
                pill_count=int(d.get("pill_count") or 0),
                image_url=_image_url(d.get("image_filename")),
                slug=d.get("slug"),
            )
            for d in (m.get("strength_details") or [])
            if isinstance(d, dict) and d.get("label")
        ],
        pill_count=int(m.get("pill_count") or 0),
        image_url=_image_url(m.get("image_filename")),
        slug=m.get("slug"),
        rxcui=m.get("rxcui"),
    )


def _norm_strength(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip()).lower()


def format_ndc(value: Optional[str]) -> Optional[str]:
    """Display form of an NDC: 11 bare digits → 5-4-2; anything already dashed is kept."""
    if not value:
        return None
    v = value.strip()
    digits = re.sub(r"[^0-9]", "", v)
    if "-" not in v and len(digits) == 11:
        return f"{digits[:5]}-{digits[5:9]}-{digits[9:]}"
    return v or None


def ensure_fresh(conn) -> None:
    """Refresh drug_summary once if pillfinder changed since the last refresh.

    Cheap flag check on every call; the refresh itself runs under an advisory
    lock so concurrent requests don't refresh twice. Failures are logged and the
    (slightly stale) view is served anyway.

    Note: unlike CREATE INDEX CONCURRENTLY, REFRESH MATERIALIZED VIEW CONCURRENTLY
    is allowed inside a transaction block (it is even wrapped in a plpgsql function
    here); verified against Postgres 15 via engine.begin() — ~1 s for 14K pills.
    """
    try:
        stale = conn.execute(text("SELECT stale FROM public.drug_summary_state WHERE id")).scalar()
    except ProgrammingError as exc:
        raise HTTPException(status_code=503, detail="Drug summary is not available yet (migration pending).") from exc
    if not stale:
        return
    try:
        got_lock = conn.execute(text("SELECT pg_try_advisory_xact_lock(hashtext('drug_summary_refresh'))")).scalar()
        if got_lock:
            conn.execute(text("SELECT public.refresh_drug_summary()"))
            logger.info("drug_summary refreshed after pillfinder change")
    except Exception:  # pragma: no cover - best effort
        logger.exception("drug_summary refresh failed; serving stale view")


def _lookup_where() -> str:
    # Prefix match first (indexed), then anywhere-in-name (trigram) as a fallback.
    return "(key LIKE :prefix OR key LIKE :anywhere OR brand_names ILIKE :anywhere)"


def _lookup_order() -> str:
    return (
        "ORDER BY CASE WHEN key LIKE :prefix THEN 0 WHEN key LIKE :anywhere THEN 1 ELSE 2 END, "
        "pill_count DESC, name"
    )


def _clean_query(q: Optional[str]) -> str:
    return re.sub(r"\s+", " ", (q or "").strip().lower())


# ---- Endpoints --------------------------------------------------------------


@router.get("/lookup", response_model=DrugLookupResponse)
def lookup_drugs(
    response: Response,
    q: str = Query(..., min_length=1, max_length=100, description="Drug name (brand or generic), prefix or partial"),
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
):
    """Drugs matching ``q``: one row per drug with strengths and pill count."""
    response.headers["Cache-Control"] = CACHE_CONTROL
    term = _clean_query(q)
    if len(term) < 2:
        return DrugLookupResponse(results=[], total=0, page=page, per_page=per_page, total_pages=0)
    params = {"prefix": f"{term}%", "anywhere": f"%{term}%", "limit": per_page, "offset": (page - 1) * per_page}
    engine = _engine()
    with engine.begin() as conn:
        ensure_fresh(conn)
        total = conn.execute(text(f"SELECT COUNT(*) FROM public.drug_summary WHERE {_lookup_where()}"), params).scalar() or 0
        rows = conn.execute(
            text(f"SELECT * FROM public.drug_summary WHERE {_lookup_where()} {_lookup_order()} LIMIT :limit OFFSET :offset"),
            params,
        ).fetchall()
    total_pages = (total + per_page - 1) // per_page
    return DrugLookupResponse(results=[_drug_row(r) for r in rows], total=int(total), page=page, per_page=per_page, total_pages=total_pages)


@router.get("/suggest", response_model=SuggestResponse)
def suggest(
    response: Response,
    q: str = Query(..., min_length=1, max_length=100),
    mode: str = Query("drug", pattern="^(drug|ndc)$"),
    limit: int = Query(8, ge=1, le=MAX_SUGGESTIONS),
):
    """Live suggestions while typing.

    * ``mode=drug`` – drug names (prefix first, then partial), with strengths so the
      app can open the strength picker straight from the dropdown.
    * ``mode=ndc``  – NDC codes starting with the typed digits (dashes ignored), each
      with the drug name and strength; one row per pill.
    """
    response.headers["Cache-Control"] = CACHE_CONTROL
    engine = _engine()
    if mode == "ndc":
        digits = re.sub(r"[^0-9]", "", q)
        if len(digits) < 3:
            return SuggestResponse(mode="ndc")
        try:
            with engine.connect() as conn:
                rows = conn.execute(
                    text(
                        """
                        SELECT DISTINCT ON (ndc11)
                            ndc11, ndc9, medicine_name, public.strength_label(spl_strength), splimprint, slug, image_filename
                        FROM public.pillfinder
                        WHERE deleted_at IS NULL
                          AND published = true
                          AND ndc11 IS NOT NULL
                          AND (replace(ndc11, '-', '') LIKE :like_q OR replace(ndc9, '-', '') LIKE :like_q)
                        ORDER BY ndc11, slug
                        LIMIT :lim
                        """
                    ),
                    {"like_q": f"{digits}%", "lim": limit},
                ).fetchall()
        except ProgrammingError as exc:  # strength_label() comes from the same migration as the view
            raise HTTPException(status_code=503, detail="Drug summary is not available yet (migration pending).") from exc
        return SuggestResponse(
            mode="ndc",
            ndcs=[
                NdcSuggestion(
                    ndc=format_ndc(r[0]) or r[0],
                    ndc9=r[1],
                    drug_name=r[2] or "",
                    strength=(r[3] or "").strip() or None,
                    imprint=(r[4] or "").strip() or None,
                    slug=r[5],
                    image_url=_image_url(r[6]),
                )
                for r in rows
            ],
        )

    term = _clean_query(q)
    if len(term) < 2:
        return SuggestResponse(mode="drug")
    params = {"prefix": f"{term}%", "anywhere": f"%{term}%", "limit": limit}
    with engine.begin() as conn:
        ensure_fresh(conn)
        rows = conn.execute(
            text(f"SELECT * FROM public.drug_summary WHERE {_lookup_where()} {_lookup_order()} LIMIT :limit"),
            params,
        ).fetchall()
    return SuggestResponse(mode="drug", drugs=[_drug_row(r) for r in rows])


@router.get("/pills", response_model=DrugPillsResponse)
def drug_pills(
    name: str = Query(..., min_length=1, max_length=200, description="Exact drug name (case-insensitive)"),
    strength: Optional[str] = Query(None, max_length=100, description="Optional strength label, e.g. '75 mg'"),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
):
    """Pills for one drug, optionally one strength; ordered by strength then imprint."""
    key = _clean_query(name)
    if not key:
        raise HTTPException(status_code=422, detail="name is required")
    conditions = ["deleted_at IS NULL", "published = true", "lower(btrim(medicine_name)) = :key"]
    params: dict = {"key": key, "limit": per_page, "offset": (page - 1) * per_page}
    if strength:
        # Same canonical label the summary view uses ("WARFARIN SODIUM 3 mg;" → "3 mg").
        conditions.append("lower(public.strength_label(spl_strength)) = :strength")
        params["strength"] = _norm_strength(strength)
    where = " AND ".join(conditions)
    engine = _engine()
    with engine.begin() as conn:
        ensure_fresh(conn)
        drug_row = conn.execute(text("SELECT * FROM public.drug_summary WHERE key = :key"), {"key": key}).fetchone()
        total = conn.execute(text(f"SELECT COUNT(*) FROM public.pillfinder WHERE {where}"), params).scalar() or 0
        rows = conn.execute(
            text(
                f"""
                SELECT medicine_name, splimprint, splcolor_text, splshape_text, ndc11, rxcui, slug,
                       public.strength_label(spl_strength) AS strength, author, image_filename
                FROM public.pillfinder
                WHERE {where}
                ORDER BY
                    NULLIF(substring(public.strength_label(spl_strength) FROM '\\d+(?:\\.\\d+)?'), '')::numeric NULLS LAST,
                    public.strength_label(spl_strength), splimprint, slug
                LIMIT :limit OFFSET :offset
                """
            ),
            params,
        ).fetchall()
    results = []
    for r in rows:
        image_data = process_image_filenames(r[9] or "")
        urls = image_data.get("image_urls") or []
        results.append(
            PillRow(
                drug_name=r[0] or "",
                imprint=(r[1] or "").strip(),
                color=(r[2] or "").strip() or None,
                shape=(r[3] or "").strip() or None,
                ndc=format_ndc(r[4]),
                rxcui=(r[5] or "").strip() or None,
                slug=r[6],
                strength=(r[7] or "").strip() or None,
                manufacturer=(r[8] or "").strip() or None,
                image_url=urls[0] if urls else None,
                images=urls,
                has_multiple_images=len(urls) > 1,
            )
        )
    total_pages = (int(total) + per_page - 1) // per_page
    return DrugPillsResponse(
        drug=_drug_row(drug_row) if drug_row else None,
        strength=strength,
        results=results,
        total=int(total),
        page=page,
        per_page=per_page,
        total_pages=total_pages,
    )
