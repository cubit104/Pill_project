"""IV drugs importer: FDA's list of intravenous products -> one row per drug in public.iv_drugs.

Flow
----
1. openFDA NDC directory: every finished prescription product with route INTRAVENOUS (~6,900).
2. RxNorm: each FDA ingredient name (VANCOMYCIN HYDROCHLORIDE) -> its ingredient (vancomycin), so
   salts, generics, brands and biosimilars of one drug land in one group.
3. Per drug, rank its DailyMed labels and keep ONE (see ``rank_labels``); the rest stay as alternates.
4. Upsert by ingredient_key. New rows arrive unpublished. Rows a reviewer locked keep their label,
   a label already in use is kept while FDA still lists it, and nothing is ever deleted.

The label text is not stored here: pages read it through the medication_guide cache by spl_set_id,
exactly like pill pages.
"""

from __future__ import annotations

import csv
import json
import logging
import os
import re
import tempfile
import threading
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from typing import Any, Dict, Iterable, List, Optional, Tuple

import httpx
from sqlalchemy import text

logger = logging.getLogger(__name__)

OPENFDA_NDC_URL = "https://api.fda.gov/drug/ndc.json"
RXNORM_URL = "https://rxnav.nlm.nih.gov/REST"
DAILYMED_SPLS_URL = "https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json"
IV_SEARCH = 'route:"INTRAVENOUS" AND finished:true AND product_type:"HUMAN PRESCRIPTION DRUG"'
USER_AGENT = "Mozilla/5.0 (PillSeek IV import)"
DEFAULT_CACHE_DIR = os.path.join(tempfile.gettempdir(), "pillseek_iv_import")
MAX_ALTERNATES = 5

# A drug premixed in one of these is still that drug, so they never form part of the drug's identity.
CARRIERS = {"glucose", "sodium chloride", "water"}
AMINO_ACIDS = {
    "alanine", "arginine", "glycine", "histidine", "isoleucine", "leucine", "lysine", "methionine",
    "phenylalanine", "proline", "serine", "threonine", "tryptophan", "tyrosine", "valine",
    "aspartic acid", "glutamic acid", "cysteine", "taurine", "ornithine",
}  # fmt: skip
LIPIDS = {
    "soybean oil", "olive oil", "fish oils", "medium chain triglycerides", "egg phospholipids", "glycerin",
    "safflower oil",
}  # fmt: skip
ELECTROLYTES = {
    "potassium chloride", "sodium lactate", "calcium chloride", "magnesium chloride", "sodium acetate",
    "sodium gluconate", "potassium phosphate", "sodium phosphate", "potassium acetate", "magnesium sulfate",
    "calcium gluconate", "sodium bicarbonate", "sodium citrate", "citric acid", "lactate", "magnesium acetate",
}  # fmt: skip
IMAGING_NAME_RE = re.compile(
    r"technetium|tc[- ]?99|\bf[- ]?18\b|gallium|indium|\biodine\b|\bi[- ]?1[23][135]\b|rubidium|thallous|thallium"
    r"|n[- ]?13|c[- ]?11|lutetium|radium|samarium|strontium|yttrium|copper cu|zirconium|fluciclovine|flutemetamol"
    r"|florbet|flortaucipir|fludeoxy|piflufolastat|^gado|gadolinium|iohexol|iodixanol|iopamidol|ioversol|iopromide"
    r"|iomeprol|perflutren|sulfur hexafluoride|fluorescein|indocyanine|isosulfan|methylene blue dye",
    re.I,
)
IMAGING_CLASS_RE = re.compile(r"radioactive|contrast agent|diagnostic", re.I)
# tracer kits often have no pharm class and an ingredient RxNorm names chemically, so the product name is checked too
IMAGING_PRODUCT_RE = re.compile(
    r"technetium|tc[- ]?99|\bkit for the preparation\b|sestamibi|tetrofosmin|mertiatide|medronate|exametazime|bicisate"
    r"|pentetate|oxidronate|succimer|tilmanocept|mebrofenin|sulfur colloid|pyrophosphate|macroaggregated|iobenguane"
    r"|\b(f|ga|in|lu|cu|zr|i)[- ]?(18|68|111|177|64|89|123|124|125|131)\b",
    re.I,
)
BLOOD_SOLUTION_RE = re.compile(r"anticoagulant|\bas-[1357]\b|\bcpda?\b|additive solution|apheresis", re.I)
NEURAXIAL_ROUTES = {"EPIDURAL", "INTRATHECAL"}
# checked in this order: "100 mL in 1 BAG" inside a carton is a bag, not a carton
CONTAINERS = ("vial", "ampule", "syringe", "cartridge", "bag", "bottle")
CONTAINER_WORDS = {"bag": ("BAG", "CONTAINER")}

LABEL_TIERS = {0: "brand", 1: "authorized_generic", 2: "generic", 3: "unapproved"}


# ---------------------------------------------------------------------------
# Small caches on disk: the three public APIs are slow and the answers change rarely
# ---------------------------------------------------------------------------


class DiskCache:
    def __init__(self, directory: str, refresh: bool = False):
        self.directory = directory
        self.refresh = refresh
        os.makedirs(directory, exist_ok=True)

    def load(self, name: str) -> Any:
        path = os.path.join(self.directory, name)
        if self.refresh or not os.path.exists(path):
            return None
        with open(path, encoding="utf-8") as f:
            return json.load(f)

    def save(self, name: str, data: Any) -> None:
        with open(os.path.join(self.directory, name), "w", encoding="utf-8") as f:
            json.dump(data, f)


def _get_json(client: httpx.Client, url: str, params: Optional[Dict] = None, tries: int = 4) -> Optional[Dict]:
    for attempt in range(tries):
        try:
            response = client.get(url, params=params)
            if response.status_code == 404:
                return None
            if response.status_code == 200:
                return response.json()
        except (httpx.HTTPError, ValueError):
            pass
        time.sleep(1.5 * (attempt + 1))
    return None


# ---------------------------------------------------------------------------
# 1. Products
# ---------------------------------------------------------------------------


def _slim_product(raw: Dict) -> Dict:
    openfda = raw.get("openfda") or {}
    return {
        "product_ndc": raw.get("product_ndc") or "",
        "generic_name": raw.get("generic_name") or "",
        "brand_name": raw.get("brand_name") or "",
        "labeler": raw.get("labeler_name") or "",
        "ingredients": [
            {"name": (a.get("name") or "").strip(), "strength": (a.get("strength") or "").strip()}
            for a in raw.get("active_ingredients") or []
        ],
        "dosage_form": raw.get("dosage_form") or "",
        "route": raw.get("route") or [],
        "marketing_category": raw.get("marketing_category") or "",
        "application_number": raw.get("application_number") or "",
        "listing_expiration_date": raw.get("listing_expiration_date") or "",
        "pharm_class": raw.get("pharm_class") or [],
        "dea_schedule": raw.get("dea_schedule") or "",
        "packaging": [p.get("description") or "" for p in raw.get("packaging") or []],
        "setids": openfda.get("spl_set_id") or [],
        "original_packager": bool((openfda.get("is_original_packager") or [False])[0]),
    }


def fetch_products(client: httpx.Client, cache: DiskCache) -> List[Dict]:
    cached = cache.load("ndc_iv_products.json")
    if cached:
        return cached
    products: List[Dict] = []
    skip = 0
    while True:
        page = _get_json(client, OPENFDA_NDC_URL, {"search": IV_SEARCH, "limit": 1000, "skip": skip})
        if not page or not page.get("results"):
            break
        products.extend(_slim_product(r) for r in page["results"])
        total = page["meta"]["results"]["total"]
        skip += 1000
        logger.info("openFDA: %d / %d products", len(products), total)
        if skip >= total:
            break
    if not products:
        raise RuntimeError("openFDA returned no IV products")
    cache.save("ndc_iv_products.json", products)
    return products


# ---------------------------------------------------------------------------
# 2. FDA ingredient name -> RxNorm ingredient
# ---------------------------------------------------------------------------


def _resolve_ingredient(client: httpx.Client, name: str) -> List[List[str]]:
    """'VANCOMYCIN HYDROCHLORIDE' -> [['11124', 'vancomycin']]; [] when RxNorm does not know the name."""
    found = _get_json(client, f"{RXNORM_URL}/rxcui.json", {"search": 2, "name": name}) or {}
    ids = (found.get("idGroup") or {}).get("rxnormId") or []
    if not ids:
        approx = _get_json(client, f"{RXNORM_URL}/approximateTerm.json", {"maxEntries": 1, "term": name}) or {}
        candidates = (approx.get("approximateGroup") or {}).get("candidate") or []
        # only a near-perfect approximate hit is trusted
        ids = [c["rxcui"] for c in candidates if float(c.get("score") or 0) >= 9 and c.get("rxcui")][:1]
    for rxcui in ids[:1]:
        related = _get_json(client, f"{RXNORM_URL}/rxcui/{rxcui}/related.json", {"tty": "IN"}) or {}
        ingredients = [
            [concept["rxcui"], concept["name"]]
            for group in (related.get("relatedGroup") or {}).get("conceptGroup") or []
            for concept in group.get("conceptProperties") or []
        ]
        if ingredients:
            return ingredients
    return []


def resolve_ingredients(client: httpx.Client, names: Iterable[str], cache: DiskCache) -> Dict[str, List[List[str]]]:
    resolved: Dict[str, List[List[str]]] = cache.load("rxnorm_in.json") or {}
    todo = [n for n in names if n not in resolved]
    logger.info("RxNorm: %d ingredient names to resolve (%d cached)", len(todo), len(resolved))
    lock = threading.Lock()

    def work(name: str) -> None:
        result = _resolve_ingredient(client, name)
        with lock:
            resolved[name] = result

    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(work, todo))
    cache.save("rxnorm_in.json", resolved)
    return resolved


# ---------------------------------------------------------------------------
# 3. Group products into drugs
# ---------------------------------------------------------------------------


def group_products(products: List[Dict], rx: Dict[str, List[List[str]]]) -> Tuple[Dict[str, List[Dict]], Counter]:
    groups: Dict[str, List[Dict]] = defaultdict(list)
    skipped: Counter = Counter()
    for product in products:
        if product["dosage_form"].upper().startswith("KIT"):
            skipped["kit"] += 1  # drug + syringe + swabs: not a reference label
            continue
        if not product["setids"]:
            skipped["no label id"] += 1
            continue
        ingredients: Dict[str, str] = {}
        for item in product["ingredients"]:
            hits = rx.get(item["name"]) or []
            if not hits and item["name"]:
                ingredients["name:" + item["name"].lower()] = item["name"].lower()
                product["_unresolved"] = True
            for rxcui, name in hits:
                ingredients[rxcui] = name
        if not ingredients:
            skipped["no ingredient"] += 1
            continue
        active = {k: v for k, v in ingredients.items() if v not in CARRIERS} or ingredients
        product["_in_names"] = sorted(active.values())
        key = "+".join(sorted(active, key=lambda k: active[k]))
        groups[key].append(product)
    return groups, skipped


def merge_same_name(groups: Dict[str, List[Dict]]) -> Dict[str, List[Dict]]:
    """RxNorm sometimes has two ingredients for one drug (sodium tetradecyl sulfate and its 'hydrogen
    sulfate ester'). Groups that end up with the same display name are one drug: the smaller joins the larger."""
    by_name: Dict[str, List[str]] = defaultdict(list)
    for key, plist in groups.items():
        by_name[display_name(plist).lower()].append(key)
    for keys in by_name.values():
        keys.sort(key=lambda k: (-len(groups[k]), k))
        for other in keys[1:]:
            for product in groups[other]:
                product["_in_names"] = groups[keys[0]][0]["_in_names"]
            groups[keys[0]].extend(groups.pop(other))
    return groups


def suggest_exclusion(in_names: List[str], pharm_classes: Iterable[str], product_names: Iterable[str] = ()) -> str:
    """Why this group is not a drug page ('' = keep it)."""
    names = set(in_names)
    product_names = list(product_names)
    if (
        any(IMAGING_NAME_RE.search(n) for n in names)
        or any(IMAGING_CLASS_RE.search(c) for c in pharm_classes)
        or any(IMAGING_PRODUCT_RE.search(n) for n in product_names)
    ):
        return "imaging / contrast / radiopharmaceutical"
    if product_names and all(BLOOD_SOLUTION_RE.search(n) for n in product_names):
        return "blood collection / apheresis solution"
    if names <= CARRIERS:
        return "plain IV fluid"
    if names <= (AMINO_ACIDS | LIPIDS):
        return "parenteral nutrition component"
    if len(names) >= 2 and names <= (CARRIERS | AMINO_ACIDS | LIPIDS | ELECTROLYTES):
        return "fluid / electrolyte / nutrition mixture"
    if len(names) >= 4:
        return "multi-ingredient mixture"
    return ""


# ---------------------------------------------------------------------------
# 4. One label per drug
# ---------------------------------------------------------------------------


def is_true_brand(product: Dict, in_names: List[str]) -> bool:
    """A real brand name (Zosyn), not the generic name printed in the brand field."""
    brand = product["brand_name"].lower()
    if not brand or brand == product["generic_name"].lower():
        return False
    words = {n.split()[0] for n in in_names} | {i["name"].lower().split()[0] for i in product["ingredients"] if i["name"]}
    return not any(w in brand for w in words if len(w) > 3)


def label_tier(product: Dict, in_names: List[str]) -> int:
    """0 brand, 1 authorized generic, 2 generic, 3 unapproved.

    An NDA without a brand name ranks with generics on purpose: many are new single-strength
    presentations filed as 505(b)(2), and they used to beat the ordinary vial label.
    """
    category = product["marketing_category"].upper()
    if category in ("NDA", "BLA"):
        return 0 if is_true_brand(product, in_names) else 2
    if "AUTHORIZED GENERIC" in category:
        return 1
    if category == "ANDA":
        return 2
    return 3


def containers_of(product: Dict) -> set:
    found = set()
    for description in product["packaging"]:
        upper = description.upper()
        for container in CONTAINERS:
            if any(word in upper for word in CONTAINER_WORDS.get(container, (container.upper(),))):
                found.add(container)
    return found


def has_carrier(product: Dict) -> bool:
    names = [i["name"].lower() for i in product["ingredients"]]
    return len(names) > 1 and any(re.search(r"dextrose|sodium chloride|^water", n) for n in names)


def _coarse_form(product: Dict) -> str:
    # FDA has a dozen spellings of "powder vial" and of "liquid"
    return "powder" if "POWDER" in product["dosage_form"].upper() else "liquid"


def _application_number(product: Dict) -> int:
    digits = re.sub(r"\D", "", product["application_number"])
    return int(digits) if digits else 10**9


def strength_of(product: Dict) -> str:
    parts = [re.sub(r"/1$", "", i["strength"]) for i in product["ingredients"] if i["strength"]]
    return " / ".join(parts) or "?"


def form_label(product: Dict) -> str:
    """FDA's dozen spellings, as a reader would say them."""
    form = product["dosage_form"].upper()
    for word, label in (
        ("LIPOSOM", "Liposomal"),
        ("EMULSION", "Emulsion"),
        ("SUSPENSION", "Suspension"),
        ("POWDER", "Powder for solution"),
        ("CONCENTRATE", "Concentrate"),
    ):
        if word in form:
            return label
    return "Solution"


_TO_MG = {"mcg": 0.001, "ug": 0.001, "mg": 1.0, "g": 1000.0, "kg": 1_000_000.0}


def _strength_sort_key(strength: str) -> Tuple[int, float, str]:
    """Smallest dose first: 500 mg, 1 g, 1 g/200mL, 10 g. Units and odd strings go after weights."""
    match = re.match(r"\s*([\d.]+)\s*([a-zA-Z]+)", strength)
    if not match:
        return (2, 0.0, strength)
    try:
        amount = float(match.group(1))
    except ValueError:
        return (2, 0.0, strength)
    unit = match.group(2).lower()
    return (0, amount * _TO_MG[unit], strength) if unit in _TO_MG else (1, amount, strength)


def strengths_table(plist: List[Dict]) -> List[Dict]:
    makers: Dict[Tuple[str, str], set] = defaultdict(set)
    for product in plist:
        strength = strength_of(product)
        if re.search(r"\b(mc?g|g|kg)/(mc?g|g|kg)$", strength):
            continue  # bulk powder by weight (1025 mg/mg): a pharmacy ingredient, not a dose
        makers[(strength, form_label(product))].add(product["labeler"])
    rows = [{"strength": s, "form": f, "makers": len(m)} for (s, f), m in makers.items()]
    return sorted(rows, key=lambda r: (_strength_sort_key(r["strength"]), r["form"]))


def rank_labels(plist: List[Dict], today: str) -> List[Dict]:
    """Every label (setid) of one drug, best first.

    Order: still listed -> from the real maker, not a repackager -> IV product, not an epidural one
    -> the drug's usual form (powder vs liquid) -> a vial or ampule when the drug has any (bags say
    nothing about mixing) -> not premixed in a carrier -> brand before generic -> the oldest brand
    application (the original, e.g. Remicade before its biosimilars) -> covers the most strengths.
    Ties are broken later by the newest DailyMed date.
    """
    in_names = plist[0]["_in_names"]
    usual_form = Counter(_coarse_form(p) for p in plist).most_common(1)[0][0]
    drug_has_vials = any(containers_of(p) & {"vial", "ampule"} for p in plist)
    by_setid: Dict[str, List[Dict]] = defaultdict(list)
    for product in plist:
        for setid in product["setids"]:
            by_setid[setid].append(product)

    ranked = []
    for setid, products in by_setid.items():
        tier = min(label_tier(p, in_names) for p in products)
        containers = set().union(*(containers_of(p) for p in products))
        sort_key = (
            all(p["listing_expiration_date"] and p["listing_expiration_date"] < today for p in products),
            not any(p["original_packager"] for p in products),
            all(NEURAXIAL_ROUTES & set(p["route"]) for p in products),
            not any(_coarse_form(p) == usual_form for p in products),
            drug_has_vials and not (containers & {"vial", "ampule"}),
            all(has_carrier(p) for p in products),
            tier,
            min(_application_number(p) for p in products) if tier == 0 else 0,
            -len({(strength_of(p), p["dosage_form"]) for p in products}),
        )
        ranked.append({"setid": setid, "products": products, "tier": tier, "containers": containers, "key": sort_key})
    ranked.sort(key=lambda r: (r["key"], r["setid"]))
    return ranked


def fetch_label_meta(client: httpx.Client, setids: Iterable[str], cache: DiskCache) -> Dict[str, Dict]:
    meta: Dict[str, Dict] = cache.load("dailymed_meta.json") or {}
    todo = [s for s in setids if s not in meta]
    logger.info("DailyMed: %d labels to look up (%d cached)", len(todo), len(meta))
    lock = threading.Lock()

    def work(setid: str) -> None:
        data = _get_json(client, DAILYMED_SPLS_URL, {"setid": setid}) or {}
        row = (data.get("data") or [{}])[0]
        iso = ""
        try:
            iso = datetime.strptime(row.get("published_date") or "", "%b %d, %Y").strftime("%Y-%m-%d")
        except ValueError:
            pass
        with lock:
            meta[setid] = {"version": row.get("spl_version"), "date": iso}

    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(work, todo))
    cache.save("dailymed_meta.json", meta)
    return meta


# ---------------------------------------------------------------------------
# 5. Rows
# ---------------------------------------------------------------------------


def slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or "unknown"


def _clean_name(name: str) -> str:
    """'vasopressin (USP)' -> 'vasopressin', 'insulin aspart, human' -> 'insulin aspart'."""
    name = re.sub(r"\s*\(usp\)|,\s*usp\b|,\s*human\b", "", name, flags=re.I)
    return re.sub(r"\s+", " ", name).strip(" ,")


def _title(name: str) -> str:
    def cap(word: str) -> str:
        if any(c.isdigit() for c in word):
            return word
        # first letter of the word, and of each piece after "(" or "/": "(rabbit)" -> "(Rabbit)", "a/b" -> "A/B"
        return re.sub(r"(^|[(/])([a-z])", lambda m: m.group(1) + m.group(2).upper(), word.lower())

    return " ".join(cap(w) for w in name.split())


def display_name(plist: List[Dict]) -> str:
    """RxNorm's ingredient name, unless US labels say it better.

    US labels win when they call the drug something else (glycopyrronium -> glycopyrrolate) or when
    RxNorm's name is a chemical description with brackets or commas and the label's name is plain.
    """
    in_names = [_clean_name(n) for n in plist[0]["_in_names"]]
    if len(in_names) == 1:
        fda_names = [n for n, _ in Counter(_clean_name(p["generic_name"].lower()) for p in plist).most_common() if n]
        plain = [n for n in fda_names if not re.search(r"[(),]", n)]
        if re.search(r"[(),]", in_names[0]) and plain:
            return _title(plain[0])
        if fda_names and in_names[0].split()[0] not in fda_names[0]:
            return _title(fda_names[0])
    names = [_title(n) for n in in_names]
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def build_row(key: str, plist: List[Dict], ranked: List[Dict], meta: Dict[str, Dict], keep_setid: Optional[str] = None) -> Dict:
    in_names = plist[0]["_in_names"]
    best_key = ranked[0]["key"]
    tied = [r for r in ranked if r["key"] == best_key]
    tied.sort(key=lambda r: (-(int((meta.get(r["setid"], {}).get("date") or "0").replace("-", "") or 0)), r["setid"]))
    chosen = tied[0]
    if keep_setid:
        # a label already in use stays while FDA still lists it: no churn, no card thrown back to draft
        current = next((r for r in ranked if r["setid"] == keep_setid and not r["key"][0]), None)
        chosen = current or chosen
    lead = sorted(chosen["products"], key=lambda p: label_tier(p, in_names))[0]

    brands = {}
    for product in plist:
        if is_true_brand(product, in_names):
            name = product["brand_name"].strip()
            brands.setdefault(name.lower(), name.title() if name.isupper() else name)
    label_meta = meta.get(chosen["setid"]) or {}
    name = display_name(plist)
    return {
        "ingredient_key": key,
        "rxcuis": [k for k in key.split("+") if not k.startswith("name:")],
        "slug": slugify(" ".join(_clean_name(n) for n in in_names) if len(in_names) > 1 else name),
        "generic_name": name,
        "brand_names": sorted(brands.values(), key=str.lower),
        "drug_class": sorted({c.replace(" [EPC]", "") for p in plist for c in p["pharm_class"] if "[EPC]" in c}),
        "routes": sorted({r.title() for p in plist for r in p["route"]}),
        "dea_schedule": next((p["dea_schedule"] for p in plist if p["dea_schedule"]), None),
        "spl_set_id": chosen["setid"],
        "other_setids": [r["setid"] for r in ranked if r["setid"] != chosen["setid"]][:MAX_ALTERNATES],
        "label_type": LABEL_TIERS[chosen["tier"]],
        "label_brand": lead["brand_name"],
        "label_maker": lead["labeler"],
        "label_presentation": ", ".join(c for c in CONTAINERS if c in chosen["containers"]) or None,
        "application_number": lead["application_number"] or None,
        "label_version": label_meta.get("version"),
        "label_date": label_meta.get("date") or None,
        "strengths": strengths_table(plist),
        "product_count": len(plist),
        "maker_count": len({p["labeler"] for p in plist}),
        "excluded_because": suggest_exclusion(
            in_names,
            [c for p in plist for c in p["pharm_class"]],
            [f"{p['generic_name']} {p['brand_name']}" for p in plist],
        ),
        "tied_labels": len(tied),
    }


def read_decisions(path: Optional[str]) -> Dict[str, str]:
    """The reviewed spreadsheet: slug -> 'include' | 'exclude' (only rows where your_decision was filled)."""
    if not path:
        return {}
    with open(path, encoding="utf-8-sig", newline="") as f:
        return {
            row["slug"]: row["your_decision"].strip().lower()
            for row in csv.DictReader(f)
            if (row.get("your_decision") or "").strip().lower() in ("include", "exclude")
        }


# ---------------------------------------------------------------------------
# 6. Database
# ---------------------------------------------------------------------------

_LABEL_COLUMNS = (
    "spl_set_id", "label_type", "label_brand", "label_maker", "label_presentation", "application_number",
)  # fmt: skip
_ALWAYS_COLUMNS = (
    "rxcuis", "generic_name", "brand_names", "drug_class", "routes", "dea_schedule", "other_setids",
    "strengths", "product_count", "maker_count",
)  # fmt: skip


def _params(row: Dict) -> Dict:
    params = {k: row[k] for k in _LABEL_COLUMNS + _ALWAYS_COLUMNS + ("slug", "ingredient_key", "label_version", "label_date")}
    params["strengths"] = json.dumps(row["strengths"])
    return params


def load_existing(conn) -> Dict[str, Dict]:
    rows = conn.execute(
        text(
            """
            SELECT ingredient_key, slug, spl_set_id, setid_locked, card_status,
                   (NOT published AND card_status = 'none' AND deleted_at IS NULL) AS untouched
            FROM public.iv_drugs
            """
        )
    ).fetchall()
    return {
        r[0]: {"slug": r[1], "spl_set_id": r[2], "setid_locked": r[3], "card_status": r[4], "untouched": bool(r[5])}
        for r in rows
    }


def _free_slug(slug: str, taken: set) -> str:
    base, n = slug, 2
    while slug in taken:
        slug = f"{base}-{n}"
        n += 1
    taken.add(slug)
    return slug


def upsert_rows(
    conn, rows: List[Dict], existing: Dict[str, Dict], dry_run: bool, fix_unpublished: bool = False
) -> Counter:
    """``fix_unpublished`` is for before launch: a row nobody has seen yet (never published, no card)
    may still get a corrected slug, or be dropped when the importer now excludes it."""
    stats: Counter = Counter()
    taken_slugs = {e["slug"] for e in existing.values()}
    if fix_unpublished:
        produced = {row["ingredient_key"] for row in rows}
        for key, current in existing.items():
            if current["untouched"] and key not in produced:
                # e.g. two rows that are now recognised as one drug
                stats["removed (unpublished, no longer produced)"] += 1
                logger.info("%s: removed, the importer no longer produces this drug", current["slug"])
                taken_slugs.discard(current["slug"])
                if not dry_run:
                    # the slug is unique across removed rows too, so hand it back for the surviving row
                    conn.execute(
                        text(
                            "UPDATE public.iv_drugs SET deleted_at = now(), slug = slug || '-removed-' || left(id::text, 8) "
                            "WHERE ingredient_key = :k"
                        ),
                        {"k": key},
                    )
    for row in rows:
        current = existing.get(row["ingredient_key"])
        if current and fix_unpublished and current["untouched"]:
            if row["decision"] == "exclude":
                stats["removed (unpublished, now excluded)"] += 1
                logger.info("%s: removed, %s", current["slug"], row["excluded_because"] or "your decision")
                if not dry_run:
                    conn.execute(
                        text("UPDATE public.iv_drugs SET deleted_at = now() WHERE ingredient_key = :k"),
                        {"k": row["ingredient_key"]},
                    )
                continue
            if row["slug"] != current["slug"]:
                taken_slugs.discard(current["slug"])
                new_slug = _free_slug(row["slug"], taken_slugs)
                stats["slug corrected (unpublished)"] += 1
                logger.info("%s: slug -> %s", current["slug"], new_slug)
                if not dry_run:
                    conn.execute(
                        text("UPDATE public.iv_drugs SET slug = :slug WHERE ingredient_key = :k"),
                        {"slug": new_slug, "k": row["ingredient_key"]},
                    )
                current["slug"] = new_slug
        if current is None:
            row["slug"] = _free_slug(row["slug"], taken_slugs)
            stats["new"] += 1
            if not dry_run:
                conn.execute(
                    text(
                        """
                        INSERT INTO public.iv_drugs (
                            slug, ingredient_key, rxcuis, generic_name, brand_names, drug_class, routes, dea_schedule,
                            spl_set_id, other_setids, label_type, label_brand, label_maker, label_presentation,
                            application_number, label_version, label_date, strengths, product_count, maker_count,
                            source_refreshed_at
                        ) VALUES (
                            :slug, :ingredient_key, :rxcuis, :generic_name, :brand_names, :drug_class, :routes, :dea_schedule,
                            :spl_set_id, :other_setids, :label_type, :label_brand, :label_maker, :label_presentation,
                            :application_number, :label_version, CAST(:label_date AS date), CAST(:strengths AS jsonb),
                            :product_count, :maker_count, now()
                        )
                        """
                    ),
                    _params(row),
                )
            continue

        # the slug is a public URL: it never changes on a re-import
        label_changed = not current["setid_locked"] and current["spl_set_id"] != row["spl_set_id"]
        stats["label changed" if label_changed else "refreshed"] += 1
        if label_changed:
            logger.info("%s: label %s -> %s", current["slug"], current["spl_set_id"], row["spl_set_id"])
        if dry_run:
            continue
        sets = [f"{c} = :{c}" for c in _ALWAYS_COLUMNS if c != "strengths"] + ["strengths = CAST(:strengths AS jsonb)"]
        if label_changed:
            # a card made from the old label must be looked at again before anyone sees it
            sets.append("card_status = CASE WHEN card_status = 'approved' THEN 'draft' ELSE card_status END")
        if label_changed or row["spl_set_id"] == current["spl_set_id"]:
            # also describes a label a reviewer picked by hand in the admin (maker, version, date)
            sets += [f"{c} = :{c}" for c in _LABEL_COLUMNS]
            sets += ["label_version = :label_version", "label_date = CAST(:label_date AS date)"]
        conn.execute(
            text(f"UPDATE public.iv_drugs SET {', '.join(sets)}, source_refreshed_at = now() WHERE ingredient_key = :ingredient_key"),
            _params(row),
        )
    return stats


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def run_import(
    engine,
    dry_run: bool = True,
    cache_dir: str = DEFAULT_CACHE_DIR,
    refresh: bool = False,
    decisions_csv: Optional[str] = None,
    report_csv: Optional[str] = None,
    fix_unpublished: bool = False,
) -> Counter:
    cache = DiskCache(cache_dir, refresh=refresh)
    decisions = read_decisions(decisions_csv)
    today = date.today().strftime("%Y%m%d")

    with httpx.Client(timeout=40, headers={"User-Agent": USER_AGENT}, follow_redirects=True) as client:
        products = fetch_products(client, cache)
        rx = resolve_ingredients(client, sorted({i["name"] for p in products for i in p["ingredients"] if i["name"]}), cache)
        groups, skipped = group_products(products, rx)
        groups = merge_same_name(groups)
        logger.info("%d products -> %d drugs (skipped: %s)", len(products), len(groups), dict(skipped))

        ranked = {key: rank_labels(plist, today) for key, plist in groups.items()}
        tied = {r["setid"] for labels in ranked.values() for r in labels if r["key"] == labels[0]["key"]}
        with engine.connect() as conn:
            existing = load_existing(conn)
        in_use = {e["spl_set_id"] for e in existing.values()}
        meta = fetch_label_meta(client, sorted(tied | in_use), cache)

    rows = []
    for key, plist in groups.items():
        keep = (existing.get(key) or {}).get("spl_set_id")
        rows.append(build_row(key, plist, ranked[key], meta, keep_setid=keep))

    stats: Counter = Counter()
    wanted = []
    for row in rows:
        decision = decisions.get(row["slug"]) or ("exclude" if row["excluded_because"] else "include")
        row["decision"] = decision
        if decision == "include" or row["ingredient_key"] in existing:
            wanted.append(row)
        else:
            stats["excluded: " + (row["excluded_because"] or "your decision")] += 1

    if report_csv:
        columns = [c for c in rows[0] if c != "strengths"]
        with open(report_csv, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(sorted(wanted, key=lambda r: (-r["maker_count"], r["generic_name"])))

    with engine.begin() as conn:
        stats.update(upsert_rows(conn, wanted, existing, dry_run, fix_unpublished=fix_unpublished))
    stats["gone from FDA list (left untouched)"] = len(set(existing) - set(groups))
    return stats
