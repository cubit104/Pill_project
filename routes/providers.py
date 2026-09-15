"""Find a doctor / pharmacies / urgent care: public, read-only endpoints for the
website (and later the app). Data and caching live in services/providers.py.

GET  /api/providers/specialties           the pulldown list
GET  /api/providers/cities?q=san fr        live-fill for the city box
GET  /api/providers/search?kind=doctors&specialty=cardiology&zip=75074
                                           ...or city=Plano&state=TX, or lat=&lon=, or last=&first=&state=
POST /api/providers/geocode {items:[{npi,address,city,state,zip}]}   map pins for a result page
GET  /api/providers/{npi}                  one provider: registry record, map pin, cached details
GET  /api/providers/{npi}/extras           CMS and Google details (slow the first time, then cached)
"""
from __future__ import annotations

import logging
import os
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field

from services import providers as svc
from services import ratelimit

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/providers", tags=["providers"])

SEARCH_CACHE = "public, max-age=300, stale-while-revalidate=3600"
DETAIL_CACHE = "public, max-age=3600, stale-while-revalidate=86400"
# Per-client budgets (per hour). Searches fan out to the registry; extras cost CMS time and Google quota.
SEARCH_PER_HOUR = int(os.getenv("PILL_PROVIDER_SEARCH_PER_HOUR", "120"))
GEOCODE_PER_HOUR = int(os.getenv("PILL_PROVIDER_GEOCODE_PER_HOUR", "120"))
EXTRAS_PER_HOUR = int(os.getenv("PILL_PROVIDER_EXTRAS_PER_HOUR", "60"))


@router.get("/specialties")
def specialties(response: Response):
    response.headers["Cache-Control"] = "public, max-age=86400"
    return {
        "specialties": [s.as_dict() for s in svc.SPECIALTIES],
        "kinds": {"pharmacy": svc.PHARMACY.as_dict(), "urgent": svc.URGENT_CARE.as_dict()},
    }


@router.get("/cities")
def cities(response: Response, q: str = Query("", max_length=60), limit: int = Query(8, ge=1, le=20)):
    response.headers["Cache-Control"] = "public, max-age=86400"
    return {"cities": svc.suggest_cities(svc.zip_table(), q, limit)}


@router.get("/search")
def search(
    request: Request,
    response: Response,
    kind: str = Query("doctors", pattern="^(doctors|pharmacy|urgent)$"),
    specialty: str = Query("family", max_length=30),
    zip: str = Query("", max_length=10),
    city: str = Query("", max_length=60),
    state: str = Query("", max_length=2),
    lat: Optional[float] = Query(None, ge=-90, le=90),
    lon: Optional[float] = Query(None, ge=-180, le=180),
    last: str = Query("", max_length=40),
    first: str = Query("", max_length=40),
):
    ratelimit.check(request, "providers.search", SEARCH_PER_HOUR, "Too many searches; please try again in a while.")
    try:
        out = svc.search(kind, specialty, zip_code=zip, city=city, state=state, lat=lat, lon=lon, last=last, first=first)
    except svc.ProviderError as e:
        raise HTTPException(status_code=e.status, detail=e.detail)
    except Exception as e:
        logger.error("provider search failed: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail="Could not reach the provider registry. Try again in a minute.")
    # A "near me" answer carries the visitor's coordinates: never let a shared cache keep it.
    response.headers["Cache-Control"] = "private, no-store" if (lat is not None or lon is not None) else SEARCH_CACHE
    return {"origin": out["origin"], "results": out["results"], "count": len(out["results"])}


class GeocodeItem(BaseModel):
    npi: str = Field(pattern=r"^\d{10}$")
    address: str = Field("", max_length=200)
    city: str = Field("", max_length=80)
    state: str = Field("", max_length=2)
    zip: str = Field("", max_length=10)


class GeocodeBody(BaseModel):
    items: List[GeocodeItem] = Field(max_length=svc.GEOCODE_BATCH_MAX)


@router.post("/geocode")
def geocode(body: GeocodeBody, request: Request):
    ratelimit.check(request, "providers.geocode", GEOCODE_PER_HOUR)
    try:
        positions = svc.geocode_batch([i.model_dump() for i in body.items])
    except Exception as e:
        logger.error("geocode failed: %s", e, exc_info=True)
        positions = {}
    return {"positions": positions}


@router.get("/{npi}")
def detail(npi: str, response: Response):
    if not npi.isdigit() or len(npi) != 10:
        raise HTTPException(status_code=404, detail="Not found")
    try:
        out = svc.details(npi)
    except svc.ProviderError as e:
        raise HTTPException(status_code=e.status, detail=e.detail)
    except Exception as e:
        logger.error("provider detail failed: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail="Could not load this provider right now.")
    if not out:
        raise HTTPException(status_code=404, detail="No provider with that NPI")
    response.headers["Cache-Control"] = DETAIL_CACHE
    return out


@router.get("/{npi}/extras")
def detail_extras(npi: str, request: Request, response: Response):
    if not npi.isdigit() or len(npi) != 10:
        raise HTTPException(status_code=404, detail="Not found")
    ratelimit.check(request, "providers.extras", EXTRAS_PER_HOUR, "Too many lookups; please try again in a while.")
    try:
        out = svc.extras(npi)
    except svc.ProviderError as e:
        raise HTTPException(status_code=e.status, detail=e.detail)
    except Exception as e:
        logger.error("provider extras failed: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail="Could not load the extra details right now.")
    if out is None:
        raise HTTPException(status_code=404, detail="No provider with that NPI")
    response.headers["Cache-Control"] = DETAIL_CACHE
    return out
