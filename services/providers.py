"""Find a doctor / pharmacies / urgent care for the website (and later the app).

Four free public sources, one small cache table (``provider_cache``):

* NPPES NPI Registry (CMS): every US clinician and health organisation, the
  list itself: name, credential, specialties and licences, practice address,
  phone. No key. The registry caps a query at 200 rows in no particular order,
  so a ZIP search asks for each of the nearest ZIPs separately and we rank by
  distance ourselves (same approach as the mobile app's lib/doctors.ts).
* GeoNames US postal codes (data/us-zips.json, CC BY 4.0): ZIP → city, state
  and centroid; powers city live-fill, "near me" and the distance shown.
* US Census geocoder: street address → coordinates for the map pins (batch of
  up to 100 per call). No key.
* CMS "Doctors and Clinicians" (data.cms.gov provider data): medical school,
  graduation year, Medicare assignment, telehealth, group practice, hospital
  affiliations, for clinicians enrolled in Medicare. No key.
* Google Places (New), optional (``GOOGLE_PLACES_KEY``): the practice's
  website, hours, phone and Google rating. Two calls per provider, ids-only
  text search then place details; results cached 30 days (Google's limit).

Everything network-facing is small and mockable; the pure helpers are tested.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import logging
import math
import os
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

import requests
from sqlalchemy import text

import database

logger = logging.getLogger(__name__)

NPI_API = "https://npiregistry.cms.hhs.gov/api/"
CENSUS_BATCH = "https://geocoding.geo.census.gov/geocoder/locations/addressbatch"
CENSUS_ONE = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"
CMS_QUERY = "https://data.cms.gov/provider-data/api/1/datastore/query/{dataset}/0"
CMS_CLINICIANS = "mj5m-pzi6"
CMS_AFFILIATIONS = "27ea-46a8"
CMS_HOSPITALS = "xubh-q36u"
PLACES_SEARCH = "https://places.googleapis.com/v1/places:searchText"
PLACES_DETAILS = "https://places.googleapis.com/v1/places/{place_id}"
PLACES_DETAIL_FIELDS = "id,displayName,formattedAddress,rating,userRatingCount,regularOpeningHours,websiteUri,nationalPhoneNumber,googleMapsUri,location,businessStatus"

UA = {"User-Agent": "PillSeek/1.0 (+https://pillseek.com)", "Accept": "application/json"}
TIMEOUT = 15
CMS_TIMEOUT = 25  # the CMS datastore has no index on NPI; a lookup takes 5-15 s
PAGE = 200
MAX_RESULTS = 100
NEARBY_ZIPS = 10
NEARBY_MILES = 12
CACHE_DAYS = 30
GEOCODE_BATCH_MAX = 100
# A browser location farther than this from any US ZIP is not a US location.
MAX_NEAREST_ZIP_MILES = 60
# A place search keeps results within this radius. The registry's city/state filter also
# matches MAILING addresses, so a clinic that only receives post in town would otherwise
# show up with its real practice a thousand miles away.
MAX_RESULT_MILES = 60
ZIP_TABLE_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "us-zips.json")


# ---- Specialties ------------------------------------------------------------------

class Specialty:
    def __init__(self, key: str, label: str, taxonomy: str, match: str, kind: str = "NPI-1", name_hint: str = "", blurb: str = ""):
        self.key, self.label, self.taxonomy, self.kind, self.name_hint, self.blurb = key, label, taxonomy, kind, name_hint, blurb
        self.match = re.compile(match)

    def as_dict(self) -> dict:
        return {"key": self.key, "label": self.label, "blurb": self.blurb}


# The registry matches taxonomy words loosely ("Psychiatry" also returns neurologists);
# `match` keeps only what we mean. Same list and regexes as the mobile app.
SPECIALTIES: List[Specialty] = [
    Specialty("all", "All providers", "", r".", blurb="Doctors, nurse practitioners, PAs, therapists"),
    Specialty("family", "Family doctor", "Family Medicine", r"Family", blurb="Check-ups, everyday care"),
    Specialty("internal", "Internal medicine", "Internal Medicine", r"^Internal Medicine", blurb="Adult primary care"),
    Specialty("allergy", "Allergist", "Allergy & Immunology", r"Allergy", blurb="Allergies, asthma"),
    Specialty("cardiology", "Cardiologist", "Cardiovascular Disease", r"Cardiovascular|Cardiolog", blurb="Heart and blood pressure"),
    Specialty("chiro", "Chiropractor", "Chiropractor", r"Chiropract", blurb="Back and neck"),
    Specialty("dentist", "Dentist", "Dentist*", r"Dentist", blurb="Teeth and gums"),
    Specialty("dermatology", "Dermatologist", "Dermatology", r"Dermatolog", blurb="Skin, hair and nails"),
    Specialty("endo", "Endocrinologist", "Endocrinology", r"Endocrinolog", blurb="Diabetes, thyroid, hormones"),
    Specialty("ent", "ENT (ear, nose, throat)", "Otolaryngology", r"Otolaryngolog", blurb="Ears, sinuses, throat"),
    Specialty("eye", "Eye doctor (ophthalmologist)", "Ophthalmology", r"Ophthalmolog", blurb="Eye disease and surgery"),
    Specialty("gastro", "Gastroenterologist", "Gastroenterology", r"Gastroenterolog", blurb="Stomach and digestion"),
    Specialty("neurology", "Neurologist", "Neurology", r",\s*[^,]*Neurology[^,]*$", blurb="Brain and nerves"),
    Specialty("np", "Nurse practitioner", "Nurse Practitioner", r"Nurse Practitioner", blurb="Primary and specialty care"),
    Specialty("obgyn", "OB/GYN", "Obstetrics & Gynecology", r"Obstetric|Gynecolog", blurb="Women's health, pregnancy"),
    Specialty("oncology", "Oncologist", "Oncology", r"^(?!Pharmac|Nurse|Registered Nurse|Physician Assistant|Clinical Nurse).*Oncolog", blurb="Cancer care"),
    Specialty("optometrist", "Optometrist (glasses & contacts)", "Optometrist", r"Optometr", blurb="Eye exams, glasses"),
    Specialty("ortho", "Orthopedic surgeon", "Orthopaedic Surgery", r"Orthop", blurb="Bones, joints, injuries"),
    Specialty("pediatrics", "Pediatrician", "Pediatrics", r"Pediatric", blurb="Babies, children, teens"),
    Specialty("pt", "Physical therapist", "Physical Therapist", r"Physical Therap", blurb="Movement and recovery"),
    Specialty("pa", "Physician assistant", "Physician Assistant", r"Physician Assistant", blurb="Primary and specialty care"),
    Specialty("podiatry", "Podiatrist (feet)", "Podiatrist", r"Podiatr", blurb="Feet and ankles"),
    Specialty("psychiatry", "Psychiatrist", "Psychiatry", r"^Psychiatry$|,\s*[^,]*Psychiatry[^,]*$", blurb="Mental health, medication"),
    Specialty("psychologist", "Psychologist", "Psychologist", r"Psycholog", blurb="Therapy and testing"),
    Specialty("pulmo", "Pulmonologist (lungs)", "Pulmonary Disease", r"Pulmonary", blurb="Lungs and breathing"),
    Specialty("rheum", "Rheumatologist", "Rheumatology", r"Rheumatolog", blurb="Arthritis, autoimmune"),
    Specialty("counselor", "Therapist / counselor", "Counselor", r"Counselor", blurb="Talk therapy"),
    Specialty("urology", "Urologist", "Urology", r"\bUrolog", blurb="Kidneys, bladder, prostate"),
]
PHARMACY = Specialty("pharmacy", "Pharmacy", "Pharmacy*", r"Pharmac", kind="NPI-2", name_hint="*pharmacy*", blurb="Pharmacies near you")
URGENT_CARE = Specialty("urgent", "Urgent care", "Urgent Care", r"Urgent Care", kind="NPI-2", name_hint="*urgent*", blurb="Walk-in clinics")
KINDS = {"doctors": None, "pharmacy": PHARMACY, "urgent": URGENT_CARE}
_BY_KEY = {s.key: s for s in SPECIALTIES}


def specialty_by_key(key: str) -> Specialty:
    return _BY_KEY.get(key) or _BY_KEY["family"]


# ---- ZIP geography ---------------------------------------------------------------

class ZipTable:
    def __init__(self, raw: Iterable[list]):
        self.rows = [{"zip": z, "city": c, "state": s, "lat": float(la), "lon": float(lo)} for z, c, s, la, lo in raw]
        self.by_zip = {r["zip"]: r for r in self.rows}
        acc: Dict[str, dict] = {}
        for r in self.rows:
            key = f"{r['city'].lower()}|{r['state']}"
            c = acc.get(key)
            if c:
                c["lat"] += r["lat"]
                c["lon"] += r["lon"]
                c["zips"].append(r["zip"])
            else:
                acc[key] = {"city": r["city"], "state": r["state"], "lat": r["lat"], "lon": r["lon"], "zips": [r["zip"]]}
        self.cities = sorted(
            ({"city": c["city"], "state": c["state"], "lat": c["lat"] / len(c["zips"]), "lon": c["lon"] / len(c["zips"]), "zips": c["zips"]} for c in acc.values()),
            key=lambda c: (c["city"], c["state"]),
        )
        self.states = {r["state"] for r in self.rows}


_table: Optional[ZipTable] = None
_table_lock = threading.Lock()


def zip_table() -> ZipTable:
    """The bundled table, loaded once (about 1.7 MB of JSON)."""
    global _table
    if _table is None:
        with _table_lock:
            if _table is None:
                with open(ZIP_TABLE_PATH, encoding="utf-8") as f:
                    _table = ZipTable(json.load(f))
    return _table


EARTH_MILES = 3958.8


def distance_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lon / 2) ** 2
    return 2 * EARTH_MILES * math.asin(math.sqrt(a))


def nearest_zip(table: ZipTable, lat: float, lon: float) -> Optional[dict]:
    best, best_d = None, float("inf")
    for r in table.rows:
        if abs(r["lat"] - lat) > 1.5:
            continue
        d = distance_miles(lat, lon, r["lat"], r["lon"])
        if d < best_d:
            best, best_d = r, d
    if best is None:  # middle of the ocean: full scan
        for r in table.rows:
            d = distance_miles(lat, lon, r["lat"], r["lon"])
            if d < best_d:
                best, best_d = r, d
    return best


def nearby_zips(table: ZipTable, lat: float, lon: float, limit: int = NEARBY_ZIPS, max_miles: float = NEARBY_MILES) -> List[dict]:
    out = []
    for r in table.rows:
        if abs(r["lat"] - lat) > 0.5:
            continue
        d = distance_miles(lat, lon, r["lat"], r["lon"])
        if d <= max_miles:
            out.append((d, r))
    out.sort(key=lambda x: x[0])
    return [r for _, r in out[:limit]]


def suggest_cities(table: ZipTable, query: str, limit: int = 8) -> List[dict]:
    """Live-fill for the city box: "san fr" → San Francisco, CA. Accepts "city, st"."""
    q = query.strip().lower()
    if len(q) < 2:
        return []
    m = re.match(r"^(.*?)[,\s]+([a-z]{2})$", q)
    state_guess = m.group(2).upper() if m else None
    is_state = state_guess is not None and state_guess in table.states
    name = (m.group(1) if is_state else q).strip()
    state = state_guess if is_state else None
    if not name:
        return []
    starts, contains = [], []
    for c in table.cities:
        if state and c["state"] != state:
            continue
        lc = c["city"].lower()
        if lc.startswith(name):
            starts.append(c)
        elif name in lc:
            contains.append(c)
        if len(starts) >= 60:  # enough to sort by size; "plan" must still reach Plano, TX
            break
    by_size = lambda c: (-len(c["zips"]), c["city"])  # noqa: E731
    hits = sorted(starts, key=by_size) + sorted(contains, key=by_size)
    return [{"city": c["city"], "state": c["state"], "zips": len(c["zips"])} for c in hits[:limit]]


def find_city(table: ZipTable, city: str, state: str) -> Optional[dict]:
    lc, st = city.strip().lower(), state.strip().upper()
    return next((c for c in table.cities if c["state"] == st and c["city"].lower() == lc), None)


# ---- NPPES ---------------------------------------------------------------------------

def _title(s: str) -> str:
    out = re.sub(r"\b([a-z])", lambda m: m.group(1).upper(), s.lower())
    for word, fixed in (("Md", "MD"), ("Do", "DO"), ("Llc", "LLC"), ("Pc", "PC"), ("Pa", "PA"), ("Np", "NP")):
        out = re.sub(rf"\b{word}\b", fixed, out)
    return out


def _short_zip(z: str) -> str:
    return re.sub(r"\D", "", z or "")[:5]


def _address(a: dict) -> dict:
    line1 = str(a.get("address_1") or "").strip()
    line2 = str(a.get("address_2") or "").strip()
    if line2 and line2.upper() in line1.upper():  # "2520 AVENUE K, SUITE 600" + "SUITE 600"
        line2 = ""
    return {
        "address": _title(", ".join(x for x in (line1, line2) if x)),
        "city": _title(str(a.get("city") or "")),
        "state": str(a.get("state") or ""),
        "zip": _short_zip(str(a.get("postal_code") or "")),
        "phone": str(a.get("telephone_number") or ""),
    }


def parse_npi_response(data: Any) -> List[dict]:
    """One registry response → display rows (practice address, title-cased names, every specialty)."""
    results = (data or {}).get("results") if isinstance(data, dict) else None
    if not isinstance(results, list):
        return []
    out, seen = [], set()
    for r in results:
        npi = str(r.get("number") or "")
        if not npi or npi in seen:
            continue
        addresses = r.get("addresses") or []
        loc = next((a for a in addresses if a.get("address_purpose") == "LOCATION"), addresses[0] if addresses else None)
        if not loc or not loc.get("address_1"):
            continue
        # Foreign practice addresses (a Paris office, postal code 75116) would collide with US ZIPs.
        if str(loc.get("country_code") or "US").upper() not in ("US", ""):
            continue
        basic = r.get("basic") or {}
        organisation = r.get("enumeration_type") == "NPI-2"
        org_name = str(basic.get("organization_name") or basic.get("name") or "")
        person = " ".join(str(x) for x in (basic.get("first_name"), basic.get("last_name")) if x)
        name = _title((org_name or person) if organisation else (person or org_name))
        if not name.strip():
            continue
        taxonomies = [
            {"desc": str(t.get("desc")), "state": str(t.get("state") or ""), "license": str(t.get("license") or ""), "primary": t.get("primary") is True}
            for t in (r.get("taxonomies") or []) if t.get("desc")
        ]
        primary = next((t for t in taxonomies if t["primary"]), taxonomies[0] if taxonomies else None)
        a = _address(loc)
        m = re.match(r"^\d{4}", str(basic.get("enumeration_date") or ""))
        seen.add(npi)
        out.append({
            "npi": npi,
            "name": name,
            "last": "" if organisation else _title(str(basic.get("last_name") or "")),
            "credential": str(basic.get("credential") or "").replace(".", "").upper(),
            "specialty": primary["desc"] if primary else "",
            "organisation": organisation,
            "taxonomies": taxonomies,
            "gender": basic.get("gender") if basic.get("gender") in ("M", "F") else "",
            "since": m.group(0) if m else "",
            "distanceMiles": None,
            "lat": None,
            "lon": None,
            **a,
        })
    return out


def filter_by_specialty(rows: List[dict], sp: Specialty) -> List[dict]:
    """Keep rows carrying the specialty in any taxonomy; show that one on the card."""
    out = []
    for d in rows:
        if (sp.key == "all" and not d["taxonomies"] and not d["specialty"]) or sp.match.search(d["specialty"]):
            out.append(d)
            continue
        hit = next((t for t in d["taxonomies"] if sp.match.search(t["desc"])), None)
        if hit:
            out.append({**d, "specialty": hit["desc"]})
    return out


def merge_results(lists: Iterable[List[dict]]) -> List[dict]:
    seen, out = set(), []
    for lst in lists:
        for d in lst:
            if d["npi"] in seen:
                continue
            seen.add(d["npi"])
            out.append(d)
    return out


def rank_by_distance(rows: List[dict], origin: Optional[dict], table: ZipTable, max_miles: float = MAX_RESULT_MILES) -> List[dict]:
    """Nearest first, within `max_miles` of the origin; rows whose ZIP the table does not know go last."""
    if not origin:
        return rows
    ranked = []
    for d in rows:
        z = table.by_zip.get(d["zip"])
        ranked.append({**d, "distanceMiles": round(distance_miles(origin["lat"], origin["lon"], z["lat"], z["lon"]), 2) if z else None})
    known = sorted((d for d in ranked if d["distanceMiles"] is not None and d["distanceMiles"] <= max_miles), key=lambda d: d["distanceMiles"])
    return known + [d for d in ranked if d["distanceMiles"] is None]


class UpstreamError(Exception):
    """A data source did not answer properly; the result must not be cached as a negative."""


class ProviderError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status, self.detail = status, detail


def _npi_query(sp: Specialty, extra: dict, by_name: bool = False) -> List[dict]:
    params = {"version": "2.1", "enumeration_type": sp.kind, "limit": str(PAGE)}
    if not by_name and sp.taxonomy:
        params["taxonomy_description"] = sp.taxonomy
    params.update(extra)
    r = requests.get(NPI_API, params=params, headers=UA, timeout=TIMEOUT)
    if r.status_code != 200:
        raise ProviderError(502, "The provider registry is not responding. Try again in a minute.")
    data = r.json()
    errors = data.get("Errors") if isinstance(data, dict) else None
    if errors:
        raise ProviderError(502, str(errors[0].get("description") or "The provider registry rejected the search."))
    rows = parse_npi_response(data)
    return rows if by_name else filter_by_specialty(rows, sp)


def _parallel(jobs: List[tuple]) -> List[List[dict]]:
    if not jobs:
        return []
    with ThreadPoolExecutor(max_workers=min(12, len(jobs))) as ex:
        return list(ex.map(lambda j: _npi_query(*j), jobs))


def search(kind: str, specialty_key: str, zip_code: str = "", city: str = "", state: str = "",
           lat: Optional[float] = None, lon: Optional[float] = None, last: str = "", first: str = "") -> dict:
    """ZIP / near / city / name search, ranked by distance. Returns {origin, results}."""
    fixed = KINDS.get(kind, None)
    if kind not in KINDS:
        raise ProviderError(400, "kind must be doctors, pharmacy or urgent")
    sp = fixed or specialty_by_key(specialty_key)
    table = zip_table()
    origin: Optional[dict] = None

    if last.strip():
        clean_last = re.sub(r"[^A-Za-z' -]", "", last.strip())
        if len(clean_last) < 2:
            raise ProviderError(400, "Enter at least two letters of the last name.")
        params = {"last_name": f"{clean_last}*"}
        clean_first = re.sub(r"[^A-Za-z' -]", "", (first or "").strip())
        if len(clean_first) >= 2:
            params["first_name"] = f"{clean_first}*"
        if re.fullmatch(r"[A-Za-z]{2}", state.strip()):
            params["state"] = state.strip().upper()
        typed = clean_last.lower()
        rows = [d for d in _npi_query(SPECIALTIES[0], params, by_name=True) if d["last"].lower().startswith(typed)]
        rows.sort(key=lambda d: (d["last"], d["name"]))
        return {"origin": None, "results": rows[:MAX_RESULTS]}

    if lat is not None and lon is not None:
        z = nearest_zip(table, lat, lon)
        if not z or distance_miles(lat, lon, z["lat"], z["lon"]) > MAX_NEAREST_ZIP_MILES:
            raise ProviderError(400, "That location is outside the US. Search by ZIP or city instead.")
        origin = {"lat": lat, "lon": lon, "label": f"{z['city']}, {z['state']}", "zip": z["zip"]}
        zip_code = z["zip"]
    elif city.strip():
        hit = find_city(table, city, state)
        if not hit:
            raise ProviderError(400, "Pick a city from the list.")
        origin = {"lat": hit["lat"], "lon": hit["lon"], "label": f"{hit['city']}, {hit['state']}", "zip": ""}
        codes = [r["zip"] for r in nearby_zips(table, hit["lat"], hit["lon"])]
        jobs = [(sp, {"postal_code": f"{c}*"}, False) for c in codes]
        jobs.append((sp, {"city": hit["city"], "state": hit["state"]}, False))
        if sp.name_hint:
            jobs.append((sp, {"organization_name": sp.name_hint, "city": hit["city"], "state": hit["state"]}, True))
        rows = rank_by_distance(merge_results(_parallel(jobs)), origin, table)
        return {"origin": origin, "results": rows[:MAX_RESULTS]}

    zip_code = zip_code.strip()
    if not re.fullmatch(r"\d{5}", zip_code):
        raise ProviderError(400, "Enter a 5-digit ZIP code.")
    z = table.by_zip.get(zip_code)
    if z and origin is None:
        origin = {"lat": z["lat"], "lon": z["lon"], "label": f"{z['city']}, {z['state']} {z['zip']}", "zip": z["zip"]}
    codes = [r["zip"] for r in nearby_zips(table, origin["lat"], origin["lon"])] if origin else []
    if zip_code not in codes:
        codes.insert(0, zip_code)
    jobs = [(sp, {"postal_code": f"{c}*"}, False) for c in codes]
    if not z:
        jobs.append((sp, {"postal_code": f"{zip_code[:3]}*"}, False))
    if sp.name_hint and z:
        jobs.append((sp, {"organization_name": sp.name_hint, "city": z["city"], "state": z["state"]}, True))
    rows = rank_by_distance(merge_results(_parallel(jobs)), origin, table)
    return {"origin": origin, "results": rows[:MAX_RESULTS]}


def lookup(npi: str) -> Optional[dict]:
    """One registry record by NPI, or None."""
    if not re.fullmatch(r"\d{10}", npi):
        return None
    r = requests.get(NPI_API, params={"version": "2.1", "number": npi}, headers=UA, timeout=TIMEOUT)
    if r.status_code != 200:
        raise ProviderError(502, "The provider registry is not responding. Try again in a minute.")
    rows = parse_npi_response(r.json())
    return rows[0] if rows else None


# ---- Cache table -----------------------------------------------------------------------

def _engine():
    if not database.db_engine:
        try:
            database.connect_to_database()
        except Exception:  # pragma: no cover - no DB in some test setups
            return None
    return database.db_engine


def addr_key(i: dict) -> str:
    """Hash of the address a position was geocoded from; a cached pin is only reused for it."""
    raw = " ".join(re.sub(r"\s+", " ", str(i.get(k) or "").strip().upper()) for k in ("address", "city", "state", "zip"))
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def cache_get(npis: List[str]) -> Dict[str, dict]:
    eng = _engine()
    if not eng or not npis:
        return {}
    try:
        with eng.connect() as conn:
            rows = conn.execute(
                text("SELECT npi, lat, lon, geocoded_at, cms, cms_at, google, google_at, addr_hash FROM provider_cache WHERE npi = ANY(:npis)"),
                {"npis": list(npis)},
            ).fetchall()
        return {r[0]: {"lat": r[1], "lon": r[2], "geocoded_at": r[3], "cms": r[4], "cms_at": r[5], "google": r[6], "google_at": r[7], "addr_hash": r[8]} for r in rows}
    except Exception as e:  # cache is an optimisation, never a failure
        logger.warning("provider_cache read failed: %s", e)
        return {}


def cache_put(npi: str, **fields: Any) -> None:
    """Upsert the given columns for one provider (lat/lon, cms, google)."""
    eng = _engine()
    if not eng or not fields:
        return
    cols = {k: (json.dumps(v) if k in ("cms", "google") and v is not None else v) for k, v in fields.items()}
    sets = ", ".join(f"{k} = EXCLUDED.{k}" for k in cols)
    casts = ", ".join(f"CAST(:{k} AS jsonb)" if k in ("cms", "google") else f":{k}" for k in cols)
    try:
        with eng.begin() as conn:
            conn.execute(
                text(f"INSERT INTO provider_cache (npi, {', '.join(cols)}, updated_at) VALUES (:npi, {casts}, now()) "
                     f"ON CONFLICT (npi) DO UPDATE SET {sets}, updated_at = now()"),
                {"npi": npi, **cols},
            )
    except Exception as e:
        logger.warning("provider_cache write failed: %s", e)


def _fresh(stamp: Optional[datetime]) -> bool:
    if not stamp:
        return False
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - stamp < timedelta(days=CACHE_DAYS)


# ---- Census geocoding --------------------------------------------------------------------

def parse_census_batch(text_csv: str) -> Dict[str, dict]:
    """Batch response CSV → {id: {lat, lon}} for the matched rows."""
    out: Dict[str, dict] = {}
    for row in csv.reader(io.StringIO(text_csv)):
        if len(row) < 6 or row[2] != "Match":
            continue
        try:
            lon_s, lat_s = row[5].split(",")
            out[row[0]] = {"lat": float(lat_s), "lon": float(lon_s)}
        except ValueError:
            continue
    return out


def geocode_batch(items: List[dict]) -> Dict[str, dict]:
    """items: [{npi, address, city, state, zip}] → {npi: {lat, lon, approx}} using the cache, the
    Census batch geocoder for the rest, and the ZIP centroid (approx) when nothing matches."""
    items = items[:GEOCODE_BATCH_MAX]
    cached = cache_get([i["npi"] for i in items])
    out: Dict[str, dict] = {}
    todo = []
    for i in items:
        c = cached.get(i["npi"])
        if c and c.get("lat") is not None and c.get("addr_hash") == addr_key(i):
            out[i["npi"]] = {"lat": c["lat"], "lon": c["lon"], "approx": False}
        else:
            todo.append(i)
    if todo:
        buf = io.StringIO()
        w = csv.writer(buf)
        for i in todo:
            w.writerow([i["npi"], i.get("address", ""), i.get("city", ""), i.get("state", ""), i.get("zip", "")])
        try:
            r = requests.post(
                CENSUS_BATCH,
                files={"addressFile": ("addresses.csv", buf.getvalue(), "text/csv")},
                data={"benchmark": "Public_AR_Current"},
                headers={"User-Agent": UA["User-Agent"]},
                timeout=60,
            )
            found = parse_census_batch(r.text) if r.status_code == 200 else {}
        except Exception as e:
            logger.warning("census batch geocode failed: %s", e)
            found = {}
        table = zip_table()
        for i in todo:
            hit = found.get(i["npi"])
            if hit:
                out[i["npi"]] = {**hit, "approx": False}
                cache_put(i["npi"], lat=hit["lat"], lon=hit["lon"], geocoded_at=datetime.now(timezone.utc), addr_hash=addr_key(i))
            else:
                z = table.by_zip.get(_short_zip(i.get("zip", "")))
                if z:
                    out[i["npi"]] = {"lat": z["lat"], "lon": z["lon"], "approx": True}
    return out


# ---- CMS Doctors and Clinicians -----------------------------------------------------------

def _cms_rows(dataset: str, prop: str, value: str, limit: int = 5) -> List[dict]:
    params = {"conditions[0][property]": prop, "conditions[0][value]": value, "conditions[0][operator]": "=",
              "limit": str(limit), "count": "false", "schema": "false"}
    try:
        r = requests.get(CMS_QUERY.format(dataset=dataset), params=params, headers=UA, timeout=CMS_TIMEOUT)
    except Exception as e:
        raise UpstreamError(f"cms {dataset}: {e}") from e
    if r.status_code != 200:
        raise UpstreamError(f"cms {dataset}: HTTP {r.status_code}")
    data = r.json()
    return data.get("results") or [] if isinstance(data, dict) else []


def shape_cms(clinician_rows: List[dict], hospitals: List[str], practice_zip: str = "") -> Optional[dict]:
    """Pick the row for the practice ZIP (else the first) and keep what matters."""
    if not clinician_rows:
        return None
    row = next((r for r in clinician_rows if _short_zip(r.get("zip_code", "")) == practice_zip), clinician_rows[0])
    grad = re.sub(r"\D", "", str(row.get("grd_yr") or ""))
    school = _title(str(row.get("med_sch") or ""))
    if school.upper() == "OTHER":
        school = ""
    secondary = [_title(s.strip()) for s in str(row.get("sec_spec_all") or "").split(",") if s.strip()]
    return {
        "primary_specialty": _title(str(row.get("pri_spec") or "")),
        "secondary_specialties": secondary,
        "medical_school": school,
        "graduation_year": int(grad) if grad else None,
        "years_in_practice": (datetime.now().year - int(grad)) if grad else None,
        "medicare": str(row.get("ind_assgn") or "").upper() == "Y",
        "telehealth": str(row.get("telehlth") or "").upper() == "Y",
        "group_name": _title(str(row.get("facility_name") or "")),
        "group_size": int(row["num_org_mem"]) if str(row.get("num_org_mem") or "").isdigit() else None,
        "hospitals": hospitals,
    }


def cms_details(npi: str, practice_zip: str = "") -> Optional[dict]:
    """None when CMS has no record for this NPI; raises UpstreamError when CMS is unreachable."""
    try:
        with ThreadPoolExecutor(max_workers=2) as ex:
            rows_f = ex.submit(_cms_rows, CMS_CLINICIANS, "npi", npi, 10)
            aff_f = ex.submit(_cms_rows, CMS_AFFILIATIONS, "npi", npi, 5)
            rows, affiliations = rows_f.result(), aff_f.result()
        if not rows:
            return None
        ccns = [a.get("facility_affiliations_certification_number") for a in affiliations
                if a.get("facility_type") == "Hospital" and a.get("facility_affiliations_certification_number")][:3]
        hospitals = []
        if ccns:
            with ThreadPoolExecutor(max_workers=len(ccns)) as ex:
                for h in ex.map(lambda ccn: _cms_rows(CMS_HOSPITALS, "facility_id", ccn, 1), ccns):
                    if h and h[0].get("facility_name"):
                        hospitals.append(_title(str(h[0]["facility_name"])))
        return shape_cms(rows, hospitals, practice_zip)
    except UpstreamError:
        raise
    except Exception as e:
        raise UpstreamError(f"cms lookup failed for {npi}: {e}") from e


# ---- Google Places (optional) ---------------------------------------------------------------

def google_key() -> str:
    return os.getenv("GOOGLE_PLACES_KEY", "").strip()


def shape_place(place: dict) -> dict:
    hours = place.get("regularOpeningHours") or {}
    loc = place.get("location") or {}
    return {
        "place_id": place.get("id"),
        "name": (place.get("displayName") or {}).get("text") or "",
        "address": place.get("formattedAddress") or "",
        "rating": place.get("rating"),
        "ratings_count": place.get("userRatingCount"),
        "website": place.get("websiteUri") or "",
        "phone": place.get("nationalPhoneNumber") or "",
        "maps_url": place.get("googleMapsUri") or "",
        "open_now": hours.get("openNow"),
        "hours": hours.get("weekdayDescriptions") or [],
        "lat": loc.get("latitude"),
        "lon": loc.get("longitude"),
        "status": place.get("businessStatus") or "",
    }


def google_details(provider: dict, near: Optional[dict] = None) -> Optional[dict]:
    """Ids-only text search (free tier) then one place-details call. None without a key or
    without a match (cacheable); raises UpstreamError when Google does not answer properly."""
    key = google_key()
    if not key:
        return None
    query = " ".join(x for x in (provider.get("name"), provider.get("credential") if not provider.get("organisation") else "",
                                  provider.get("address"), provider.get("city"), provider.get("state"), provider.get("zip")) if x)
    body: dict = {"textQuery": query, "maxResultCount": 1}
    if near and near.get("lat") is not None:
        body["locationBias"] = {"circle": {"center": {"latitude": near["lat"], "longitude": near["lon"]}, "radius": 3000.0}}
    try:
        r = requests.post(PLACES_SEARCH, json=body, timeout=TIMEOUT,
                          headers={"X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.id", "Content-Type": "application/json"})
        if r.status_code != 200:
            raise UpstreamError(f"places search HTTP {r.status_code}: {r.text[:160]}")
        places = r.json().get("places") or []
        if not places:
            return None
        pid = places[0]["id"]
        d = requests.get(PLACES_DETAILS.format(place_id=pid), timeout=TIMEOUT,
                         headers={"X-Goog-Api-Key": key, "X-Goog-FieldMask": PLACES_DETAIL_FIELDS})
        if d.status_code != 200:
            raise UpstreamError(f"places details HTTP {d.status_code}: {d.text[:160]}")
        return shape_place(d.json())
    except UpstreamError:
        raise
    except Exception as e:
        raise UpstreamError(f"places lookup failed: {e}") from e


# ---- Details -----------------------------------------------------------------------------------

def _geo_for(p: dict, cached: dict) -> Optional[dict]:
    if cached.get("lat") is not None and cached.get("addr_hash") == addr_key(p):
        return {"lat": cached["lat"], "lon": cached["lon"], "approx": False}
    return geocode_batch([{k: p[k] for k in ("npi", "address", "city", "state", "zip")}]).get(p["npi"])


def details(npi: str) -> Optional[dict]:
    """The registry record, its map position, and any CMS/Google details already cached.
    Answers in about a second; `extras()` fetches what is missing."""
    p = lookup(npi)
    if not p:
        return None
    c = cache_get([npi]).get(npi, {})
    geo = _geo_for(p, c)
    cms = c.get("cms") if _fresh(c.get("cms_at")) else None
    google = c.get("google") if (google_key() and _fresh(c.get("google_at"))) else None
    pending = (not p["organisation"] and not _fresh(c.get("cms_at"))) or (bool(google_key()) and not _fresh(c.get("google_at")))
    return {"provider": {**p, "lat": (geo or {}).get("lat"), "lon": (geo or {}).get("lon")}, "cms": cms, "google": google,
            "extras_pending": pending, "sources": {"registry": True, "cms": cms is not None, "google": google is not None}}


_inflight: Dict[str, threading.Lock] = {}
_inflight_guard = threading.Lock()


def _npi_lock(npi: str) -> threading.Lock:
    """One lock per NPI so concurrent requests for the same uncached provider fetch once."""
    with _inflight_guard:
        if len(_inflight) > 5000:
            _inflight.clear()
        return _inflight.setdefault(npi, threading.Lock())


def extras(npi: str) -> Optional[dict]:
    """CMS clinician details and Google Places details, fetched (slow, 5-15 s the first time)
    or served from the 30-day cache. A source that fails to answer is retried next time,
    never cached as "no record"."""
    p = lookup(npi)
    if not p:
        return None
    with _npi_lock(npi):
        c = cache_get([npi]).get(npi, {})  # re-read under the lock: a waiter sees the fresh write
        geo = _geo_for(p, c)

        if _fresh(c.get("cms_at")):
            cms = c.get("cms")
        elif p["organisation"]:
            cms = None
        else:
            try:
                cms = cms_details(npi, p["zip"])
                cache_put(npi, cms=cms, cms_at=datetime.now(timezone.utc))
            except UpstreamError as e:
                logger.warning("%s", e)
                cms = c.get("cms")  # stale or None, not recorded as fresh

        if not google_key():
            google = None
        elif _fresh(c.get("google_at")):
            google = c.get("google")
        else:
            try:
                google = google_details(p, geo)
                cache_put(npi, google=google, google_at=datetime.now(timezone.utc))
            except UpstreamError as e:
                logger.warning("%s", e)
                google = c.get("google")
    return {"cms": cms, "google": google, "sources": {"cms": cms is not None, "google": google is not None}}
