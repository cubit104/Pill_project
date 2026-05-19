from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from email.utils import parsedate_to_datetime
from time import perf_counter
from typing import Any, Optional

import httpx
from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError

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
METADATA_CACHE_TTL_HOURS = 6
MAX_RELATED_RXCUIS = 40
MAX_ALTERNATIVE_NDCS = 150
MAX_EQUIVALENT_NDCS = 50
ALTERNATIVES_FETCH_CONCURRENCY = 8
# NADAC (National Average Drug Acquisition Cost) Weekly:
# https://data.medicaid.gov/dataset/99315a95-37ac-4eee-946a-3c523b4c481e
NADAC_FALLBACK_DATASET_ID = os.getenv(
    "NADAC_FALLBACK_DATASET_ID",
    "99315a95-37ac-4eee-946a-3c523b4c481e",
)


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
        stale_days_raw = os.getenv("PRICING_STALE_DAYS", "14")
        try:
            self.stale_threshold_days = max(1, int(stale_days_raw))
        except (TypeError, ValueError):
            self.stale_threshold_days = 14
        self._metadata_cache: dict[str, Any] | None = None
        self._metadata_cached_at: datetime | None = None
        self._schema_cache: dict[str, list[str]] = {}
        self._column_map: dict[str, dict[str, Any]] = {}

    @staticmethod
    def _is_missing_relation(exc: Exception) -> bool:
        msg = str(exc).lower()
        return "relation" in msg and "does not exist" in msg

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

    @staticmethod
    def _truncate_text(value: str, *, limit: int = 500) -> str:
        return value[:limit] if len(value) > limit else value

    @staticmethod
    def _slugify_token(value: str) -> str:
        slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
        return slug or "unknown"

    @staticmethod
    def _normalize_ingredient_terms(value: str) -> list[str]:
        if not value:
            return []
        cleaned = re.sub(r"\([^)]*\)", " ", value.lower())
        parts = re.split(r"\s*(?:/|\+|,|\band\b)\s*", cleaned)
        terms: list[str] = []
        stop_words = {"acid", "sodium", "potassium", "hydrochloride", "hcl"}
        for part in parts:
            tokenized = re.sub(r"[^a-z0-9 ]+", " ", part).strip()
            if not tokenized:
                continue
            tokens = tokenized.split()
            if not tokens:
                continue
            words = [word for word in tokens if word not in stop_words]
            term = words[0] if words else tokens[0]
            if term and term not in terms:
                terms.append(term)
        return terms

    @staticmethod
    def _strength_signature(name: str | None) -> str:
        if not name:
            return ""
        matches = re.findall(r"\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|units?|meq|%)", name.lower())
        return "|".join(re.sub(r"\s+", "", match) for match in matches)

    @staticmethod
    def _dose_form_signature(name: str | None) -> str:
        if not name:
            return ""
        lowered = name.lower()
        for marker in (
            "oral tablet",
            "oral capsule",
            "tablet",
            "capsule",
            "suspension",
            "solution",
            "injection",
            "cream",
            "ointment",
            "patch",
        ):
            if marker in lowered:
                return marker
        return ""

    @staticmethod
    def _dedupe_alternatives(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        deduped: dict[tuple[str, str], dict[str, Any]] = {}
        for row in rows:
            name_key = (row.get("name") or "").strip().lower()
            kind_key = row.get("kind") or "generic"
            group_key = (name_key, kind_key)
            if group_key not in deduped or row["price_per_unit"] < deduped[group_key]["price_per_unit"]:
                deduped[group_key] = row
        return sorted(deduped.values(), key=lambda row: row["price_per_unit"])

    def _format_request_failure(self, method: str, url: str, exc: Exception | None) -> str:
        method = method.upper()
        if exc is None:
            return f"Request failed: {method} {url}"

        exc_name = type(exc).__name__
        if isinstance(exc, httpx.HTTPStatusError):
            response = exc.response
            response_url = str(response.url) if response is not None else url
            status = response.status_code if response is not None else "unknown"
            body = ""
            if response is not None:
                try:
                    body = self._truncate_text((response.text or "").strip())
                except Exception:
                    body = ""
            parts = [f"Request failed: {method} {response_url}", f"{exc_name} {status}"]
            if body:
                parts.append(body)
            return " — ".join(parts)

        parts = [f"Request failed: {method} {url}", exc_name]
        message = str(exc).strip()
        if message:
            parts.append(message)
        return " — ".join(parts)

    @staticmethod
    def _exc_info(exc: Exception | None):
        if exc is None:
            return None
        return (type(exc), exc, exc.__traceback__)

    async def _request_json(
        self,
        url: str,
        *,
        method: str = "GET",
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
    ) -> Any:
        last_exc: Exception | None = None
        method = method.upper()
        for attempt in range(3):
            try:
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    if method == "GET":
                        response = await client.get(url, params=params)
                    else:
                        response = await client.request(method, url, params=params, json=json_body)
                response.raise_for_status()
                return response.json()
            except httpx.HTTPStatusError as exc:
                last_exc = exc
                status = exc.response.status_code if exc.response else None
                should_retry = status is not None and (status == 429 or status >= 500)
                if not should_retry or attempt == 2:
                    break
                await asyncio.sleep(self._retry_delay(attempt, exc.response))
            except httpx.RequestError as exc:
                last_exc = exc
                if attempt == 2:
                    break
                await asyncio.sleep(2**attempt)
        detail = self._format_request_failure(method, url, last_exc)
        logger.exception("%s", detail, exc_info=self._exc_info(last_exc))
        raise PricingServiceError(detail) from last_exc

    @staticmethod
    def _retry_delay(attempt: int, response: httpx.Response | None) -> float:
        if response is not None:
            retry_after = response.headers.get("Retry-After")
            if retry_after:
                try:
                    return max(float(retry_after), 0.0)
                except ValueError:
                    try:
                        retry_dt = parsedate_to_datetime(retry_after)
                        now = datetime.now(timezone.utc)
                        if retry_dt.tzinfo is None:
                            retry_dt = retry_dt.replace(tzinfo=timezone.utc)
                        return max((retry_dt - now).total_seconds(), 0.0)
                    except Exception:
                        pass
        return float(2**attempt)

    def _extract_dataset_id(self, item: dict[str, Any]) -> str | None:
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
                for subkey in ("%Ref:downloadURL", "downloadURL", "accessURL", "url"):
                    value = obj.get(subkey)
                    if not isinstance(value, str) or not value:
                        continue
                    match = re.search(
                        r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
                        value,
                    )
                    if match:
                        return match.group(0)

        for key in ("identifier", "dataset_id", "id", "resource_id"):
            value = item.get(key)
            if isinstance(value, str) and value:
                return value
        return None

    async def _get_latest_dataset_metadata(self) -> dict[str, Any]:
        logger.info("Resolving NADAC dataset metadata")
        now = datetime.now(timezone.utc)
        if (
            self._metadata_cache
            and self._metadata_cached_at
            and (now - self._metadata_cached_at) < timedelta(hours=METADATA_CACHE_TTL_HOURS)
        ):
            return self._metadata_cache

        try:
            payload = await self._request_json(self.nadac_catalog_url, params={"limit": 2000})
            if isinstance(payload, list):
                items = payload
            elif isinstance(payload, dict):
                items = (
                    payload.get("results")
                    or payload.get("items")
                    or payload.get("result")
                    or payload.get("dataset")
                    or []
                )
                if not isinstance(items, list):
                    items = []
            else:
                items = []

            if not items:
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

            as_of_week = await self._fetch_latest_effective_date(dataset_id)
            metadata = {
                "dataset_id": dataset_id,
                "as_of_week": as_of_week.isoformat() if as_of_week else None,
                "title": item.get("title") or item.get("name") or "NADAC",
            }
            self._metadata_cache = metadata
            self._metadata_cached_at = now
            return metadata
        except Exception as exc:
            logger.exception("NADAC catalog lookup failed; attempting fallback dataset id")
            fallback_id = os.getenv("NADAC_FALLBACK_DATASET_ID") or NADAC_FALLBACK_DATASET_ID
            if not fallback_id:
                raise PricingServiceError("NADAC catalog unavailable and no fallback configured") from exc
            metadata = {
                "dataset_id": fallback_id,
                "as_of_week": None,
                "title": "NADAC (fallback)",
            }
            try:
                as_of_week = await self._fetch_latest_effective_date(fallback_id)
                metadata["as_of_week"] = as_of_week.isoformat() if as_of_week else None
            except Exception:
                logger.exception("Unable to derive latest effective date for fallback NADAC dataset")
            self._metadata_cache = metadata
            self._metadata_cached_at = now
            return metadata

    def _nadac_query_url(self, dataset_id: str) -> str:
        return f"{self.nadac_api_base_url.rstrip('/')}/datastore/query/{dataset_id}/0"

    async def _request_datastore_query(
        self,
        dataset_id: str,
        *,
        conditions: list[dict[str, Any]] | None = None,
        group_operator: str | None = None,
        sorts: list[dict[str, Any]] | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> Any:
        body: dict[str, Any] = {}
        if conditions:
            body["conditions"] = conditions
        if group_operator:
            body["groupOperator"] = group_operator
        if sorts:
            body["sorts"] = sorts
        if limit is not None:
            body["limit"] = limit
        if offset is not None:
            body["offset"] = offset
        return await self._request_json(
            self._nadac_query_url(dataset_id),
            method="POST",
            json_body=body,
        )

    @staticmethod
    def _rows_from_payload(payload: Any) -> list[dict[str, Any]]:
        if not isinstance(payload, dict):
            return []
        rows = payload.get("results") or payload.get("result") or []
        if not isinstance(rows, list):
            return []
        return [row for row in rows if isinstance(row, dict)]

    async def _get_dataset_columns(self, distribution_id: str) -> list[str]:
        if distribution_id in self._schema_cache:
            return self._schema_cache[distribution_id]

        try:
            payload = await self._request_datastore_query(distribution_id, limit=1)
            rows = self._rows_from_payload(payload)
            columns = list(rows[0].keys()) if rows else []
            self._schema_cache[distribution_id] = columns
            return columns
        except Exception as exc:
            logger.warning(
                "Failed to discover NADAC schema for distribution_id=%s: %s",
                distribution_id,
                exc,
            )
            self._schema_cache[distribution_id] = []
            return []

    @staticmethod
    def _pick_column(
        columns: list[str],
        candidates: list[str],
        *,
        contains: str | None = None,
    ) -> str | None:
        if not columns:
            return None

        by_lower = {col.lower(): col for col in columns}
        for candidate in candidates:
            found = by_lower.get(candidate.lower())
            if found:
                return found

        if contains:
            needle = contains.lower()
            for col in columns:
                if needle in col.lower():
                    return col
        return None

    async def _resolve_column_map(self, distribution_id: str) -> dict[str, Any]:
        if distribution_id in self._column_map:
            return self._column_map[distribution_id]

        columns = await self._get_dataset_columns(distribution_id)

        ndc_col = self._pick_column(columns, ["ndc", "ndc_11", "ndc11", "ndc_code"], contains="ndc")
        if ndc_col and "description" in ndc_col.lower():
            ndc_col = None

        effective_date_col = self._pick_column(columns, ["effective_date", "as_of_date", "as_of"])
        if not effective_date_col:
            effective_date_col = self._pick_column(columns, [], contains="effective")
        if not effective_date_col:
            effective_date_col = self._pick_column(columns, [], contains="as_of")

        price_col = self._pick_column(columns, ["nadac_per_unit", "nadac_per_unit_amount", "nadac"])
        if not price_col:
            for col in columns:
                col_l = col.lower()
                if "nadac" in col_l and ("unit" in col_l or "per" in col_l):
                    price_col = col
                    break

        unit_col = self._pick_column(columns, ["pricing_unit", "unit", "nadac_unit"])
        if not unit_col:
            unit_col = self._pick_column(columns, [], contains="unit")

        resolved = {
            "ndc": ndc_col or "ndc",
            "effective_date": effective_date_col or "effective_date",
            "price": price_col or "nadac_per_unit",
            "unit": unit_col or "pricing_unit",
            "all_columns": columns,
        }
        self._column_map[distribution_id] = resolved
        return resolved

    async def _fetch_latest_effective_date(self, dataset_id: str) -> date | None:
        try:
            column_map = await self._resolve_column_map(dataset_id)
            date_col = str(column_map.get("effective_date") or "effective_date")
            payload = await self._request_datastore_query(
                dataset_id,
                sorts=[{"resource": "t", "property": date_col, "order": "desc"}],
                limit=1,
            )
            rows = self._rows_from_payload(payload)
            if not rows:
                return None
            row = rows[0]
            return (
                self._parse_date(row.get(date_col))
                or self._parse_date(row.get("effective_date"))
                or self._parse_date(row.get("as_of_date"))
            )
        except Exception as exc:
            logger.exception("Unable to derive latest NADAC effective_date from dataset rows")
            return None

    def _parse_nadac_row(
        self,
        row: dict[str, Any],
        *,
        ndc_digits: str,
        as_of_week: str | None,
        column_map: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        column_map = column_map or {}
        price_col = str(column_map.get("price") or "nadac_per_unit")
        unit_col = str(column_map.get("unit") or "pricing_unit")
        effective_date_col = str(column_map.get("effective_date") or "effective_date")

        price = self._decimal(row.get(price_col))
        if price is None:
            for key in ("nadac_per_unit", "nadac_per_unit_amount", "nadac"):
                price = self._decimal(row.get(key))
                if price is not None:
                    break
        if price is None:
            return None

        unit = row.get(unit_col) or row.get("pricing_unit") or row.get("unit") or row.get("nadac_unit") or "EA"
        effective_date = (
            self._parse_date(row.get(effective_date_col))
            or self._parse_date(row.get("effective_date"))
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
        logger.info("Fetching latest NADAC row for ndc=%s", ndc_digits)
        metadata = await self._get_latest_dataset_metadata()
        dataset_id = metadata["dataset_id"]
        as_of_week = metadata.get("as_of_week")
        column_map = await self._resolve_column_map(dataset_id)
        columns = column_map.get("all_columns") or []

        candidates: list[str] = []
        if columns:
            chosen = self._pick_column(columns, ["ndc", "ndc_11", "ndc11", "ndc_code"], contains="ndc")
            if chosen and "description" in chosen.lower():
                chosen = None
            if chosen:
                candidates.append(chosen)
        for candidate in ("ndc", "ndc_11", "ndc11", "ndc_code"):
            if candidate.lower() not in {c.lower() for c in candidates}:
                candidates.append(candidate)

        last_error: Exception | None = None
        date_col = str(column_map.get("effective_date") or "effective_date")
        for ndc_field in candidates:
            try:
                payload = await self._request_datastore_query(
                    dataset_id,
                    conditions=[{"resource": "t", "property": ndc_field, "value": ndc_digits, "operator": "="}],
                    sorts=[{"resource": "t", "property": date_col, "order": "desc"}],
                    limit=1,
                )
            except PricingServiceError as exc:
                if "Column not found" in str(exc) or " 400 " in str(exc):
                    last_error = exc
                    logger.info("NADAC column '%s' not found, trying next candidate", ndc_field)
                    continue
                raise
            rows = self._rows_from_payload(payload)
            if not rows:
                continue
            parsed = self._parse_nadac_row(rows[0], ndc_digits=ndc_digits, as_of_week=as_of_week, column_map=column_map)
            if parsed:
                return parsed

        if last_error is not None:
            logger.exception("All NDC column candidates rejected by CMS", exc_info=self._exc_info(last_error))

        raise PricingNotFoundError(f"No NADAC price found for NDC {ndc_digits}")

    async def _sibling_ndcs_for_ndc(self, ndc_digits: str) -> list[str]:
        try:
            rxcui = await self._ndc_to_rxcui(ndc_digits)
        except Exception as exc:
            logger.warning("Failed resolving RxCUI for ndc=%s: %s", ndc_digits, exc)
            return []
        if not rxcui:
            return []

        try:
            siblings = await self._ndcs_for_rxcui(rxcui)
        except Exception as exc:
            logger.warning("Failed resolving sibling NDCs for rxcui=%s ndc=%s: %s", rxcui, ndc_digits, exc)
            return []

        unique = sorted({s for s in siblings if s and s != ndc_digits})
        return unique[:MAX_EQUIVALENT_NDCS]

    async def _bulk_query_nadac_for_ndcs(
        self,
        dataset_id: str,
        ndcs: list[str],
        column_map: dict[str, Any],
    ) -> dict[str, dict[str, Any]]:
        if not ndcs:
            return {}
        ndc_column = str(column_map.get("ndc") or "ndc")
        normalized_ndcs = sorted({ndc for ndc in ndcs if ndc})
        found: dict[str, dict[str, Any]] = {}

        try:
            payload = await self._request_datastore_query(
                dataset_id,
                conditions=[
                    {
                        "resource": "t",
                        "property": ndc_column,
                        "operator": "in",
                        "value": normalized_ndcs,
                    }
                ],
                limit=len(normalized_ndcs),
            )
            for row in self._rows_from_payload(payload):
                row_ndc = self._normalize_ndc_digits(str(row.get(ndc_column) or ""))
                if row_ndc:
                    found[row_ndc] = row
            return found
        except Exception as exc:
            # Some CMS datastore distributions reject `in`; fallback to chunked OR queries.
            logger.info("NADAC bulk IN query failed; falling back to OR chunks: %s", exc)

        try:
            chunk_size = 25
            for idx in range(0, len(normalized_ndcs), chunk_size):
                chunk = normalized_ndcs[idx : idx + chunk_size]
                payload = await self._request_datastore_query(
                    dataset_id,
                    conditions=[
                        {
                            "resource": "t",
                            "property": ndc_column,
                            "operator": "=",
                            "value": ndc,
                        }
                        for ndc in chunk
                    ],
                    group_operator="or",
                    limit=len(chunk),
                )
                for row in self._rows_from_payload(payload):
                    row_ndc = self._normalize_ndc_digits(str(row.get(ndc_column) or ""))
                    if row_ndc:
                        found[row_ndc] = row
            return found
        except Exception as exc:
            logger.warning("NADAC bulk sibling query failed for %s ndcs: %s", len(normalized_ndcs), exc)
            return {}

    async def _fetch_nadac_equivalent_for_ndc(self, ndc_digits: str) -> dict[str, Any] | None:
        siblings = await self._sibling_ndcs_for_ndc(ndc_digits)
        if not siblings:
            return None

        try:
            metadata = await self._get_latest_dataset_metadata()
        except Exception as exc:
            logger.warning("Failed loading NADAC metadata for equivalent fallback ndc=%s: %s", ndc_digits, exc)
            return None

        dataset_id = metadata["dataset_id"]
        as_of_week = metadata.get("as_of_week")
        column_map = await self._resolve_column_map(dataset_id)
        rows_by_ndc = await self._bulk_query_nadac_for_ndcs(dataset_id, siblings, column_map)
        if not rows_by_ndc:
            return None

        parsed_rows: list[dict[str, Any]] = []
        for sibling_ndc, row in rows_by_ndc.items():
            parsed = self._parse_nadac_row(
                row,
                ndc_digits=sibling_ndc,
                as_of_week=as_of_week,
                column_map=column_map,
            )
            if parsed:
                parsed_rows.append(parsed)
        if not parsed_rows:
            return None

        cheapest = min(parsed_rows, key=lambda row: row["price_per_unit"])
        equivalent = dict(cheapest)
        equivalent["ndc"] = ndc_digits
        equivalent["matched_ndc"] = cheapest["ndc"]
        equivalent["match_type"] = "equivalent"
        equivalent["equivalent_count"] = len(siblings)
        return equivalent

    def _ensure_db(self) -> None:
        if not database.db_engine and not database.connect_to_database():
            raise PricingServiceError("Database connection not available")

    def _get_cached_price(self, ndc_digits: str) -> dict[str, Any] | None:
        self._ensure_db()
        try:
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
        except ProgrammingError as exc:
            if self._is_missing_relation(exc):
                logger.error("drug_prices table missing — did the migration run?")
                raise PricingServiceError("drug_prices table missing — did the migration run?") from exc
            raise

    def _get_cached_prices_bulk(self, ndc_digits_list: list[str]) -> dict[str, dict[str, Any]]:
        if not ndc_digits_list:
            return {}
        self._ensure_db()
        try:
            with database.db_engine.connect() as conn:
                rows = conn.execute(
                    text(
                        """
                        SELECT ndc, price_per_unit, unit, effective_date, source, raw_payload, fetched_at
                        FROM drug_prices
                        WHERE ndc = ANY(:ndcs)
                        """
                    ),
                    {"ndcs": ndc_digits_list},
                ).mappings().all()
            return {str(row["ndc"]): dict(row) for row in rows}
        except ProgrammingError as exc:
            if self._is_missing_relation(exc):
                logger.error("drug_prices table missing — did the migration run?")
                raise PricingServiceError("drug_prices table missing — did the migration run?") from exc
            raise

    def _upsert_price_cache(
        self,
        price: dict[str, Any],
        *,
        cache_key: str | None = None,
        include_history: bool = True,
    ) -> None:
        self._ensure_db()
        raw_payload = price.get("raw_payload")
        if isinstance(raw_payload, dict):
            payload_json = dict(raw_payload)
        else:
            payload_json = {}
        for field in (
            "match_type",
            "matched_ndc",
            "equivalent_count",
            "source_rxcui",
            "resolved_ingredient",
            "resolved_rxcui",
            "ndc",
            "source",
            "as_of_week",
        ):
            if field in price:
                payload_json[field] = price[field]
        cache_ndc = cache_key or price["ndc"]
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
                    "ndc": cache_ndc,
                    "price_per_unit": price["price_per_unit"],
                    "unit": price["unit"],
                    "effective_date": price["effective_date"],
                    "source": "NADAC",
                    "raw_payload": json.dumps(payload_json),
                },
            )
            if include_history:
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

    @staticmethod
    def _equivalent_fields_from_raw_payload(raw_payload: Any) -> dict[str, Any]:
        payload_obj = raw_payload
        if isinstance(payload_obj, str):
            try:
                payload_obj = json.loads(payload_obj)
            except Exception:
                payload_obj = None
        if not isinstance(payload_obj, dict):
            return {}

        out: dict[str, Any] = {}
        for key in (
            "match_type",
            "matched_ndc",
            "equivalent_count",
            "source_rxcui",
            "resolved_ingredient",
            "resolved_rxcui",
            "ndc",
            "source",
            "as_of_week",
            "is_stale",
        ):
            if key in payload_obj:
                out[key] = payload_obj[key]
        return out

    def _payload_from_cached_row(self, cached: dict[str, Any], latest_week: date | None) -> dict[str, Any]:
        payload = self._equivalent_fields_from_raw_payload(cached.get("raw_payload"))
        out = {
            "ndc": payload.get("ndc") or cached["ndc"],
            "price_per_unit": float(cached["price_per_unit"]),
            "unit": cached["unit"],
            "effective_date": str(cached["effective_date"]),
            "source": payload.get("source") or NADAC_SOURCE,
            "as_of_week": payload.get("as_of_week") or (latest_week.isoformat() if latest_week else None),
        }
        for key in (
            "match_type",
            "matched_ndc",
            "equivalent_count",
            "source_rxcui",
            "resolved_ingredient",
            "resolved_rxcui",
            "is_stale",
        ):
            if key in payload:
                out[key] = payload[key]
        return out

    def _is_effective_date_stale(self, effective_date_value: Any, latest_week: date | None) -> bool:
        if not latest_week:
            return False
        effective_date = self._parse_date(effective_date_value)
        if not effective_date:
            return False
        threshold_date = latest_week - timedelta(days=self.stale_threshold_days)
        return effective_date < threshold_date

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
        request_started = perf_counter()
        ndc_digits = self._normalize_ndc_digits(ndc)
        if not ndc_digits:
            raise ValueError("Invalid NDC format")

        cache_status = "miss"
        latest_week = None
        try:
            metadata = await self._get_latest_dataset_metadata()
            latest_week = self._parse_date(metadata.get("as_of_week"))
        except Exception:
            logger.exception("Failed to resolve latest NADAC metadata; falling back to TTL-only cache")

        cache_started = perf_counter()
        cached = self._get_cached_price(ndc_digits)
        cache_duration_ms = (perf_counter() - cache_started) * 1000
        cached_is_stale = bool(cached and self._is_effective_date_stale(cached.get("effective_date"), latest_week))
        if cached and self._cache_fresh(cached, None) and not cached_is_stale:
            total_duration_ms = (perf_counter() - request_started) * 1000
            logger.info("[price-cache] %s - hit - %.2fms", ndc_digits, total_duration_ms)
            payload = self._payload_from_cached_row(cached, None)
            result = self._add_totals(payload, days_supply=days_supply, units_per_day=units_per_day)
            result["cache_status"] = "hit"
            result["cache_duration_ms"] = round(cache_duration_ms, 2)
            result["fetch_duration_ms"] = 0.0
            return result
        if cached:
            cache_status = "stale"

        fetch_started = perf_counter()
        try:
            latest = await self._fetch_nadac_latest_for_ndc(ndc_digits)
        except PricingNotFoundError:
            equivalent = await self._fetch_nadac_equivalent_for_ndc(ndc_digits)
            if equivalent is None:
                if cached and cached_is_stale:
                    total_duration_ms = (perf_counter() - request_started) * 1000
                    fetch_duration_ms = (perf_counter() - fetch_started) * 1000
                    logger.info("[price-cache] %s - stale-fallback - %.2fms", ndc_digits, total_duration_ms)
                    payload = self._payload_from_cached_row(cached, latest_week)
                    payload["is_stale"] = True
                    result = self._add_totals(payload, days_supply=days_supply, units_per_day=units_per_day)
                    result["cache_status"] = cache_status
                    result["cache_duration_ms"] = round(cache_duration_ms, 2)
                    result["fetch_duration_ms"] = round(fetch_duration_ms, 2)
                    return result
                raise
            latest = equivalent
        fetch_duration_ms = (perf_counter() - fetch_started) * 1000
        self._upsert_price_cache(latest)
        total_duration_ms = (perf_counter() - request_started) * 1000
        logger.info("[price-cache] %s - %s - %.2fms", ndc_digits, cache_status, total_duration_ms)
        result = self._add_totals(latest, days_supply=days_supply, units_per_day=units_per_day)
        result["cache_status"] = cache_status
        result["cache_duration_ms"] = round(cache_duration_ms, 2)
        result["fetch_duration_ms"] = round(fetch_duration_ms, 2)
        return result

    async def get_price_by_rxcui(
        self,
        rxcui: str,
        *,
        days_supply: int = 30,
        units_per_day: float = 1.0,
    ) -> dict[str, Any]:
        request_started = perf_counter()
        rxcui_digits = re.sub(r"\D", "", (rxcui or "").strip())
        if not rxcui_digits:
            raise ValueError("Invalid RxCUI format")

        cache_key = f"rxcui:{rxcui_digits}"
        cache_status = "miss"
        cache_started = perf_counter()
        cached = self._get_cached_price(cache_key)
        cache_duration_ms = (perf_counter() - cache_started) * 1000
        if cached and self._cache_fresh(cached, None):
            total_duration_ms = (perf_counter() - request_started) * 1000
            logger.info("[price-cache] %s - hit - %.2fms", cache_key, total_duration_ms)
            payload = self._payload_from_cached_row(cached, None)
            result = self._add_totals(payload, days_supply=days_supply, units_per_day=units_per_day)
            result["cache_status"] = "hit"
            result["cache_duration_ms"] = round(cache_duration_ms, 2)
            result["fetch_duration_ms"] = 0.0
            return result
        if cached:
            cache_status = "stale"

        metadata: dict[str, Any] | None = None
        latest_week = None
        try:
            metadata = await self._get_latest_dataset_metadata()
            latest_week = self._parse_date(metadata.get("as_of_week"))
        except Exception:
            logger.exception("Failed to resolve latest NADAC metadata for RxCUI lookup")

        fetch_started = perf_counter()
        siblings = await self._ndcs_for_rxcui(rxcui_digits)
        if not siblings:
            raise PricingNotFoundError(f"No NDCs found for RxCUI {rxcui_digits}")

        if metadata is None:
            metadata = await self._get_latest_dataset_metadata()
        dataset_id = metadata["dataset_id"]
        as_of_week = metadata.get("as_of_week")
        column_map = await self._resolve_column_map(dataset_id)
        rows_by_ndc = await self._bulk_query_nadac_for_ndcs(dataset_id, siblings, column_map)
        if not rows_by_ndc:
            raise PricingNotFoundError(f"No NADAC pricing found for any NDC of RxCUI {rxcui_digits}")

        parsed_rows: list[dict[str, Any]] = []
        for sibling_ndc, row in rows_by_ndc.items():
            parsed = self._parse_nadac_row(
                row,
                ndc_digits=sibling_ndc,
                as_of_week=as_of_week,
                column_map=column_map,
            )
            if parsed:
                parsed_rows.append(parsed)
        if not parsed_rows:
            raise PricingNotFoundError(f"No NADAC pricing found for any NDC of RxCUI {rxcui_digits}")

        cheapest = min(parsed_rows, key=lambda row: row["price_per_unit"])
        result = dict(cheapest)
        result["match_type"] = "equivalent"
        result["matched_ndc"] = cheapest["ndc"]
        result["source_rxcui"] = rxcui_digits
        result["equivalent_count"] = len(siblings)

        cache_payload = dict(result)
        cache_payload["raw_payload"] = dict(result)
        self._upsert_price_cache(
            cache_payload,
            cache_key=cache_key,
            include_history=False,
        )
        fetch_duration_ms = (perf_counter() - fetch_started) * 1000
        total_duration_ms = (perf_counter() - request_started) * 1000
        logger.info("[price-cache] %s - %s - %.2fms", cache_key, cache_status, total_duration_ms)
        priced = self._add_totals(result, days_supply=days_supply, units_per_day=units_per_day)
        priced["cache_status"] = cache_status
        priced["cache_duration_ms"] = round(cache_duration_ms, 2)
        priced["fetch_duration_ms"] = round(fetch_duration_ms, 2)
        return priced

    async def get_price_by_name(
        self,
        name: str,
        *,
        days_supply: int = 30,
        units_per_day: float = 1.0,
    ) -> dict[str, Any]:
        request_started = perf_counter()
        clean_name = (name or "").strip()
        if not clean_name:
            raise ValueError("Drug name is required")

        cache_key = f"name:{self._slugify_token(clean_name)}"
        cache_status = "miss"
        cache_started = perf_counter()
        cached = self._get_cached_price(cache_key)
        cache_duration_ms = (perf_counter() - cache_started) * 1000
        if cached and self._cache_fresh(cached, None):
            total_duration_ms = (perf_counter() - request_started) * 1000
            logger.info("[price-cache] %s - hit - %.2fms", cache_key, total_duration_ms)
            payload = self._payload_from_cached_row(cached, None)
            result = self._add_totals(payload, days_supply=days_supply, units_per_day=units_per_day)
            result["cache_status"] = "hit"
            result["cache_duration_ms"] = round(cache_duration_ms, 2)
            result["fetch_duration_ms"] = 0.0
            return result
        if cached:
            cache_status = "stale"

        metadata: dict[str, Any] | None = None
        latest_week = None
        try:
            metadata = await self._get_latest_dataset_metadata()
            latest_week = self._parse_date(metadata.get("as_of_week"))
        except Exception:
            logger.exception("Failed to resolve latest NADAC metadata for name lookup")

        fetch_started = perf_counter()
        ingredient = await self._resolve_ingredient(clean_name)
        if not ingredient:
            raise PricingNotFoundError(f"Could not resolve RxCUI for drug name '{clean_name}'")

        product_rxcuis = await self._related_product_rxcuis(ingredient["rxcui"])
        if not product_rxcuis:
            raise PricingNotFoundError(f"No product RxCUIs found for ingredient '{ingredient['name']}'")

        product_subset = product_rxcuis[:MAX_RELATED_RXCUIS]
        ndc_lists = await asyncio.gather(
            *(self._ndcs_for_rxcui(p["rxcui"]) for p in product_subset),
            return_exceptions=True,
        )
        ndcs: list[str] = []
        for product, ndc_list in zip(product_subset, ndc_lists):
            if isinstance(ndc_list, Exception):
                logger.debug("Skipping RxCUI=%s NDC lookup error: %s", product["rxcui"], ndc_list)
                continue
            ndcs.extend(ndc_list)
        ndcs = list(dict.fromkeys(ndcs))[:MAX_ALTERNATIVE_NDCS]

        if not ndcs:
            raise PricingNotFoundError(f"No NDCs found for ingredient '{ingredient['name']}'")

        if metadata is None:
            metadata = await self._get_latest_dataset_metadata()
        dataset_id = metadata["dataset_id"]
        as_of_week = metadata.get("as_of_week")
        column_map = await self._resolve_column_map(dataset_id)
        rows_by_ndc = await self._bulk_query_nadac_for_ndcs(dataset_id, ndcs, column_map)
        if not rows_by_ndc:
            raise PricingNotFoundError(f"No NADAC pricing found for any NDC of ingredient '{ingredient['name']}'")

        parsed_rows: list[dict[str, Any]] = []
        for ndc_key, row in rows_by_ndc.items():
            parsed = self._parse_nadac_row(
                row,
                ndc_digits=ndc_key,
                as_of_week=as_of_week,
                column_map=column_map,
            )
            if parsed:
                parsed_rows.append(parsed)
        if not parsed_rows:
            raise PricingNotFoundError(f"No NADAC pricing found for any NDC of ingredient '{ingredient['name']}'")

        cheapest = min(parsed_rows, key=lambda r: r["price_per_unit"])
        result = dict(cheapest)
        result["match_type"] = "approximate"
        result["matched_ndc"] = cheapest["ndc"]
        result["resolved_ingredient"] = ingredient["name"]
        result["resolved_rxcui"] = ingredient["rxcui"]
        result["equivalent_count"] = len(ndcs)

        cache_payload = dict(result)
        cache_payload["raw_payload"] = dict(result)
        self._upsert_price_cache(cache_payload, cache_key=cache_key, include_history=False)
        fetch_duration_ms = (perf_counter() - fetch_started) * 1000
        total_duration_ms = (perf_counter() - request_started) * 1000
        logger.info("[price-cache] %s - %s - %.2fms", cache_key, cache_status, total_duration_ms)
        priced = self._add_totals(result, days_supply=days_supply, units_per_day=units_per_day)
        priced["cache_status"] = cache_status
        priced["cache_duration_ms"] = round(cache_duration_ms, 2)
        priced["fetch_duration_ms"] = round(fetch_duration_ms, 2)
        return priced

    async def get_price_history(self, ndc: str, weeks: int = 52) -> list[dict[str, Any]]:
        ndc_digits = self._normalize_ndc_digits(ndc)
        if not ndc_digits:
            raise ValueError("Invalid NDC format")

        weeks = max(1, min(int(weeks), 260))
        self._ensure_db()

        latest_week = None
        metadata: dict[str, Any] | None = None
        try:
            metadata = await self._get_latest_dataset_metadata()
            latest_week = self._parse_date(metadata.get("as_of_week"))
        except Exception:
            logger.exception("Failed to resolve NADAC metadata for history lookup")

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
            newest_cached = self._parse_date(cached_rows[0].get("effective_date"))
            cache_has_enough_rows = len(cached_rows) >= weeks
            cache_recent_enough = (
                latest_week is None
                or (newest_cached is not None and newest_cached >= (latest_week - timedelta(days=7)))
            )
            if not metadata:
                cache_has_enough_rows = True
                cache_recent_enough = True
            if cache_has_enough_rows and cache_recent_enough:
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

        if not metadata:
            raise PricingServiceError("Unable to resolve NADAC metadata for history lookup")

        dataset_id = metadata["dataset_id"]
        as_of_week = metadata.get("as_of_week")
        column_map = await self._resolve_column_map(dataset_id)
        columns = column_map.get("all_columns") or []

        candidates: list[str] = []
        if columns:
            chosen = self._pick_column(columns, ["ndc", "ndc_11", "ndc11", "ndc_code"], contains="ndc")
            if chosen and "description" in chosen.lower():
                chosen = None
            if chosen:
                candidates.append(chosen)
        for candidate in ("ndc", "ndc_11", "ndc11", "ndc_code"):
            if candidate.lower() not in {c.lower() for c in candidates}:
                candidates.append(candidate)

        rows: list[dict[str, Any]] = []
        last_error: Exception | None = None
        date_col = str(column_map.get("effective_date") or "effective_date")
        for ndc_field in candidates:
            try:
                payload = await self._request_datastore_query(
                    dataset_id,
                    conditions=[{"resource": "t", "property": ndc_field, "value": ndc_digits, "operator": "="}],
                    sorts=[{"resource": "t", "property": date_col, "order": "desc"}],
                    limit=weeks,
                )
            except PricingServiceError as exc:
                if "Column not found" in str(exc) or " 400 " in str(exc):
                    last_error = exc
                    logger.info("NADAC column '%s' not found for history, trying next candidate", ndc_field)
                    continue
                raise
            records = self._rows_from_payload(payload)
            if records:
                rows = records
                break

        parsed_rows: list[dict[str, Any]] = []
        for row in rows:
            parsed = self._parse_nadac_row(row, ndc_digits=ndc_digits, as_of_week=as_of_week, column_map=column_map)
            if parsed:
                parsed_rows.append(parsed)

        if not parsed_rows:
            if last_error is not None:
                logger.exception("All NDC history column candidates rejected by CMS", exc_info=self._exc_info(last_error))
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

    async def _rxnav_json(self, path: str, *, params: dict[str, Any] | None = None) -> Any:
        url = f"{self.rxnav_base_url.rstrip('/')}{path}"
        return await self._request_json(url, params=params)

    async def _ndc_to_rxcui(self, ndc_digits: str) -> str | None:
        payload = await self._rxnav_json("/REST/ndcstatus.json", params={"ndc": ndc_digits})
        if not isinstance(payload, dict):
            raise PricingServiceError("Unexpected RxNav ndcstatus response shape")
        status = payload.get("ndcStatus") or {}
        if not isinstance(status, dict):
            return None
        value = status.get("rxcui")
        return str(value) if value else None

    async def _ingredient_for_rxcui(self, rxcui: str) -> dict[str, str] | None:
        # RxNav expects tty multi-values joined by a literal '+'; using params= would encode it as '%2B' and 400.
        payload = await self._rxnav_json(f"/REST/rxcui/{rxcui}/related.json?tty=IN+PIN")
        if not isinstance(payload, dict):
            raise PricingServiceError("Unexpected RxNav related response shape")
        related_group = payload.get("relatedGroup") or {}
        if not isinstance(related_group, dict):
            return None
        groups = related_group.get("conceptGroup") or []
        if not isinstance(groups, list):
            return None
        for group in groups:
            if not isinstance(group, dict):
                continue
            props = group.get("conceptProperties") or []
            if not isinstance(props, list):
                continue
            for prop in props:
                if not isinstance(prop, dict):
                    continue
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
        if not isinstance(payload, dict):
            raise PricingServiceError("Unexpected RxNav drugs response shape")
        drug_group = payload.get("drugGroup") or {}
        if not isinstance(drug_group, dict):
            return None
        groups = drug_group.get("conceptGroup") or []
        if not isinstance(groups, list):
            return None
        for group in groups:
            if not isinstance(group, dict):
                continue
            props = group.get("conceptProperties") or []
            if not isinstance(props, list):
                continue
            for prop in props:
                if not isinstance(prop, dict):
                    continue
                rxcui = prop.get("rxcui")
                if not rxcui:
                    continue
                ingredient = await self._ingredient_for_rxcui(str(rxcui))
                if ingredient:
                    return ingredient
        return None

    async def _related_product_rxcuis(self, ingredient_rxcui: str) -> list[dict[str, str]]:
        # RxNav expects tty multi-values joined by a literal '+'; keep query inline to avoid '%2B' encoding.
        payload = await self._rxnav_json(
            f"/REST/rxcui/{ingredient_rxcui}/related.json?tty=SCD+SBD+GPCK+BPCK",
        )
        if not isinstance(payload, dict):
            raise PricingServiceError("Unexpected RxNav related products response shape")
        related_group = payload.get("relatedGroup") or {}
        if not isinstance(related_group, dict):
            return []
        groups = related_group.get("conceptGroup") or []
        if not isinstance(groups, list):
            return []
        out: list[dict[str, str]] = []
        for group in groups:
            if not isinstance(group, dict):
                continue
            props = group.get("conceptProperties") or []
            if not isinstance(props, list):
                continue
            for prop in props:
                if not isinstance(prop, dict):
                    continue
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
        if not isinstance(payload, dict):
            raise PricingServiceError("Unexpected RxNav NDC list response shape")
        ndc_group = payload.get("ndcGroup") or {}
        if not isinstance(ndc_group, dict):
            return []
        ndc_list = ndc_group.get("ndcList") or {}
        if not isinstance(ndc_list, dict):
            return []
        ndcs = ndc_list.get("ndc") or []
        if not isinstance(ndcs, list):
            return []
        normalized: list[str] = []
        for raw in ndcs:
            ndc_digits = self._normalize_ndc_digits(str(raw))
            if ndc_digits:
                normalized.append(ndc_digits)
        return list(dict.fromkeys(normalized))

    async def get_alternatives_by_ingredient(self, rxcui_or_ingredient: str) -> dict[str, Any]:
        logger.info("Resolving NADAC alternatives for token=%s", rxcui_or_ingredient)
        token = rxcui_or_ingredient.strip()
        if not token:
            raise ValueError("Ingredient or RxCUI is required")

        ingredient = await self._resolve_ingredient(token)
        if not ingredient:
            raise PricingNotFoundError("Could not resolve ingredient for alternatives lookup")

        latest_week = None
        try:
            metadata = await self._get_latest_dataset_metadata()
            latest_week = self._parse_date(metadata.get("as_of_week"))
        except Exception:
            logger.exception("Failed to resolve NADAC metadata for alternatives lookup")

        async def _collect_alternatives(related_rxcuis: list[dict[str, str]]) -> list[dict[str, Any]]:
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

            rows: list[dict[str, Any]] = []
            stale_or_missing_ndcs: list[str] = []
            cached_rows = self._get_cached_prices_bulk(ndcs)
            for ndc in ndcs:
                cached = cached_rows.get(ndc)
                if cached and self._cache_fresh(cached, latest_week):
                    item = {
                        "ndc": str(cached["ndc"]),
                        "price_per_unit": float(cached["price_per_unit"]),
                        "unit": str(cached["unit"]),
                        "effective_date": str(cached["effective_date"]),
                        "source": NADAC_SOURCE,
                        "as_of_week": latest_week.isoformat() if latest_week else None,
                    }
                else:
                    stale_or_missing_ndcs.append(ndc)
                    continue

                meta = ndc_meta.get(ndc, {})
                tty = str(meta.get("tty") or "")
                rows.append(
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

            if stale_or_missing_ndcs:
                semaphore = asyncio.Semaphore(ALTERNATIVES_FETCH_CONCURRENCY)

                async def _fetch_missing_price(ndc: str):
                    async with semaphore:
                        try:
                            return ndc, await self.get_price(ndc)
                        except PricingNotFoundError:
                            return ndc, None
                        except Exception as exc:
                            logger.debug("Skipping alternative price lookup for ndc=%s due to error: %s", ndc, exc)
                            return ndc, None

                fetched = await asyncio.gather(
                    *(_fetch_missing_price(ndc) for ndc in stale_or_missing_ndcs),
                )
                for ndc, item in fetched:
                    if not item:
                        continue
                    meta = ndc_meta.get(ndc, {})
                    tty = str(meta.get("tty") or "")
                    rows.append(
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

            return rows

        related_rxcuis = await self._related_product_rxcuis(ingredient["rxcui"])
        alternatives = await _collect_alternatives(related_rxcuis)

        if not alternatives:
            raise PricingNotFoundError("No NADAC alternatives found for this ingredient")

        ingredient_terms = self._normalize_ingredient_terms(ingredient["name"])
        normalized_ndc = self._normalize_ndc_digits(token)
        reference = next((row for row in alternatives if normalized_ndc and row.get("ndc") == normalized_ndc), alternatives[0])
        reference_strength = self._strength_signature(reference.get("name"))
        reference_dose_form = self._dose_form_signature(reference.get("name"))

        def _matches_ingredient_set(row: dict[str, Any]) -> bool:
            if len(ingredient_terms) <= 1:
                return True
            lowered_name = str(row.get("name") or "").lower()
            return all(term in lowered_name for term in ingredient_terms)

        def _filter_rows(*, include_dose_form: bool, include_strength: bool) -> list[dict[str, Any]]:
            out: list[dict[str, Any]] = []
            for row in alternatives:
                if not _matches_ingredient_set(row):
                    continue
                if include_dose_form and reference_dose_form:
                    if self._dose_form_signature(row.get("name")) != reference_dose_form:
                        continue
                if include_strength and reference_strength:
                    if self._strength_signature(row.get("name")) != reference_strength:
                        continue
                out.append(dict(row))
            return self._dedupe_alternatives(out)

        scoped = _filter_rows(include_dose_form=True, include_strength=True)
        if len(scoped) < 3:
            scoped = _filter_rows(include_dose_form=False, include_strength=True)
        if len(scoped) < 3:
            scoped = _filter_rows(include_dose_form=False, include_strength=False)

        if len(scoped) < 3 and len(ingredient_terms) > 1:
            primary_token = ingredient_terms[0]
            primary_ingredient = await self._resolve_ingredient(primary_token)
            if primary_ingredient and primary_ingredient.get("rxcui") and primary_ingredient["rxcui"] != ingredient["rxcui"]:
                primary_related = await self._related_product_rxcuis(primary_ingredient["rxcui"])
                primary_rows = await _collect_alternatives(primary_related)
                primary_only_rows: list[dict[str, Any]] = []
                for row in primary_rows:
                    lowered_name = str(row.get("name") or "").lower()
                    if primary_token not in lowered_name:
                        continue
                    if _matches_ingredient_set(row):
                        continue
                    tagged = dict(row)
                    tagged["match_scope"] = "primary_ingredient_only"
                    primary_only_rows.append(tagged)
                scoped = self._dedupe_alternatives(scoped + primary_only_rows)

        # Limit to top 5 unique products.
        alternatives = scoped[:5]

        # Mark the single cheapest result.
        for i, alt in enumerate(alternatives):
            alt["is_cheapest"] = i == 0

        # Compute generic_vs_brand_ratio when both brand and generic exist.
        brands = [a for a in alternatives if a.get("kind") == "brand"]
        generics = [a for a in alternatives if a.get("kind") != "brand"]
        generic_vs_brand_ratio: int | None = None
        if brands and generics:
            max_brand_price = max(b["price_per_unit"] for b in brands)
            min_generic_price = min(g["price_per_unit"] for g in generics)
            if min_generic_price > 0:
                generic_vs_brand_ratio = round(max_brand_price / min_generic_price)

        result: dict[str, Any] = {
            "ingredient": ingredient["name"],
            "ingredient_rxcui": ingredient["rxcui"],
            "alternatives": alternatives,
            "disclaimers": DEFAULT_DISCLAIMERS,
        }
        if generic_vs_brand_ratio is not None:
            result["generic_vs_brand_ratio"] = generic_vs_brand_ratio
        return result

    async def fetch_latest_week_rows(self, *, limit: int = 5000, offset: int = 0) -> tuple[str | None, list[dict[str, Any]]]:
        metadata = await self._get_latest_dataset_metadata()
        dataset_id = metadata["dataset_id"]
        as_of_week = metadata.get("as_of_week")
        column_map = await self._resolve_column_map(dataset_id)
        date_col = str(column_map.get("effective_date") or "effective_date")

        conditions = None
        if as_of_week:
            conditions = [{"resource": "t", "property": date_col, "value": as_of_week, "operator": "="}]

        payload = await self._request_datastore_query(
            dataset_id,
            conditions=conditions,
            limit=max(1, min(int(limit), 50000)),
            offset=max(0, int(offset)),
        )
        return as_of_week, self._rows_from_payload(payload)


pricing_service = NADACPricingService()
