"""Admin: add an IV drug by hand, edit its details and SEO text, and manage its FDA label.

Same idea as Admin -> Medication Guide for pills (set the Set ID, refetch the label, clear the cache), but it
lives on the IV drug's own page and writes only to iv_drugs, so a pill screen can never change an IV drug and
an IV screen can never change a pill:

    Set ID of a pill      -> pillfinder.spl_set_id   (routes/admin/guide.py, untouched)
    Set ID of an IV drug  -> iv_drugs.spl_set_id     (here)
    label text of either  -> medication_guide, keyed by that Set ID

Some drugs come both ways (vancomycin capsules and vancomycin injection) with a separate FDA label each. Before a
Set ID is attached here the label is downloaded and must list an INJECTION product (intravenous, intramuscular,
subcutaneous, ...) and no tablets or capsules, so a capsule label
cannot land here by mistake.

POST /api/admin/iv/drugs                          {name, spl_set_id, brand_names?}  add a drug (hidden, label locked)
PUT  /api/admin/iv/drugs/{id}/details             name, brands, class, slug (only while hidden), meta title/description
PUT  /api/admin/iv/drugs/{id}/label               {spl_set_id}  use another label, lock it, clear the old card
GET  /api/admin/iv/drugs/{id}/label               what is cached for this label
POST /api/admin/iv/drugs/{id}/label/refetch       download the label again
POST /api/admin/iv/drugs/{id}/label/clear-cache   forget the cached label (refused when pills use the same label)
"""

import logging
import re
import uuid
import xml.etree.ElementTree as ET
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from routes.admin.auth import log_audit, require_role
from routes.admin.iv_drugs import EDITORS, REVIEWERS, _actor, _engine, _get, _row
from routes.admin.pills import _sanitize
from services import iv_card
from services.iv_drugs_import import USER_AGENT, _resolve_ingredient, ingredient_identity, slugify
from services.medication_guide import GuideInternalError, GuideNotFoundError, GuideValidationError, build_guide
from services.openfda_client import OpenFDAUpstreamError

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin/iv", tags=["admin-iv"])

SETID_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
_CLEAR_CARD_SQL = (
    "card = NULL, card_status = 'none', card_label_version = NULL, card_generated_at = NULL, "
    "card_reviewed_by = NULL, card_reviewed_at = NULL, card_review_notes = NULL"
)


class NewDrugPayload(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    spl_set_id: str = Field(..., pattern=SETID_PATTERN)
    brand_names: List[str] = Field(default_factory=list, max_length=30)


class DetailsPayload(BaseModel):
    generic_name: Optional[str] = Field(None, min_length=2, max_length=120)
    brand_names: Optional[List[str]] = Field(None, max_length=30)
    drug_class: Optional[List[str]] = Field(None, max_length=10)
    slug: Optional[str] = Field(None, min_length=2, max_length=200)
    meta_title: Optional[str] = Field(None, max_length=120)
    meta_description: Optional[str] = Field(None, max_length=320)


class LabelPayload(BaseModel):
    spl_set_id: str = Field(..., pattern=SETID_PATTERN)


def _names(values: Optional[List[str]], limit: int = 80) -> List[str]:
    cleaned = [(_sanitize(v) or "").strip()[:limit] for v in values or []]
    return list(dict.fromkeys(v for v in cleaned if v))


def _injection_label(spl_set_id: str) -> dict:
    """Facts about the label, or an error the admin can read when it is not an injection label."""
    try:
        facts = iv_card.label_facts(iv_card.fetch_label_xml(spl_set_id))
    except iv_card.CardError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ET.ParseError as exc:
        raise HTTPException(status_code=502, detail="DailyMed returned a label that could not be read.") from exc
    routes = ", ".join(r.title() for r in facts["routes"]) or "none listed"
    if not facts["is_injection"]:
        raise HTTPException(
            status_code=422,
            detail=f"This label is not for an injection product (routes: {routes}). Use the injection label, "
            "not the label of the tablets or capsules.",
        )
    if facts["has_pill_form"]:
        raise HTTPException(
            status_code=422,
            detail=f"This label includes tablets or capsules (routes: {routes}). Pills belong in the pill section; "
            "attach a label that covers the injection only.",
        )
    return facts


def _label_columns(facts: dict) -> dict:
    return {
        "label_brand": facts["title"][:200] or None,
        "label_maker": facts["maker"][:200] or None,
        "label_version": facts["version"],
        "label_date": facts["date"],
    }


def _pills_using(conn, spl_set_id: str) -> int:
    return conn.execute(
        text("SELECT COUNT(*) FROM pillfinder WHERE deleted_at IS NULL AND spl_set_id = :s"), {"s": spl_set_id}
    ).scalar() or 0


@router.post("/drugs", status_code=201)
def add_iv_drug(payload: NewDrugPayload, admin: dict = Depends(require_role(*EDITORS))):
    """Add a drug the FDA list missed. It starts hidden, with its label locked so the importer keeps it."""
    name = (_sanitize(payload.name) or "").strip()
    if len(name) < 2:
        raise HTTPException(status_code=422, detail="Give the drug a name.")
    setid = payload.spl_set_id.lower()
    facts = _injection_label(setid)

    # the same identity the importer uses, so a later import refreshes this row instead of adding a twin
    with httpx.Client(timeout=30, headers={"User-Agent": USER_AGENT}, follow_redirects=True) as client:
        ingredients = {rxcui: ingredient for rxcui, ingredient in _resolve_ingredient(client, name)}
    if ingredients:
        key, active = ingredient_identity(ingredients)
        rxcuis = [k for k in key.split("+") if k in active]
    else:
        key, rxcuis = f"manual:{slugify(name)}", []

    with _engine().begin() as conn:
        twin = conn.execute(
            text("SELECT generic_name, deleted_at IS NOT NULL FROM public.iv_drugs WHERE ingredient_key = :k OR spl_set_id = :s LIMIT 1"),
            {"k": key, "s": setid},
        ).fetchone()
        if twin:
            state = "was removed from the list earlier" if twin[1] else "is already in the list"
            raise HTTPException(status_code=409, detail=f"{twin[0]} {state} (same ingredient or same label).")
        base = slug = slugify(name)
        taken = {r[0] for r in conn.execute(text("SELECT slug FROM public.iv_drugs WHERE slug LIKE :p"), {"p": f"{base}%"}).fetchall()}
        n = 2
        while slug in taken:
            slug, n = f"{base}-{n}", n + 1
        row = conn.execute(
            text(
                """
                INSERT INTO public.iv_drugs (
                    slug, ingredient_key, rxcuis, generic_name, brand_names, routes, spl_set_id, setid_locked,
                    label_brand, label_maker, label_version, label_date
                ) VALUES (
                    :slug, :key, :rxcuis, :name, :brands, :routes, :setid, true,
                    :label_brand, :label_maker, :label_version, CAST(:label_date AS date)
                )
                RETURNING id
                """
            ),
            {
                "slug": slug, "key": key, "rxcuis": rxcuis, "name": name, "brands": _names(payload.brand_names),
                "routes": [r.title() for r in facts["routes"]], "setid": setid, **_label_columns(facts),
            },  # fmt: skip
        ).fetchone()
        log_audit(conn, *_actor(admin), "iv_drug_added", "iv_drug", str(row[0]), metadata={"name": name, "spl_set_id": setid})
        return _row(_get(conn, row[0]))


@router.put("/drugs/{drug_id}/details")
def edit_details(drug_id: uuid.UUID, payload: DetailsPayload, admin: dict = Depends(require_role(*EDITORS))):
    sent = payload.model_dump(exclude_unset=True)
    changes: dict = {}
    if "generic_name" in sent:
        changes["generic_name"] = (_sanitize(sent["generic_name"]) or "").strip()
        if len(changes["generic_name"]) < 2:
            raise HTTPException(status_code=422, detail="The name cannot be empty.")
    if "brand_names" in sent:
        changes["brand_names"] = _names(sent["brand_names"])
    if "drug_class" in sent:
        changes["drug_class"] = _names(sent["drug_class"], limit=120)
    for column in ("meta_title", "meta_description"):
        if column in sent:
            changes[column] = (_sanitize(sent[column]) or "").strip() or None  # empty = back to the automatic text
    if not changes and "slug" not in sent:
        raise HTTPException(status_code=422, detail="Nothing to change.")

    with _engine().begin() as conn:
        m = _get(conn, drug_id, lock=True)._mapping
        if "slug" in sent and sent["slug"] != m["slug"]:
            if m["published"]:
                raise HTTPException(status_code=409, detail="The address of a published page cannot change. Hide the drug first.")
            if not SLUG_RE.match(sent["slug"]):
                raise HTTPException(status_code=422, detail="Use lowercase letters, numbers and single dashes, e.g. vancomycin.")
            changes["slug"] = sent["slug"]
        if not changes:
            return _row(_get(conn, drug_id))
        try:
            conn.execute(
                text(f"UPDATE public.iv_drugs SET {', '.join(f'{c} = :{c}' for c in changes)} WHERE id = :id"),
                {**changes, "id": str(drug_id)},
            )
        except IntegrityError as exc:
            raise HTTPException(status_code=409, detail="Another IV drug already uses this address.") from exc
        log_audit(conn, *_actor(admin), "iv_drug_edited", "iv_drug", str(drug_id),
                  diff={c: {"old": m[c], "new": v} for c, v in changes.items() if m[c] != v})  # fmt: skip
        return _row(_get(conn, drug_id))


@router.put("/drugs/{drug_id}/label")
def switch_label(drug_id: uuid.UUID, payload: LabelPayload, admin: dict = Depends(require_role(*EDITORS))):
    """Use another FDA label for this drug and lock the choice so the importer keeps it. A card belongs to the
    label it was made from, so the old card is cleared."""
    new_setid = payload.spl_set_id.lower()
    with _engine().connect() as conn:
        if new_setid == _get(conn, drug_id)._mapping["spl_set_id"]:
            raise HTTPException(status_code=409, detail="This label is already in use.")
    facts = _injection_label(new_setid)  # slow (DailyMed): no transaction held open

    with _engine().begin() as conn:
        m = _get(conn, drug_id, lock=True)._mapping
        others = [m["spl_set_id"]] + [s for s in (m["other_setids"] or []) if s not in (new_setid, m["spl_set_id"])]
        try:
            conn.execute(
                text(
                    f"""
                    UPDATE public.iv_drugs
                    SET spl_set_id = :new, other_setids = :others, setid_locked = true,
                        label_type = NULL, label_presentation = NULL, application_number = NULL,
                        label_brand = :label_brand, label_maker = :label_maker, label_version = :label_version,
                        label_date = CAST(:label_date AS date), {_CLEAR_CARD_SQL}
                    WHERE id = :id
                    """
                ),
                {"new": new_setid, "others": others[:5], "id": str(drug_id), **_label_columns(facts)},
            )
        except IntegrityError as exc:
            raise HTTPException(status_code=409, detail="Another IV drug already uses this label.") from exc
        log_audit(conn, *_actor(admin), "iv_label_switched", "iv_drug", str(drug_id),
                  diff={"spl_set_id": {"old": m["spl_set_id"], "new": new_setid}, "card_cleared": bool(m["card"])})  # fmt: skip
        return _row(_get(conn, drug_id))


def _label_status(conn, spl_set_id: str) -> dict:
    row = conn.execute(
        text(
            """
            SELECT fetched_at, source_url,
                   COALESCE(length(professional_html), 0), COALESCE(length(medguide_html), 0),
                   COALESCE(length(COALESCE(NULLIF(dosage_administration, ''), dosage)), 0),
                   COALESCE(length(COALESCE(NULLIF(adverse_reactions, ''), side_effects)), 0),
                   COALESCE(has_boxed_warning, false)
            FROM public.medication_guide
            WHERE spl_set_id = :s
            ORDER BY updated_at DESC NULLS LAST
            LIMIT 1
            """
        ),
        {"s": spl_set_id},
    ).fetchone()
    pills = _pills_using(conn, spl_set_id)
    status = {"spl_set_id": spl_set_id, "cached": row is not None, "pills_using_this_label": int(pills)}
    if row:
        status.update(
            fetched_at=row[0].isoformat() if row[0] else None, source_url=row[1], professional_chars=row[2],
            medguide_chars=row[3], dosage_chars=row[4], side_effects_chars=row[5], has_boxed_warning=bool(row[6]),
        )  # fmt: skip
    return status


@router.get("/drugs/{drug_id}/label")
def label_status(drug_id: uuid.UUID, admin: dict = Depends(require_role(*REVIEWERS))):
    with _engine().connect() as conn:
        return _label_status(conn, _get(conn, drug_id)._mapping["spl_set_id"])


@router.post("/drugs/{drug_id}/label/refetch")
async def refetch_label(drug_id: uuid.UUID, admin: dict = Depends(require_role(*EDITORS))):
    """Download the label again from DailyMed into the shared cache (the same call the pill tool makes)."""
    with _engine().connect() as conn:
        setid = _get(conn, drug_id)._mapping["spl_set_id"]
    try:
        await build_guide(spl_set_id=setid, force_refresh=True, include_professional=True, include_medguide=True, include_boxed_warning=True)
    except (GuideNotFoundError, GuideValidationError) as exc:
        raise HTTPException(status_code=404, detail="DailyMed has no content for this label.") from exc
    except OpenFDAUpstreamError as exc:
        raise HTTPException(status_code=502, detail="Failed to fetch the label from DailyMed.") from exc
    except GuideInternalError as exc:
        logger.error("IV label refetch failed for %s: %s", drug_id, exc)
        raise HTTPException(status_code=500, detail="Internal server error") from exc
    with _engine().begin() as conn:
        log_audit(conn, *_actor(admin), "iv_label_refetched", "iv_drug", str(drug_id), metadata={"spl_set_id": setid})
        return _label_status(conn, setid)


@router.post("/drugs/{drug_id}/label/clear-cache")
def clear_label_cache(drug_id: uuid.UUID, admin: dict = Depends(require_role(*EDITORS))):
    """Forget the cached label; the pages fetch it again when next opened. A label that pills use too is left
    alone: that row belongs to the pill tools (Admin -> Medication Guide)."""
    with _engine().begin() as conn:
        setid = _get(conn, drug_id)._mapping["spl_set_id"]
        pills = _pills_using(conn, setid)
        if pills:
            raise HTTPException(
                status_code=409,
                detail=f"{pills} pill(s) use this same FDA label. Clear it from Admin -> Medication Guide on one of those pills instead.",
            )
        deleted = conn.execute(
            text(
                "DELETE FROM public.medication_guide WHERE spl_set_id = :s "
                "AND NULLIF(rxcui, '') IS NULL AND NULLIF(ndc, '') IS NULL"  # never a row that carries pill identifiers
            ),
            {"s": setid},
        ).rowcount
        log_audit(conn, *_actor(admin), "iv_label_cache_cleared", "iv_drug", str(drug_id), metadata={"spl_set_id": setid, "rows": deleted})
        return _label_status(conn, setid)
