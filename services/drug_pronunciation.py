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

# Regex to strip trailing dose/strength patterns like "10mg", "0.15mg tablet"
_DOSE_SUFFIX_RE = re.compile(
    r"\s+\d[\d./]*\s*(?:mg|mcg|ml|g|%|units?|iu|meq)\b.*$",
    re.IGNORECASE,
)
# Regex to detect imprint-like tokens: uppercase letter followed by digits (E101, IP204, DP331)
_IMPRINT_TOKEN_RE = re.compile(r"\s+([A-Z][A-Z0-9]*\d[A-Z0-9]*)(?=\s|$)")


def get_pronunciation_lookup_keys(
    conn,
    drug_name: str | None,
    rxcui: str | None = None,
) -> list[str]:
    """Return ordered pronunciation lookup keys for a drug.

    Uses the clean DB path rather than parsing the messy medicine_name:

    1. If *rxcui* is provided, resolve the clean ``generic_name`` and
       ``brand_names`` from ``drug_synonyms`` via the
       ``rxcui_to_ingredient`` mapping.  Try generic_name first, then
       each brand name.
    2. Fall back to normalized variants of ``drug_name``:
       a. Exact lowered match
       b. Strip trailing dose/strength (e.g. "10mg", "0.15mg tablet")
       c. Strip imprint suffix (e.g. "E101", "IP204")
       d. First word only (e.g. "lisinopril" from "Lisinopril E101 Tab")

    All returned values target ``drug_pronunciations.drug_name_lower``.
    """
    generic_name, brand_names = None, None

    # --- Strategy 1: resolve clean names via rxcui → drug_synonyms ---
    if rxcui:
        rxcui_clean = str(rxcui).strip()
        if rxcui_clean:
            try:
                syn_row = conn.execute(
                    text(
                        """
                        SELECT s.generic_name, s.brand_names
                        FROM rxcui_to_ingredient r
                        JOIN drug_synonyms s ON s.ingredient_rxcui = r.ingredient_rxcui
                        WHERE r.product_rxcui = :rxcui
                        LIMIT 1
                        """
                    ),
                    {"rxcui": rxcui_clean},
                ).fetchone()
                if syn_row:
                    generic_name, brand_names = syn_row[0], syn_row[1]
            except SQLAlchemyError as exc:
                err_msg = str(exc).lower()
                if (
                    ("drug_synonyms" in err_msg or "rxcui_to_ingredient" in err_msg)
                    and ("does not exist" in err_msg or "no such table" in err_msg)
                ):
                    logger.debug(
                        "drug_synonyms/rxcui_to_ingredient tables not yet created: %s", exc
                    )
                else:
                    logger.warning(
                        "drug_synonyms lookup failed for rxcui=%s: %s", rxcui, exc
                    )

    return _candidate_keys(generic_name, brand_names, drug_name)


def _candidate_keys(generic_name: str | None, brand_names, drug_name: str | None) -> list[str]:
    """get_pronunciation_lookup_keys() once the RxCUI's generic and brand names are known (none: no mapping)."""
    candidates: list[str] = []
    seen: set[str] = set()

    def _add(name: str | None) -> None:
        if not name:
            return
        n = name.strip().lower()
        if n and n not in seen:
            seen.add(n)
            candidates.append(n)

    # generic_name first (highest confidence), then each brand name
    _add(generic_name)
    for brand in brand_names or []:
        _add(brand)

    # --- Strategy 2: normalized variants of drug_name ---
    if drug_name:
        original = drug_name.strip()
        lowered = original.lower()

        # 2a. Exact lowered match
        _add(lowered)

        # 2b. Strip trailing dose/strength pattern
        dose_stripped = _DOSE_SUFFIX_RE.sub("", lowered).strip()
        _add(dose_stripped)

        # 2c. Strip from the first imprint-like token onward
        imprint_m = _IMPRINT_TOKEN_RE.search(original)
        if imprint_m:
            _add(original[: imprint_m.start()])

        # 2d. First word only (catches "Lisinopril E101" → "lisinopril")
        words = lowered.split()
        if len(words) > 1:
            _add(words[0])

    return candidates


def get_pronunciation(
    conn,
    drug_name: str | None,
    rxcui: str | None = None,
    include_meta: bool = False,
) -> dict[str, str | None] | None:
    """Return pronunciation payload for a drug, or None if unavailable."""
    # --- Try each candidate against drug_pronunciations ---
    candidates = get_pronunciation_lookup_keys(conn, drug_name, rxcui=rxcui)
    for candidate in candidates:
        try:
            row = conn.execute(
                text(
                    """
                    SELECT pronunciation_text, audio_url, source
                    FROM drug_pronunciations
                    WHERE drug_name_lower = :drug_name_lower
                    LIMIT 1
                    """
                ),
                {"drug_name_lower": candidate},
            ).fetchone()
            if row:
                pronunciation_text = row[0].strip() if row[0] else None
                audio_url = str(row[1]).strip() if row[1] else None
                payload = {
                    "pronunciation_text": pronunciation_text,
                    "audio_url": audio_url,
                }
                if include_meta:
                    payload["source"] = row[2] if row[2] else None
                    payload["drug_name_matched"] = candidate
                return payload
        except SQLAlchemyError as exc:
            err_msg = str(exc).lower()
            if "drug_pronunciations" in err_msg and (
                "does not exist" in err_msg or "no such table" in err_msg
            ):
                logger.debug("drug_pronunciations table not yet created: %s", exc)
            else:
                logger.warning(
                    "drug_pronunciations lookup failed for %r: %s", drug_name, exc
                )
            return None

    return None


# RxNorm term types of a branded product: the pill page treats these pills as brand pills (routes/details.py).
_BRAND_TTYS = ("SBD", "BPCK")


def _is_brand_product(conn, rxcui: str | None) -> bool:
    rxcui_clean = str(rxcui or "").strip()
    if not rxcui_clean:
        return False
    try:
        row = conn.execute(
            text("SELECT product_tty FROM rxcui_to_ingredient WHERE product_rxcui = :rxcui LIMIT 1"),
            {"rxcui": rxcui_clean},
        ).fetchone()
    except SQLAlchemyError as exc:
        logger.warning("product type lookup failed for rxcui=%s: %s", rxcui, exc)
        return False
    return bool(row) and row[0] in _BRAND_TTYS


def pill_pronunciation_key(conn, medicine_name: str | None, rxcui: str | None = None) -> str | None:
    """The drug_pronunciations row that holds a pill's own "pronounced as".

    A brand pill's is under its own name, the one the pill page shows beside a brand name. Filing it under
    the first lookup key (the generic) put brand sounds on every generic page: "ZES-tril" for lisinopril.
    Any other pill's is under the first lookup key, as before.
    """
    own = (medicine_name or "").strip().lower()
    if own and _is_brand_product(conn, rxcui):
        return own
    keys = get_pronunciation_lookup_keys(conn, medicine_name, rxcui=rxcui)
    return keys[0] if keys else None


def find_pill_pronunciation(
    conn,
    medicine_name: str | None,
    rxcui: str | None = None,
    include_meta: bool = False,
) -> dict[str, str | None] | None:
    """A pill's "pronounced as" for the admin: a brand pill's own row first, then get_pronunciation()."""
    own = (medicine_name or "").strip().lower()
    if own and _is_brand_product(conn, rxcui):
        try:
            row = conn.execute(
                text(
                    "SELECT pronunciation_text, audio_url, source FROM drug_pronunciations "
                    "WHERE drug_name_lower = :drug_name_lower LIMIT 1"
                ),
                {"drug_name_lower": own},
            ).fetchone()
        except SQLAlchemyError as exc:
            logger.warning("drug_pronunciations lookup failed for %r: %s", own, exc)
            row = None
        if row:
            payload = {
                "pronunciation_text": row[0].strip() if row[0] else None,
                "audio_url": str(row[1]).strip() if row[1] else None,
            }
            if include_meta:
                payload["source"] = row[2] if row[2] else None
                payload["drug_name_matched"] = own
            return payload
    return get_pronunciation(conn, medicine_name, rxcui=rxcui, include_meta=include_meta)


def pill_pronunciations(conn, pills: list[tuple[str | None, str | None]]) -> list[dict]:
    """pill_pronunciation_key() and find_pill_pronunciation(include_meta=True) for many (medicine_name, rxcui)
    pills in two queries, for the drafts grid (a query per pill each is slow from a server far from the database).
    One {"key": ..., "found": {...} | None} per pill, in the order given."""
    rxcuis = sorted({str(rxcui).strip() for _, rxcui in pills if rxcui and str(rxcui).strip()})
    products: dict[str, tuple] = {}
    if rxcuis:
        rows = conn.execute(
            text(
                "SELECT r.product_rxcui, r.product_tty, s.generic_name, s.brand_names FROM rxcui_to_ingredient r "
                "LEFT JOIN drug_synonyms s ON s.ingredient_rxcui = r.ingredient_rxcui WHERE r.product_rxcui = ANY(:rxcuis)"
            ),
            {"rxcuis": rxcuis},
        ).fetchall()
        for product_rxcui, tty, generic_name, brand_names in rows:
            products.setdefault(str(product_rxcui), (tty, generic_name, brand_names))

    plans = []  # per pill: its own key, and the keys looked at in order
    for medicine_name, rxcui in pills:
        tty, generic_name, brand_names = products.get(str(rxcui or "").strip(), (None, None, None))
        keys = _candidate_keys(generic_name, brand_names, medicine_name)
        own = (medicine_name or "").strip().lower()
        if own and tty in _BRAND_TTYS:
            plans.append((own, [own] + keys))
        else:
            plans.append((keys[0] if keys else None, keys))

    wanted = sorted({key for _, looked_at in plans for key in looked_at})
    saved: dict[str, tuple] = {}
    if wanted:
        rows = conn.execute(
            text(
                "SELECT drug_name_lower, pronunciation_text, audio_url, source FROM drug_pronunciations "
                "WHERE drug_name_lower = ANY(:keys)"
            ),
            {"keys": wanted},
        ).fetchall()
        saved = {row[0]: (row[1], row[2], row[3]) for row in rows}

    out = []
    for key, looked_at in plans:
        hit = next((k for k in looked_at if k in saved), None)
        found = None
        if hit:
            said, audio_url, source = saved[hit]
            found = {
                "pronunciation_text": said.strip() if said else None,
                "audio_url": str(audio_url).strip() if audio_url else None,
                "source": source if source else None,
                "drug_name_matched": hit,
            }
        out.append({"key": key, "found": found})
    return out


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
