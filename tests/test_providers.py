"""Find a doctor (services/providers.py + routes/providers.py).

Network and database are mocked. Covers: registry parsing, the specialty
filter that trims the registry's loose word matching, ranking by distance,
the city live-fill, the Census batch CSV, the CMS and Google shaping, the
search fan-out, and the HTTP routes.
"""
import os
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")

from services import providers as p  # noqa: E402

TABLE = p.ZipTable([
    ["75074", "Plano", "TX", 33.03, -96.68],
    ["75075", "Plano", "TX", 33.02, -96.74],
    ["75093", "Plano", "TX", 33.04, -96.80],
    ["75082", "Richardson", "TX", 32.99, -96.67],
    ["50000", "Plano", "IA", 41.0, -93.0],
    ["94107", "San Francisco", "CA", 37.77, -122.39],
    ["94110", "San Francisco", "CA", 37.75, -122.42],
    ["94960", "San Anselmo", "CA", 37.97, -122.56],
    ["93638", "Madera", "CA", 36.96, -120.06],
])


def _npi(number, last="Raman", first="Anita", taxonomies=None, purpose="LOCATION", enum="NPI-1", org=""):
    return {
        "number": number,
        "enumeration_type": enum,
        "basic": {"first_name": first.upper(), "last_name": last.upper(), "credential": "M.D.", "gender": "F",
                  "enumeration_date": "2011-06-01", "organization_name": org},
        "addresses": [{"address_purpose": purpose, "address_1": "4100 W 15TH ST", "address_2": "STE 210", "city": "PLANO",
                       "state": "TX", "postal_code": "750931234", "telephone_number": "972-555-0100"}],
        "taxonomies": taxonomies or [{"desc": "Internal Medicine, Cardiovascular Disease", "state": "TX", "license": "K1234", "primary": True}],
    }


def test_parse_npi_response_shapes_rows():
    rows = p.parse_npi_response({"results": [_npi(1), _npi(1), _npi(2, purpose="MAILING", enum="NPI-2", org="HEART PLACE LLC")]})
    assert [r["npi"] for r in rows] == ["1", "2"]
    r = rows[0]
    assert r["name"] == "Anita Raman" and r["last"] == "Raman" and r["credential"] == "MD"
    assert r["address"] == "4100 W 15th St, Ste 210" and r["city"] == "Plano" and r["zip"] == "75093"
    assert r["specialty"] == "Internal Medicine, Cardiovascular Disease" and r["since"] == "2011"
    assert rows[1]["organisation"] is True and rows[1]["name"] == "Heart Place LLC" and rows[1]["last"] == ""
    assert p.parse_npi_response(None) == [] and p.parse_npi_response({"Errors": []}) == []
    dup = _npi(4)
    dup["addresses"][0].update({"address_1": "2520 AVENUE K, SUITE 600", "address_2": "SUITE 600"})
    assert p.parse_npi_response({"results": [dup]})[0]["address"] == "2520 Avenue K, Suite 600"


def test_specialty_filter_keeps_what_we_mean():
    psych = p.specialty_by_key("psychiatry")
    neuro = p.specialty_by_key("neurology")
    rows = [
        {**p.parse_npi_response({"results": [_npi(1, taxonomies=[{"desc": "Psychiatry & Neurology, Psychiatry", "primary": True}])]})[0]},
        {**p.parse_npi_response({"results": [_npi(2, taxonomies=[{"desc": "Psychiatry & Neurology, Neurology", "primary": True}])]})[0]},
        {**p.parse_npi_response({"results": [_npi(3, taxonomies=[{"desc": "Emergency Medicine", "primary": True},
                                                                   {"desc": "Psychiatry & Neurology, Psychiatry", "primary": False}])]})[0]},
    ]
    kept = p.filter_by_specialty(rows, psych)
    assert [r["npi"] for r in kept] == ["1", "3"]
    assert kept[1]["specialty"] == "Psychiatry & Neurology, Psychiatry"  # the matching one is shown, not Emergency Medicine
    assert [r["npi"] for r in p.filter_by_specialty(rows, neuro)] == ["2"]
    blank = {**rows[0], "npi": "9", "specialty": "", "taxonomies": []}
    assert p.filter_by_specialty([blank], psych) == []  # unknown specialty only on "All providers"
    assert [r["npi"] for r in p.filter_by_specialty([blank], p.specialty_by_key("all"))] == ["9"]
    onc = p.specialty_by_key("oncology")
    assert not onc.match.search("Pharmacist, Oncology") and onc.match.search("Internal Medicine, Medical Oncology")


def test_rank_by_distance_unknown_zips_go_last_and_far_ones_are_dropped():
    rows = [{"npi": "a", "zip": "75082"}, {"npi": "b", "zip": "00000"}, {"npi": "c", "zip": "75074"}, {"npi": "far", "zip": "94107"}]
    origin = {"lat": 33.03, "lon": -96.68}
    ranked = p.rank_by_distance(rows, origin, TABLE)
    assert [r["npi"] for r in ranked] == ["c", "a", "b"]  # San Francisco (mailing-address match) is not "near Plano"
    assert ranked[0]["distanceMiles"] == 0 and ranked[2]["distanceMiles"] is None


def test_geo_helpers():
    assert round(p.distance_miles(33.03, -96.68, 32.99, -96.67), 1) == 2.8
    assert p.nearest_zip(TABLE, 33.031, -96.681)["zip"] == "75074"
    assert [z["zip"] for z in p.nearby_zips(TABLE, 33.03, -96.68, limit=2)] == ["75074", "75082"]  # Richardson is nearer than west Plano
    assert p.find_city(TABLE, "plano", "tx")["zips"] == ["75074", "75075", "75093"]
    assert p.find_city(TABLE, "plano", "zz") is None


def test_suggest_cities_prefers_bigger_prefix_matches_and_reads_states():
    hits = p.suggest_cities(TABLE, "plan")
    assert [f"{c['city']}, {c['state']}" for c in hits][:2] == ["Plano, TX", "Plano, IA"]
    assert [c["city"] for c in p.suggest_cities(TABLE, "san")][:2] == ["San Francisco", "San Anselmo"]
    assert [c["state"] for c in p.suggest_cities(TABLE, "plano, tx")] == ["TX"]
    assert p.suggest_cities(TABLE, "san fr")[0]["city"] == "San Francisco"  # "fr" is not a state
    assert p.suggest_cities(TABLE, "p") == []


def test_parse_census_batch():
    csv_text = ('"1","4100 W 15TH ST, PLANO, TX, 75093","Match","Exact","4100 W 15TH ST, PLANO, TX, 75093","-96.80,33.04","1","L"\n'
                '"2","NOWHERE, TX","No_Match"\n'
                '"3","X","Match","Exact","X","bad","1","L"\n')
    assert p.parse_census_batch(csv_text) == {"1": {"lat": 33.04, "lon": -96.8}}


def test_geocode_batch_uses_cache_census_and_zip_fallback():
    census = MagicMock(status_code=200, text='"2","a","Match","Exact","a","-96.70,33.01","1","L"\n')
    cached_item = {"npi": "1", "address": "cached", "city": "", "state": "", "zip": ""}
    with patch.object(p, "cache_get", return_value={"1": {"lat": 1.0, "lon": 2.0, "addr_hash": p.addr_key(cached_item)}}), \
            patch.object(p, "cache_put") as put, patch.object(p, "zip_table", return_value=TABLE), \
            patch.object(p.requests, "post", return_value=census) as post:
        out = p.geocode_batch([
            {"npi": "1", "address": "cached", "city": "", "state": "", "zip": ""},
            {"npi": "2", "address": "4100 W 15th St", "city": "Plano", "state": "TX", "zip": "75093"},
            {"npi": "3", "address": "no match", "city": "Plano", "state": "TX", "zip": "75074"},
        ])
    assert out["1"] == {"lat": 1.0, "lon": 2.0, "approx": False}
    assert out["2"] == {"lat": 33.01, "lon": -96.7, "approx": False}
    assert out["3"] == {"lat": 33.03, "lon": -96.68, "approx": True}  # ZIP centroid, flagged
    post.assert_called_once()
    put.assert_called_once()
    assert put.call_args.args[0] == "2" and put.call_args.kwargs["addr_hash"] == p.addr_key({"address": "4100 W 15th St", "city": "Plano", "state": "TX", "zip": "75093"})


def test_cached_position_is_only_reused_for_the_same_address():
    item = {"npi": "1", "address": "4100 W 15th St", "city": "Plano", "state": "TX", "zip": "75093"}
    cached = {"1": {"lat": 1.0, "lon": 2.0, "addr_hash": p.addr_key({**item, "address": "999 Elsewhere Rd"})}}
    census = MagicMock(status_code=200, text="")
    with patch.object(p, "cache_get", return_value=cached), patch.object(p, "cache_put"), patch.object(p, "zip_table", return_value=TABLE), \
            patch.object(p.requests, "post", return_value=census) as post:
        out = p.geocode_batch([item])
    post.assert_called_once()  # the poisoned pin was not trusted; the real address was geocoded
    assert out["1"]["approx"] is True
    assert p.addr_key(item) == p.addr_key({**item, "address": " 4100  w 15th st "})


def test_shape_cms_picks_practice_zip_and_trims():
    rows = [
        {"zip_code": "752042833", "med_sch": "OTHER", "grd_yr": "1992", "pri_spec": "FAMILY PRACTICE", "sec_spec_all": "EMERGENCY MEDICINE",
         "telehlth": "", "facility_name": "INNOVATIVE EMERGENCY PHYSICIANS", "num_org_mem": "23", "ind_assgn": "Y"},
        {"zip_code": "750931234", "med_sch": "UT SOUTHWESTERN", "grd_yr": "2011", "pri_spec": "CARDIOVASCULAR DISEASE (CARDIOLOGY)",
         "sec_spec_all": "", "telehlth": "Y", "facility_name": "PLANO HEART ASSOCIATES", "num_org_mem": "12", "ind_assgn": "Y"},
    ]
    out = p.shape_cms(rows, ["Medical City Plano"], practice_zip="75093")
    assert out["medical_school"] == "Ut Southwestern" and out["graduation_year"] == 2011 and out["telehealth"] is True
    assert out["group_name"] == "Plano Heart Associates" and out["group_size"] == 12 and out["hospitals"] == ["Medical City Plano"]
    first = p.shape_cms(rows, [], practice_zip="00000")
    assert first["medical_school"] == "" and first["secondary_specialties"] == ["Emergency Medicine"] and first["medicare"] is True
    assert p.shape_cms([], []) is None


def test_shape_place():
    out = p.shape_place({"id": "abc", "displayName": {"text": "Plano Heart"}, "rating": 4.8, "userRatingCount": 126,
                         "regularOpeningHours": {"openNow": True, "weekdayDescriptions": ["Monday: 8 AM – 5 PM"]},
                         "websiteUri": "https://example.org", "location": {"latitude": 33.0, "longitude": -96.7}})
    assert out["place_id"] == "abc" and out["name"] == "Plano Heart" and out["rating"] == 4.8 and out["open_now"] is True
    assert out["hours"] == ["Monday: 8 AM – 5 PM"] and out["lat"] == 33.0 and out["phone"] == ""


def test_google_details_without_key_is_none(monkeypatch):
    monkeypatch.delenv("GOOGLE_PLACES_KEY", raising=False)
    assert p.google_details({"name": "x"}) is None


def test_google_details_two_calls(monkeypatch):
    monkeypatch.setenv("GOOGLE_PLACES_KEY", "k")
    search = MagicMock(status_code=200)
    search.json.return_value = {"places": [{"id": "pid"}]}
    detail = MagicMock(status_code=200)
    detail.json.return_value = {"id": "pid", "displayName": {"text": "Clinic"}, "rating": 4.5}
    with patch.object(p.requests, "post", return_value=search) as post, patch.object(p.requests, "get", return_value=detail) as get:
        out = p.google_details({"name": "Anita Raman", "credential": "MD", "address": "4100 W 15th St", "city": "Plano", "state": "TX", "zip": "75093"},
                               {"lat": 33.0, "lon": -96.7})
    assert out["rating"] == 4.5 and out["name"] == "Clinic"
    assert post.call_args.kwargs["headers"]["X-Goog-FieldMask"] == "places.id"  # ids-only search, the free tier
    assert "4100 W 15th St" in post.call_args.kwargs["json"]["textQuery"]
    assert get.call_args.args[0].endswith("/places/pid")


def test_near_me_outside_the_us_is_rejected():
    with patch.object(p, "zip_table", return_value=TABLE), patch.object(p, "_npi_query", return_value=[]):
        with pytest.raises(p.ProviderError):
            p.search("doctors", "family", lat=51.5, lon=-0.12)  # London
        out = p.search("doctors", "family", lat=33.03, lon=-96.68)
    assert out["origin"]["label"] == "Plano, TX"


def test_city_search_fans_out_around_the_centre():
    calls = []
    with patch.object(p, "zip_table", return_value=TABLE), patch.object(p, "_npi_query", side_effect=lambda sp, extra, by_name=False: calls.append(extra) or []):
        p.search("doctors", "cardiology", city="Plano", state="TX")
    assert {"city": "Plano", "state": "TX"} in calls
    assert {c.get("postal_code") for c in calls if "postal_code" in c} >= {"75074*", "75075*", "75093*"}


def test_extras_never_caches_an_upstream_failure(monkeypatch):
    monkeypatch.setenv("GOOGLE_PLACES_KEY", "k")
    prov = {"npi": "1234567890", "organisation": False, "zip": "75093", "address": "a", "city": "b", "state": "TX", "name": "x", "credential": "MD"}
    with patch.object(p, "lookup", return_value=prov), patch.object(p, "cache_get", return_value={}), \
            patch.object(p, "_geo_for", return_value=None), patch.object(p, "cache_put") as put, \
            patch.object(p, "cms_details", side_effect=p.UpstreamError("cms down")), \
            patch.object(p, "google_details", return_value=None):
        out = p.extras("1234567890")
    assert out["cms"] is None and out["google"] is None
    assert [c.kwargs.get("google_at") is not None for c in put.call_args_list] == [True]  # only the confirmed no-match was cached
    assert all("cms_at" not in c.kwargs for c in put.call_args_list)


def test_search_by_zip_fans_out_to_nearby_zips_and_ranks():
    calls = []

    def fake_query(sp, extra, by_name=False):
        calls.append(extra)
        code = extra.get("postal_code", "").rstrip("*")
        if extra.get("organization_name"):
            return []
        return [{"npi": f"n{code}", "name": "x", "last": "x", "zip": code, "taxonomies": [], "specialty": ""}]

    with patch.object(p, "zip_table", return_value=TABLE), patch.object(p, "_npi_query", side_effect=fake_query):
        out = p.search("doctors", "cardiology", zip_code="75075")
    zips_asked = {c["postal_code"] for c in calls if "postal_code" in c}
    assert zips_asked == {"75075*", "75074*", "75093*", "75082*"}
    assert out["origin"]["label"] == "Plano, TX 75075"
    assert [r["npi"] for r in out["results"]][0] == "n75075"
    assert out["results"][0]["distanceMiles"] == 0


def test_search_pharmacy_adds_name_query_and_validates():
    calls = []
    with patch.object(p, "zip_table", return_value=TABLE), patch.object(p, "_npi_query", side_effect=lambda sp, extra, by_name=False: calls.append((extra, by_name)) or []):
        p.search("pharmacy", "", zip_code="75074")
    assert any(by_name and extra.get("organization_name") == "*pharmacy*" for extra, by_name in calls)
    with pytest.raises(p.ProviderError):
        p.search("doctors", "family", zip_code="7507")
    with pytest.raises(p.ProviderError):
        p.search("doctors", "family", city="Nowhere", state="TX")
    with pytest.raises(p.ProviderError):
        p.search("doctors", "family", last="A")


def test_search_by_name_keeps_current_surname():
    rows = [{"npi": "1", "name": "Amir Hussain", "last": "Hussain", "zip": ""}, {"npi": "2", "name": "Sara Khan", "last": "Khan", "zip": ""}]
    with patch.object(p, "zip_table", return_value=TABLE), patch.object(p, "_npi_query", return_value=rows) as q:
        out = p.search("doctors", "family", last="huss", state="tx")
    assert [r["npi"] for r in out["results"]] == ["1"]
    assert q.call_args.args[1] == {"last_name": "huss*", "state": "TX"}


# ---- routes -------------------------------------------------------------------------------

@pytest.fixture()
def client():
    from services import ratelimit
    ratelimit.reset()
    with patch("main.connect_to_database", return_value=True), patch("main.warmup_system", return_value=None):
        from fastapi.testclient import TestClient
        import main as app_module
        with TestClient(app_module.app) as c:
            yield c
    ratelimit.reset()


def test_routes(client):
    r = client.get("/api/providers/specialties")
    assert r.status_code == 200 and r.json()["specialties"][0]["key"] == "all" and r.json()["kinds"]["urgent"]["label"] == "Urgent care"

    with patch.object(p, "zip_table", return_value=TABLE):
        r = client.get("/api/providers/cities", params={"q": "plan"})
    assert r.json()["cities"][0] == {"city": "Plano", "state": "TX", "zips": 3}

    with patch.object(p, "search", return_value={"origin": None, "results": [{"npi": "1"}]}) as s:
        r = client.get("/api/providers/search", params={"kind": "urgent", "zip": "75074"})
        near = client.get("/api/providers/search", params={"lat": "33.03", "lon": "-96.68"})
    assert r.status_code == 200 and r.json()["count"] == 1 and s.call_args_list[0].args[0] == "urgent"
    assert r.headers["cache-control"].startswith("public")
    assert near.headers["cache-control"] == "private, no-store"  # the visitor's coordinates never sit in a shared cache
    assert client.get("/api/providers/search", params={"kind": "hospital"}).status_code == 422

    with patch.object(p, "search", side_effect=p.ProviderError(400, "Enter a 5-digit ZIP code.")):
        r = client.get("/api/providers/search", params={"zip": "1"})
    assert r.status_code == 400 and r.json()["detail"] == "Enter a 5-digit ZIP code."

    with patch.object(p, "geocode_batch", return_value={"1234567890": {"lat": 1, "lon": 2, "approx": False}}):
        r = client.post("/api/providers/geocode", json={"items": [{"npi": "1234567890", "address": "a", "city": "b", "state": "TX", "zip": "75074"}]})
    assert r.json()["positions"]["1234567890"]["lat"] == 1
    assert client.post("/api/providers/geocode", json={"items": [{"npi": "12"}]}).status_code == 422

    with patch.object(p, "details", return_value=None):
        assert client.get("/api/providers/1234567890").status_code == 404
    assert client.get("/api/providers/abc").status_code == 404
    with patch.object(p, "details", return_value={"provider": {"npi": "1234567890"}, "cms": None, "google": None, "extras_pending": True}):
        r = client.get("/api/providers/1234567890")
    assert r.status_code == 200 and r.json()["extras_pending"] is True
    with patch.object(p, "extras", return_value={"cms": {"medical_school": "X"}, "google": None}):
        r = client.get("/api/providers/1234567890/extras")
    assert r.status_code == 200 and r.json()["cms"]["medical_school"] == "X"



def test_extras_are_rate_limited(client, monkeypatch):
    import routes.providers as rp
    monkeypatch.setattr(rp, "EXTRAS_PER_HOUR", 2)
    with patch.object(p, "extras", return_value={"cms": None, "google": None}):
        codes = [client.get("/api/providers/1234567890/extras").status_code for _ in range(3)]
    assert codes == [200, 200, 429]
