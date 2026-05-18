from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Optional

import httpx
from sqlalchemy import text

import database
from ndc_normalize import normalize_ndc_to_11

logger = logging.getLogger(__name__)

NADAC_SOURCE = "NADAC (CMS)"
DEFAULT_DISCLAIMERS = [
    "NADAC reflects pharmacy acquisition cost, not your out-of-pocket cost.",
    "Actual prices vary by pharmacy, insurance, and location.",
    "This is not medical advice. Always consult your pharmacist.",
]
FAIR_RETAIL_LOW_MULTIPLIER = 1.5
FAIR_RETAIL_HIGH_MULTIPLIER = 3.0
NADAC_CONNECT_TIMEOUT = 10.0
NADAC_RW_TIMEOUT = 30.0
MAX_RELATED_RXCUIS = 40
MAX_ALTERNATIVE_NDCS = 150


class PricingNotFoundError(LookupError):
    """Raised when NADAC has no pricing for the requested NDC."""


class PricingServiceError(RuntimeError):
    """Raised when pricing service dependencies fail."""


class NADACPricingService:
    """NADAC pricing client with Supabase-backed read-through cache.

    NADAC files are published weekly on CMS/data.medicaid.gov:
    https://data.medicaid.gov/dataset?theme=Pharmacy
    """

    def __init__(self) -> None:
        self.nadac_api_base_url = os.getenv("NADAC_API_BASE_URL", "https://data.medicaid.gov/api/1")
        self.nadac_catalog_url = os.getenv(
            "NADAC_CATALOG_URL",
            "https://data.medicaid.gov/api/1/metastore/schemas/dataset/items",
        )
        self.rxnav_base_url = os.getenv("RXNAV_API_BASE_URL", "https://rxnav.nlm.nih.gov")
        self.timeout = httpx.Timeout(
            connect=NADAC_CONNECT_TIMEOUT,
            read=NADAC_RW_TIMEOUT,
            write=NADAC_RW_TIMEOUT,
            pool=NADAC_RW_TIMEOUT,
        )
        self.cache_ttl = timedelta(days=7)
        self._metadata_cache: dict[str, Any] | None = None
        self._metadata_cached_at: datetime | None = None

    @staticmethod
    def _parse_date(value: Any) -> date | None:
        if value in (None, ""):
            return None
        if isinstance(value, date):
            return value
        s = str(value).strip()
        if not s:
            return None
        s = s.replace("Z", "+00:00")
        for parser in (
            lambda v: datetime.fromisoformat(v).date(),
            lambda v: datetime.strptime(v[:10], "%Y-%m-%d").date(),
            lambda v: datetime.strptime(v[:10], "%m/%d/%Y").date(),
        ):
            try:
                return parser(s)
            except Exception:
                continue
        return None

    @staticmethod
    def _normalize_ndc_digits(ndc: str) -> Optional[str]:
        normalized = normalize_ndc_to_11(ndc)
        if not normalized:
            return None
        return re.sub(r"\D", "", normalized)

    @staticmethod
    def _decimal(value: Any) -> Decimal | None:
        if value in (None, ""):
            return None
        try:
            return Decimal(str(value))
        except (InvalidOperation, TypeError, ValueError):
            return None

    async def _request_json(self, url: str, *, params: dict[str, Any] | None = None) -> dict[str, Any]:
        last_exc: Exception | None = None
        for attempt in range(3):
            try:
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    response = await client.get(url, params=params)
                response.raise_for_status()
                return response.json()
            except httpx.HTTPStatusError as exc:
                last_exc = exc
                status = exc.response.status_code if exc.response else None
                if status is None or status < 500 or attempt == 2:
                    break
                await asyncio.sleep(2**attempt)
            except httpx.RequestError as exc:
                last_exc = exc
                if attempt == 2:
                    break
                await asyncio.sleep(2**attempt)
        raise PricingServiceError(f"Request failed: {url}") from last_exc

    def _extract_dataset_id(self, item: dict[str, Any]) -> str | None:
        for key in ("identifier", "dataset_id", "id", "resource_id"):
            value = item.get(key)
            if isinstance(value, str) and value:
                return value

        for key in ("references", "distribution", "resources"):
            values = item.get(key)
            if not isinstance(values, list):
                continue
            for obj in values:
                if not isinstance(obj, dict):
                    continue
                for subkey in ("identifier", "resource_id", "id"):
                    value = obj.get(subkey)
                    if isinstance(value, str) and value:
                        return value
        return None

    async def _get_latest_dataset_metadata(self) -> dict[str, Any]:
        now = datetime.now(timezone.utc)
        if (
            self._metadata_cache
            and self._metadata_cached_at
            and (now - self._metadata_cached_at) < timedelta(hours=1)
        ):
            return self._metadata_cache

        payload = await self._request_json(self.nadac_catalog_url, params={"limit": 2000})
        items = payload.get("results") or payload.get("items") or payload.get("result") or payload
        if not isinstance(items, list):
            raise PricingServiceError("Unexpected NADAC catalog response shape")

        candidates: list[tuple[datetime, dict[str, Any], str]] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or item.get("name") or "")
            title_l = title.lower()
            if "nadac" not in title_l or "national average drug acquisition cost" not in title_l:
                continue
            dataset_id = self._extract_dataset_id(item)
            if not dataset_id:
                continue
            updated = item.get("modified") or item.get("updated") or item.get("updated_at") or item.get("release_date")
            updated_dt = datetime(1970, 1, 1, tzinfo=timezone.utc)
            if updated:
                parsed = self._parse_date(updated)
                if parsed:
                    updated_dt = datetime(parsed.year, parsed.month, parsed.day, tzinfo=timezone.utc)
            candidates.append((updated_dt, item, dataset_id))

        if not candidates:
            raise PricingServiceError("Could not resolve NADAC dataset UUID from catalog")

        candidates.sort(key=lambda row: row[0], reverse=True)
        _, item, dataset_id = candidates[0]

        as_of_week = (
            self._parse_date(item.get("as_of_week"))
            or self._parse_date(item.get("week_ending"))
            or self._parse_date(item.get("effective_date"))
            or self._parse_date(item.get("release_date"))
            or self._parse_date(item.get("modified"))
        )
        metadata = {
            "dataset_id": dataset_id,
            "as_of_week": as_of_week.isoformat() if as_of_week else None,
            "title": item.get("title") or item.get("name") or "NADAC",
        }
        self._metadata_cache = metadata
        self._metadata_cached_at = now
        return metadata

    def _nadac_query_url(self, dataset_id: str) -> str:
        return f"{self.nadac_api_base_url.rstrip('/')}/datastore/query/{dataset_id}/0"

    def _parse_nadac_row(
        self,
        row: dict[str, Any],
        *,
        ndc_digits: str,
        as_of_week: str | None,
    ) -> dict[str, Any] | None:
        price = None
        for key in ("nadac_per_unit", "nadac_per_unit_amount", "nadac"):
            price = self._decimal(row.get(key))
            if price is not None:
                break
        if price is None:
            return None

        unit = row.get("pricing_unit") or row.get("unit") or row.get("nadac_unit") or "EA"
        effective_date = (
            self._parse_date(row.get("effective_date"))
            or self._parse_date(row.get("as_of_date"))
            or self._parse_date(as_of_week)
        )
        if not effective_date:
            return None

        return {
            "ndc": ndc_digits,
            "price_per_unit": float(price),
            "unit": str(unit).upper(),
            "effective_date": effective_date.isoformat(),
            "source": NADAC_SOURCE,
            "as_of_week": as_of_week,
            "raw_payload": row,
        }

    async def _fetch_nadac_latest_for_ndc(self, ndc_digits: str) -> dict[str, Any]:
        metadata = await self._get_latest_dataset_metadata()
        dataset_id = metadata["dataset_id"]
        as_of_week = metadata.get("as_of_week")
        url = self._nadac_query_url(dataset_id)

        for ndc_field in ("ndc", "ndc11", "ndc_11", "ndc_code"):
            params: dict[str, Any] = {
                "conditions[0][property]": ndc_field,
                "conditions[0][value]": ndc_digits,
                "conditions[0][operator]": "=",
                "sorts[0][property]": "effective_date",
                "sorts[0][order]": "desc",
                "limit": 1,
            }
            payload = await self._request_json(url, params=params)
            rows = payload.get("results") or payload.get("result") or []
            if not isinstance(rows, list) or not rows:
                continue
            parsed = self._parse_nadac_row(rows[0], ndc_digits=ndc_digits, as_of_week=as_of_week)
            if parsed:
                return parsed

        raise PricingNotFoundError(f"No NADAC price found for NDC {ndc_digits}")

    def _ensure_db(self) -> None:
        if not database.db_engine and not database.connect_to_database():
            raise PricingServiceError("Database connection not available")

    def _get_cached_price(self, ndc_digits: str) -> dict[str, Any] | None:
        self._ensure_db()
        with database.db_engine.connect() as conn:
            row = conn.execute(
                text(
                    """
                    SELECT ndc, price_per_unit, unit, effective_date, source, raw_payload, fetched_at
                    FROM drug_prices
                    WHERE ndc = :ndc
                    LIMIT 1
                    """
                ),
                {"ndc": ndc_digits},
            ).mappings().first()
            return dict(row) if row else None

    def _upsert_price_cache(self, price: dict[str, Any]) -> None:
        self._ensure_db()
        with database.db_engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO drug_prices (ndc, price_per_unit, unit, effective_date, source, raw_payload, fetched_at)
                    VALUES (:ndc, :price_per_unit, :unit, :effective_date, :source, CAST(:raw_payload AS JSONB), NOW())
                    ON CONFLICT (ndc) DO UPDATE
                    SET price_per_unit = EXCLUDED.price_per_unit,
                        unit = EXCLUDED.unit,
                        effective_date = EXCLUDED.effective_date,
                        source = EXCLUDED.source,
                        raw_payload = EXCLUDED.raw_payload,
                        fetched_at = NOW()
                    """
                ),
                {
                    "ndc": price["ndc"],
                    "price_per_unit": price["price_per_unit"],
                    "unit": price["unit"],
                    "effective_date": price["effective_date"],
                    "source": "NADAC",
                    "raw_payload": json.dumps(price.get("raw_payload") or {}),
                },
            )
            conn.execute(
                text(
                    """
                    INSERT INTO drug_price_history (ndc, effective_date, price_per_unit, unit)
                    VALUES (:ndc, :effective_date, :price_per_unit, :unit)
                    ON CONFLICT (ndc, effective_date) DO UPDATE
                    SET price_per_unit = EXCLUDED.price_per_unit,
                        unit = EXCLUDED.unit
                    """
                ),
                {
                    "ndc": price["ndc"],
                    "effective_date": price["effective_date"],
                    "price_per_unit": price["price_per_unit"],
                    "unit": price["unit"],
                },
            )

    def _cache_fresh(self, cached: dict[str, Any], latest_week: date | None) -> bool:
        fetched_at = cached.get("fetched_at")
        if isinstance(fetched_at, str):
            try:
                fetched_at = datetime.fromisoformat(fetched_at.replace("Z", "+00:00"))
            except Exception:
                fetched_at = None
        if not isinstance(fetched_at, datetime):
            return False
        if fetched_at.tzinfo is None:
            fetched_at = fetched_at.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) - fetched_at > self.cache_ttl:
            return False

        if latest_week:
            cached_effective = self._parse_date(cached.get("effective_date"))
            if not cached_effective or cached_effective < latest_week:
                return False

        return True

    def _add_totals(self, price: dict[str, Any], *, days_supply: int, units_per_day: float) -> dict[str, Any]:
        quantity = max(float(units_per_day), 0.0) * max(int(days_supply), 1)
        ppu = float(price["price_per_unit"])
        total = ppu * quantity
        return {
            **price,
            "total_acquisition_cost": round(total, 2),
            "fair_retail_low": round(total * FAIR_RETAIL_LOW_MULTIPLIER, 2),
            "fair_retail_high": round(total * FAIR_RETAIL_HIGH_MULTIPLIER, 2),
            "days_supply": int(days_supply),
            "units_per_day": float(units_per_day),
            "disclaimers": DEFAULT_DISCLAIMERS,
        }

    async def get_price(self, ndc: str, *, days_supply: int = 30, units_per_day: float = 1.0) -> dict[str, Any]:
        ndc_digits = self._normalize_ndc_digits(ndc)
        if not ndc_digits:
            raise ValueError("Invalid NDC format")

        latest_week = None
        try:
            metadata = await self._get_latest_dataset_metadata()
            latest_week = self._parse_date(metadata.get("as_of_week"))
        except Exception:
            logger.warning("Failed to resolve latest NADAC metadata; falling back to TTL-only cache")

        cached = self._get_cached_price(ndc_digits)
        if cached and self._cache_fresh(cached, latest_week):
            payload = {
                "ndc": cached["ndc"],
                "price_per_unit": float(cached["price_per_unit"]),
                "unit": cached["unit"],
                "effective_date": str(cached["effective_date"]),
                "source": NADAC_SOURCE,
                "as_of_week": latest_week.isoformat() if latest_week else None,
            }
            return self._add_totals(payload, days_supply=days_supply, units_per_day=units_per_day)

        latest = await self._fetch_nadac_latest_for_ndc(ndc_digits)
        self._upsert_price_cache(latest)
        return self._add_totals(latest, days_supply=days_supply, units_per_day=units_per_day)

    async def get_price_history(self, ndc: str, weeks: int = 52) -> list[dict[str, Any]]:
        ndc_digits = self._normalize_ndc_digits(ndc)
        if not ndc_digits:
            raise ValueError("Invalid NDC format")

        weeks = max(1, min(int(weeks), 260))
        self._ensure_db()

        with database.db_engine.connect() as conn:
            cached_rows = conn.execute(
                text(
                    """
                    SELECT ndc, effective_date, price_per_unit, unit
                    FROM drug_price_history
                    WHERE ndc = :ndc
                    ORDER BY effective_date DESC
                    LIMIT :weeks
                    """
                ),
                {"ndc": ndc_digits, "weeks": weeks},
            ).mappings().all()
        if cached_rows:
            ordered = list(reversed(cached_rows))
            return [
                {
                    "ndc": row["ndc"],
                    "effective_date": str(row["effective_date"]),
                    "price_per_unit": float(row["price_per_unit"]),
                    "unit": row["unit"],
                }
                for row in ordered
            ]

        metadata = await self._get_latest_dataset_metadata()
        dataset_id = metadata["dataset_id"]
        as_of_week = metadata.get("as_of_week")
        url = self._nadac_query_url(dataset_id)

        rows: list[dict[str, Any]] = []
        for ndc_field in ("ndc", "ndc11", "ndc_11", "ndc_code"):
            payload = await self._request_json(
                url,
                params={
                    "conditions[0][property]": ndc_field,
                    "conditions[0][value]": ndc_digits,
                    "conditions[0][operator]": "=",
                    "sorts[0][property]": "effective_date",
                    "sorts[0][order]": "desc",
                    "limit": weeks,
                },
            )
            records = payload.get("results") or payload.get("result") or []
            if isinstance(records, list) and records:
                rows = records
                break

        parsed_rows: list[dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            parsed = self._parse_nadac_row(row, ndc_digits=ndc_digits, as_of_week=as_of_week)
            if parsed:
                parsed_rows.append(parsed)

        if not parsed_rows:
            raise PricingNotFoundError(f"No NADAC history found for NDC {ndc_digits}")

        parsed_rows.sort(key=lambda row: row["effective_date"])

        self._ensure_db()
        with database.db_engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO drug_price_history (ndc, effective_date, price_per_unit, unit)
                    VALUES (:ndc, :effective_date, :price_per_unit, :unit)
                    ON CONFLICT (ndc, effective_date) DO UPDATE
                    SET price_per_unit = EXCLUDED.price_per_unit,
                        unit = EXCLUDED.unit
                    """
                ),
                [
                    {
                        "ndc": item["ndc"],
                        "effective_date": item["effective_date"],
                        "price_per_unit": item["price_per_unit"],
                        "unit": item["unit"],
                    }
                    for item in parsed_rows
                ],
            )

        return [
            {
                "ndc": row["ndc"],
                "effective_date": row["effective_date"],
                "price_per_unit": row["price_per_unit"],
                "unit": row["unit"],
            }
            for row in parsed_rows[-weeks:]
        ]

    async def _rxnav_json(self, path: str, *, params: dict[str, Any] | None = None) -> dict[str, Any]:
        url = f"{self.rxnav_base_url.rstrip('/')}{path}"
        return await self._request_json(url, params=params)

    async def _ndc_to_rxcui(self, ndc_digits: str) -> str | None:
        payload = await self._rxnav_json("/REST/ndcstatus.json", params={"ndc": ndc_digits})
        status = payload.get("ndcStatus") or {}
        value = status.get("rxcui")
        return str(value) if value else None

    async def _ingredient_for_rxcui(self, rxcui: str) -> dict[str, str] | None:
        payload = await self._rxnav_json(f"/REST/rxcui/{rxcui}/related.json", params={"tty": "IN+PIN"})
        groups = (payload.get("relatedGroup") or {}).get("conceptGroup") or []
        for group in groups:
            props = group.get("conceptProperties") or []
            for prop in props:
                ingredient_name = prop.get("name")
                ingredient_rxcui = prop.get("rxcui")
                if ingredient_name and ingredient_rxcui:
                    return {"name": str(ingredient_name), "rxcui": str(ingredient_rxcui)}
        return None

    async def _resolve_ingredient(self, token: str) -> dict[str, str] | None:
        token = token.strip()
        if not token:
            return None

        normalized_ndc = self._normalize_ndc_digits(token)
        if normalized_ndc:
            rxcui = await self._ndc_to_rxcui(normalized_ndc)
            if rxcui:
                return await self._ingredient_for_rxcui(rxcui)
            return None

        if token.isdigit():
            ingredient = await self._ingredient_for_rxcui(token)
            if ingredient:
                return ingredient

        payload = await self._rxnav_json("/REST/drugs.json", params={"name": token})
        groups = (payload.get("drugGroup") or {}).get("conceptGroup") or []
        for group in groups:
            props = group.get("conceptProperties") or []
            for prop in props:
                rxcui = prop.get("rxcui")
                if not rxcui:
                    continue
                ingredient = await self._ingredient_for_rxcui(str(rxcui))
                if ingredient:
                    return ingredient
        return None

    async def _related_product_rxcuis(self, ingredient_rxcui: str) -> list[dict[str, str]]:
        payload = await self._rxnav_json(
            f"/REST/rxcui/{ingredient_rxcui}/related.json",
            params={"tty": "SCD+SBD+GPCK+BPCK"},
        )
        groups = (payload.get("relatedGroup") or {}).get("conceptGroup") or []
        out: list[dict[str, str]] = []
        for group in groups:
            props = group.get("conceptProperties") or []
            for prop in props:
                rxcui = prop.get("rxcui")
                if rxcui:
                    out.append(
                        {
                            "rxcui": str(rxcui),
                            "name": str(prop.get("name") or ""),
                            "tty": str(prop.get("tty") or ""),
                        }
                    )
        unique: dict[str, dict[str, str]] = {}
        for item in out:
            unique[item["rxcui"]] = item
        return list(unique.values())

    async def _ndcs_for_rxcui(self, rxcui: str) -> list[str]:
        payload = await self._rxnav_json(f"/REST/rxcui/{rxcui}/ndcs.json")
        ndc_group = payload.get("ndcGroup") or {}
        ndc_list = ndc_group.get("ndcList") or {}
        ndcs = ndc_list.get("ndc") or []
        normalized: list[str] = []
        for raw in ndcs:
            ndc_digits = self._normalize_ndc_digits(str(raw))
            if ndc_digits:
                normalized.append(ndc_digits)
        return list(dict.fromkeys(normalized))

    async def get_alternatives_by_ingredient(self, rxcui_or_ingredient: str) -> dict[str, Any]:
        token = rxcui_or_ingredient.strip()
        if not token:
            raise ValueError("Ingredient or RxCUI is required")

        ingredient = await self._resolve_ingredient(token)
        if not ingredient:
            raise PricingNotFoundError("Could not resolve ingredient for alternatives lookup")

        related_rxcuis = await self._related_product_rxcuis(ingredient["rxcui"])
        ndc_meta: dict[str, dict[str, str]] = {}
        related_subset = related_rxcuis[:MAX_RELATED_RXCUIS]
        ndc_lists = await asyncio.gather(
            *(self._ndcs_for_rxcui(related["rxcui"]) for related in related_subset),
            return_exceptions=True,
        )

        ndcs: list[str] = []
        for related, ndc_list in zip(related_subset, ndc_lists):
            if isinstance(ndc_list, Exception):
                logger.debug("Skipping RxCUI=%s NDC lookup error: %s", related["rxcui"], ndc_list)
                continue
            ndcs.extend(ndc_list)
            for ndc in ndc_list:
                ndc_meta.setdefault(ndc, related)
        ndcs = list(dict.fromkeys(ndcs))[:MAX_ALTERNATIVE_NDCS]

        price_results = await asyncio.gather(*(self.get_price(ndc) for ndc in ndcs), return_exceptions=True)

        alternatives: list[dict[str, Any]] = []
        for ndc, item in zip(ndcs, price_results):
            if isinstance(item, PricingNotFoundError):
                continue
            if isinstance(item, Exception):
                logger.debug("Skipping alternative price lookup for ndc=%s due to error: %s", ndc, item)
                continue

            meta = ndc_meta.get(ndc, {})
            tty = str(meta.get("tty") or "")
            alternatives.append(
                {
                    "ndc": item["ndc"],
                    "price_per_unit": item["price_per_unit"],
                    "unit": item["unit"],
                    "effective_date": item["effective_date"],
                    "source": item["source"],
                    "as_of_week": item.get("as_of_week"),
                    "name": meta.get("name"),
                    "tty": tty,
                    "kind": "brand" if tty.startswith(("SB", "BP")) else "generic",
                }
            )

        if not alternatives:
            raise PricingNotFoundError("No NADAC alternatives found for this ingredient")

        alternatives.sort(key=lambda row: row["price_per_unit"])
        return {
            "ingredient": ingredient["name"],
            "ingredient_rxcui": ingredient["rxcui"],
            "alternatives": alternatives,
            "disclaimers": DEFAULT_DISCLAIMERS,
        }

    async def fetch_latest_week_rows(self, *, limit: int = 5000, offset: int = 0) -> tuple[str | None, list[dict[str, Any]]]:
        metadata = await self._get_latest_dataset_metadata()
        dataset_id = metadata["dataset_id"]
        as_of_week = metadata.get("as_of_week")
        url = self._nadac_query_url(dataset_id)

        params: dict[str, Any] = {
            "limit": max(1, min(int(limit), 50000)),
            "offset": max(0, int(offset)),
        }
        if as_of_week:
            params.update(
                {
                    "conditions[0][property]": "effective_date",
                    "conditions[0][value]": as_of_week,
                    "conditions[0][operator]": "=",
                }
            )

        payload = await self._request_json(url, params=params)
        rows = payload.get("results") or payload.get("result") or []
        if not isinstance(rows, list):
            rows = []
        return as_of_week, [row for row in rows if isinstance(row, dict)]


pricing_service = NADACPricingService()
