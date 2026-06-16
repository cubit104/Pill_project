"""Drug pronunciation service helpers."""

import html
import logging
import os
import re
import time
from urllib.parse import urlparse

import requests
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

logger = logging.getLogger(__name__)

_MEDLINEPLUS_CONNECT_URL = "https://connect.medlineplus.gov/service"
_PRONUNCIATION_REGEX = re.compile(r"pronounced as \(([^)]+)\)", re.IGNORECASE)
_ALLOWED_MEDLINEPLUS_HOSTS = {"medlineplus.gov", "www.medlineplus.gov"}
_GEMINI_ENDPOINT = (
    "https://generativelanguage.googleapis.com/v1beta/models"
    "/gemini-2.5-flash:generateContent"
)


def get_pronunciation(conn, drug_name: str | None) -> str | None:
    """Return pronunciation text for a drug name, or None if unavailable."""
    lookup_name = (drug_name or "").strip().lower()
    if not lookup_name:
        return None

    try:
        row = conn.execute(
            text(
                """
                SELECT pronunciation_text
                FROM drug_pronunciations
                WHERE drug_name_lower = :drug_name_lower
                  AND pronunciation_text IS NOT NULL
                LIMIT 1
                """
            ),
            {"drug_name_lower": lookup_name},
        ).fetchone()
    except SQLAlchemyError as exc:
        err_msg = str(exc).lower()
        if "drug_pronunciations" in err_msg and ("does not exist" in err_msg or "no such table" in err_msg):
            logger.debug("drug_pronunciations table not yet created: %s", exc)
        else:
            logger.warning("drug_pronunciations lookup failed for %r: %s", drug_name, exc)
        return None

    if not row:
        return None

    return str(row[0]).strip() or None


def fetch_pronunciation_from_medlineplus(rxcui: str) -> dict | None:
    """Fetch pronunciation text from MedlinePlus by RxCUI."""
    try:
        connect_resp = requests.get(
            _MEDLINEPLUS_CONNECT_URL,
            params={
                "mainSearchCriteria.v.cs": "2.16.840.1.113883.6.88",
                "mainSearchCriteria.v.c": rxcui,
                "knowledgeResponseType": "application/json",
            },
            timeout=10,
        )
        connect_resp.raise_for_status()
        payload = connect_resp.json()

        entries = (payload.get("feed") or {}).get("entry") or []
        if isinstance(entries, dict):
            entries = [entries]

        for entry in entries:
            links = entry.get("link") or []
            if isinstance(links, dict):
                links = [links]
            for link in links:
                href = html.unescape((link.get("href") or "").strip())
                parsed = urlparse(href)
                if (
                    parsed.scheme != "https"
                    or parsed.hostname not in _ALLOWED_MEDLINEPLUS_HOSTS
                    or "/druginfo/meds/" not in parsed.path
                ):
                    continue

                page_resp = requests.get(href, timeout=10)
                page_resp.raise_for_status()
                match = _PRONUNCIATION_REGEX.search(page_resp.text)
                if not match:
                    continue

                title_raw = entry.get("title") or {}
                if isinstance(title_raw, dict):
                    drug_name = (title_raw.get("_value") or "").strip()
                else:
                    drug_name = str(title_raw).strip()

                return {
                    "pronunciation_text": match.group(1).strip(),
                    "medlineplus_url": href,
                    "drug_name": drug_name or None,
                }
    except Exception as exc:
        logger.warning("MedlinePlus pronunciation fetch failed for rxcui=%s: %s", rxcui, exc)

    return None


def generate_pronunciation_gemini(drug_name: str, max_retries: int = 2) -> str | None:
    """Generate a pronunciation using the Google Gemini 2.5 Flash API.

    Retries up to *max_retries* times on timeout / transient errors with
    exponential back-off (2s, 4s).
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        logger.warning("GEMINI_API_KEY not set; skipping Gemini pronunciation for %r", drug_name)
        return None

    prompt = (
        f'Give the phonetic pronunciation of the drug name "{drug_name}" in the same style that MedlinePlus uses.\n'
        "Example: clopidogrel = kloh pid' oh grel\n"
        "Example: metformin = met for' min\n"
        "Example: lisinopril = lyse in' oh pril\n"
        "Return ONLY the pronunciation text, nothing else. No quotes, no drug name, no explanation."
    )

    last_exc = None
    for attempt in range(1 + max_retries):
        try:
            response = requests.post(
                _GEMINI_ENDPOINT,
                params={"key": api_key},
                json={"contents": [{"parts": [{"text": prompt}]}]},
                timeout=30,
            )
            response.raise_for_status()
            result = response.json()
            text_value = result["candidates"][0]["content"]["parts"][0]["text"]
            return text_value.strip().strip('"\'')
        except Exception as exc:
            last_exc = exc
            if attempt < max_retries:
                wait = 2 ** (attempt + 1)
                logger.info("Gemini attempt %d failed for %r, retrying in %ds...", attempt + 1, drug_name, wait)
                time.sleep(wait)

    logger.warning("Gemini pronunciation generation failed for %r after %d attempts: %s", drug_name, 1 + max_retries, last_exc)
    return None


def upsert_pronunciation(
    conn,
    drug_name: str,
    pronunciation_text: str,
    source: str,
    medlineplus_url: str | None = None,
    needs_review: bool = False,
) -> str:
    """Upsert a drug pronunciation row and return inserted/updated/skipped_manual."""
    row = conn.execute(
        text(
            """
            INSERT INTO drug_pronunciations
                (drug_name_lower, drug_name_display, pronunciation_text, source, medlineplus_url, needs_review)
            VALUES
                (LOWER(:drug_name), :drug_name, :pronunciation_text, :source, :medlineplus_url, :needs_review)
            ON CONFLICT (drug_name_lower) DO UPDATE
            SET drug_name_display  = EXCLUDED.drug_name_display,
                pronunciation_text = EXCLUDED.pronunciation_text,
                source             = EXCLUDED.source,
                medlineplus_url    = EXCLUDED.medlineplus_url,
                needs_review       = EXCLUDED.needs_review
            WHERE drug_pronunciations.source <> 'manual'
            RETURNING (xmax = 0) AS was_inserted
            """
        ),
        {
            "drug_name": drug_name,
            "pronunciation_text": pronunciation_text,
            "source": source,
            "medlineplus_url": medlineplus_url,
            "needs_review": needs_review,
        },
    ).fetchone()

    if row is None:
        return "skipped_manual"
    return "inserted" if row[0] else "updated"


def resolve_rxcui_for_drug_name(conn, drug_name: str) -> str | None:
    """Resolve a best-effort ingredient/product RxCUI for a drug name."""
    row = conn.execute(
        text(
            """
            SELECT ingredient_rxcui
            FROM drug_synonyms
            WHERE LOWER(generic_name) = LOWER(:drug_name)
              AND ingredient_rxcui IS NOT NULL
            LIMIT 1
            """
        ),
        {"drug_name": drug_name},
    ).fetchone()
    if row and row[0]:
        return str(row[0])

    row = conn.execute(
        text(
            """
            SELECT ingredient_rxcui
            FROM drug_synonyms ds
            WHERE EXISTS (
                SELECT 1
                FROM unnest(ds.brand_names) AS brand_name
                WHERE LOWER(brand_name) = LOWER(:drug_name)
            )
              AND ingredient_rxcui IS NOT NULL
            LIMIT 1
            """
        ),
        {"drug_name": drug_name},
    ).fetchone()
    if row and row[0]:
        return str(row[0])

    row = conn.execute(
        text(
            """
            SELECT rxcui
            FROM pillfinder
            WHERE LOWER(medicine_name) = LOWER(:drug_name)
              AND rxcui IS NOT NULL
              AND rxcui <> ''
            LIMIT 1
            """
        ),
        {"drug_name": drug_name},
    ).fetchone()
    if row and row[0]:
        return str(row[0])

    return None
