"""Drug pronunciation service helpers."""

import html
import logging
import re
from urllib.parse import urlparse

import requests
from sqlalchemy import text

logger = logging.getLogger(__name__)

_MEDLINEPLUS_CONNECT_URL = "https://connect.medlineplus.gov/service"
_PRONUNCIATION_REGEX = re.compile(r"pronounced as \(([^)]+)\)", re.IGNORECASE)
_ALLOWED_MEDLINEPLUS_HOSTS = {"medlineplus.gov", "www.medlineplus.gov"}

ARPABET_TO_TEXT = {
    'AA': 'ah', 'AE': 'a', 'AH': 'uh', 'AO': 'aw', 'AW': 'ow',
    'AY': 'eye', 'B': 'b', 'CH': 'ch', 'D': 'd', 'DH': 'th',
    'EH': 'eh', 'ER': 'er', 'EY': 'ay', 'F': 'f', 'G': 'g',
    'HH': 'h', 'IH': 'ih', 'IY': 'ee', 'JH': 'j', 'K': 'k',
    'L': 'l', 'M': 'm', 'N': 'n', 'NG': 'ng', 'OW': 'oh',
    'OY': 'oy', 'P': 'p', 'R': 'r', 'S': 's', 'SH': 'sh',
    'T': 't', 'TH': 'th', 'UH': 'uh', 'UW': 'oo', 'V': 'v',
    'W': 'w', 'Y': 'y', 'Z': 'z', 'ZH': 'zh'
}
_VOWELS = {'AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW'}


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


def generate_pronunciation_g2p(drug_name: str) -> str | None:
    """Generate a best-effort pronunciation using g2p_en phonemes."""
    try:
        from g2p_en import G2p
    except Exception:
        logger.warning("g2p_en is not installed; skipping g2p pronunciation for %r", drug_name)
        return None

    try:
        g2p = G2p()
        phonemes = [token for token in g2p(drug_name) if isinstance(token, str)]

        words: list[list[str]] = []
        current: list[str] = []
        for token in phonemes:
            base = re.sub(r"\d", "", token).upper()
            if base in ARPABET_TO_TEXT:
                current.append(token)
                continue
            if current:
                words.append(current)
                current = []
        if current:
            words.append(current)

        rendered_words = []
        for word in words:
            syllables: list[str] = []
            onset: list[str] = []
            for token in word:
                base = re.sub(r"\d", "", token).upper()
                rendered = ARPABET_TO_TEXT.get(base)
                if not rendered:
                    continue
                stressed = token.endswith("1")
                if base in _VOWELS:
                    syllable = "".join(onset + [rendered])
                    onset = []
                    if stressed:
                        syllable = syllable.upper()
                    syllables.append(syllable)
                elif syllables:
                    syllables[-1] = syllables[-1] + rendered
                else:
                    onset.append(rendered)

            if onset:
                if syllables:
                    syllables[-1] = syllables[-1] + "".join(onset)
                else:
                    syllables.append("".join(onset))

            if syllables:
                rendered_words.append("-".join(syllables))

        if not rendered_words:
            return None

        return " ".join(rendered_words)
    except Exception as exc:
        logger.warning("g2p pronunciation generation failed for %r: %s", drug_name, exc)
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
