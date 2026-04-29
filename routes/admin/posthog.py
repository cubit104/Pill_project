"""Admin analytics endpoints — PostHog product analytics, funnels, replays, retention."""
import logging
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import requests
from fastapi import APIRouter, Depends, Query, Response

from routes.admin.auth import get_admin_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/analytics/posthog", tags=["admin-analytics-posthog"])

# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────

RANGE_DAYS = {"1d": 1, "7d": 7, "28d": 28, "90d": 90}
_CACHE: dict = {}
_CACHE_LOCK = threading.Lock()
CACHE_TTL = 300  # 5 minutes


def _not_configured() -> dict:
    return {
        "configured": False,
        "message": "PostHog admin queries not configured. Set POSTHOG_PERSONAL_API_KEY.",
    }


def _get_posthog_config():
    """Return (personal_api_key, project_id, host) or (None, None, None)."""
    key = os.getenv("POSTHOG_PERSONAL_API_KEY", "")
    project_id = os.getenv("POSTHOG_PROJECT_ID", "396739")
    host = os.getenv("POSTHOG_HOST", "https://us.i.posthog.com").rstrip("/")
    if not key:
        return None, None, None
    return key, project_id, host


def _cache_get(cache_key: str):
    with _CACHE_LOCK:
        entry = _CACHE.get(cache_key)
    if entry and (time.time() - entry["ts"] < CACHE_TTL):
        return entry["data"]
    return None


def _cache_set(cache_key: str, data):
    with _CACHE_LOCK:
        _CACHE[cache_key] = {"ts": time.time(), "data": data}


def _ph_query(api_key: str, project_id: str, host: str, payload: dict) -> dict:
    """Execute a PostHog HogQL/Insight query via the Query API."""
    url = f"{host}/api/projects/{project_id}/query/"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    resp = requests.post(url, json=payload, headers=headers, timeout=30)
    if not resp.ok:
        try:
            body = resp.json()
        except Exception:
            body = resp.text[:500]
        logger.error("PostHog API %s error: status=%s body=%s", url, resp.status_code, body)
    resp.raise_for_status()
    return resp.json()


def _ph_get(api_key: str, url: str, params: Optional[dict] = None) -> dict:
    """Execute a GET request to a PostHog endpoint."""
    headers = {"Authorization": f"Bearer {api_key}"}
    resp = requests.get(url, headers=headers, params=params or {}, timeout=30)
    if not resp.ok:
        try:
            body = resp.json()
        except Exception:
            body = resp.text[:500]
        logger.error("PostHog API %s error: status=%s body=%s", url, resp.status_code, body)
    resp.raise_for_status()
    return resp.json()


def _days_for_range(range_str: str) -> int:
    return RANGE_DAYS.get(range_str, 28)


def _scalar_count(api_key: str, project_id: str, host: str, sql: str, label: str) -> int:
    """Run a single-cell aggregate HogQL query and return an int. Logs and returns 0 on failure
    so a single broken metric never blanks out an entire dashboard row."""
    try:
        result = _ph_query(api_key, project_id, host, {
            "query": {"kind": "HogQLQuery", "query": sql},
        })
        rows = result.get("results") or []
        if not rows or rows[0] is None:
            return 0
        val = rows[0][0]
        return int(val) if val is not None else 0
    except Exception as exc:
        logger.error("PostHog scalar query %s failed: %s", label, exc)
        return 0


# ────────────────────────────────────────────────────────────────────────────
# Overview Endpoint
# ────────────────────────────────────────────────────────────────────────────

@router.get("/overview")
def posthog_overview(
    range_: str = Query("28d", alias="range", pattern="^(1d|7d|28d|90d)$"),
    admin: dict = Depends(get_admin_user),
):
    """Pageviews, sessions, top pages, top events, top referrers, country/device breakdowns."""
    api_key, project_id, host = _get_posthog_config()
    if not api_key:
        return _not_configured()

    cache_key = f"ph_overview_{range_}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    days = int(_days_for_range(range_))  # always 1, 7, 28, or 90 — safe for f-string SQL

    try:
        # ── Pageviews timeseries ──────────────────────────────────────────────
        if days == 1:
            # 24h view: group by hour for 24 data points. Anchor both the SQL
            # window and the Python scaffold to the same UTC hour boundary so
            # no valid earliest bucket is returned by PostHog and then silently
            # dropped because it is outside the scaffold.
            ts_query = """
                SELECT
                    toStartOfHour(timestamp) AS hour,
                    count() AS pageviews
                FROM events
                WHERE event = '$pageview'
                    AND timestamp >= toStartOfHour(now()) - INTERVAL 23 HOUR
                    AND timestamp < toStartOfHour(now()) + INTERVAL 1 HOUR
                GROUP BY hour
                ORDER BY hour ASC
            """
            ts_result = _ph_query(api_key, project_id, host, {"query": {"kind": "HogQLQuery", "query": ts_query}})
            current_hour_utc = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
            timeseries_map = {
                (current_hour_utc - timedelta(hours=i)).strftime("%Y-%m-%d %H:00"): 0
                for i in range(23, -1, -1)
            }
            for row in (ts_result.get("results") or []):
                # PostHog often returns ISO datetime strings like
                # "2025-01-10T13:00:00"; normalize the separator so the
                # key matches the scaffold format "%Y-%m-%d %H:00".
                hour_str = str(row[0]).replace("T", " ")[:16] if row[0] else ""
                if hour_str in timeseries_map:
                    timeseries_map[hour_str] = int(row[1])
            timeseries = [{"date": d, "pageviews": v} for d, v in timeseries_map.items()]
        else:
            # Multi-day view: group by day
            ts_payload = {
                "query": {
                    "kind": "HogQLQuery",
                    "query": f"""
                        SELECT
                            toStartOfDay(timestamp) AS day,
                            count() AS pageviews
                        FROM events
                        WHERE event = '$pageview'
                            AND timestamp >= now() - INTERVAL {days} DAY
                        GROUP BY day
                        ORDER BY day ASC
                    """,
                }
            }
            ts_result = _ph_query(api_key, project_id, host, ts_payload)

            # Build a complete day-by-day scaffold for the window in UTC, since
            # PostHog's `toStartOfDay(timestamp)` is UTC. Using local server time
            # caused recent events to fall on a calendar day that wasn't in the
            # scaffold and get silently dropped on non-UTC hosts.
            today_utc = datetime.now(timezone.utc).date()
            timeseries_map = {
                (today_utc - timedelta(days=i)).isoformat(): 0
                for i in range(days - 1, -1, -1)
            }
            for row in (ts_result.get("results") or []):
                # row[0] is an ISO datetime string like "2024-01-15T00:00:00"
                day_str = str(row[0])[:10] if row[0] else ""
                if day_str in timeseries_map:
                    timeseries_map[day_str] = int(row[1])
            timeseries = [{"date": d, "pageviews": v} for d, v in timeseries_map.items()]

        # ── Summary stats — three INDEPENDENT queries ─────────────────────────
        # Previously these were bundled into a single SELECT with three aggregates.
        # If any one column failed to evaluate (e.g. the session_id property
        # path), the whole row came back null and all three KPI cards rendered
        # 0 even though identical aggregates worked fine in the per-section
        # queries below. Splitting isolates failures.
        total_pageviews = _scalar_count(
            api_key, project_id, host,
            f"""
                SELECT count() FROM events
                WHERE event = '$pageview'
                  AND timestamp >= now() - INTERVAL {days} DAY
            """,
            "pageviews",
        )

        # Try $session_id directly first (HogQL exposes common props at the top
        # level on most projects); fall back to properties.$session_id.
        total_sessions = _scalar_count(
            api_key, project_id, host,
            f"""
                SELECT count(DISTINCT $session_id) FROM events
                WHERE event = '$pageview'
                  AND timestamp >= now() - INTERVAL {days} DAY
                  AND $session_id IS NOT NULL
            """,
            "sessions ($session_id)",
        )
        if total_sessions == 0:
            total_sessions = _scalar_count(
                api_key, project_id, host,
                f"""
                    SELECT count(DISTINCT properties.$session_id) FROM events
                    WHERE event = '$pageview'
                      AND timestamp >= now() - INTERVAL {days} DAY
                      AND properties.$session_id IS NOT NULL
                """,
                "sessions (properties.$session_id)",
            )

        total_users = _scalar_count(
            api_key, project_id, host,
            f"""
                SELECT count(DISTINCT person_id) FROM events
                WHERE event = '$pageview'
                  AND timestamp >= now() - INTERVAL {days} DAY
            """,
            "users",
        )

        # ── Top Pages ─────────────────────────────────────────────────────────
        top_pages_payload = {
            "query": {
                "kind": "HogQLQuery",
                "query": f"""
                    SELECT
                        properties.$pathname AS path,
                        count() AS pageviews,
                        count(DISTINCT person_id) AS unique_visitors
                    FROM events
                    WHERE event = '$pageview'
                        AND timestamp >= now() - INTERVAL {days} DAY
                    GROUP BY path
                    ORDER BY pageviews DESC
                    LIMIT 20
                """,
            }
        }
        top_pages_result = _ph_query(api_key, project_id, host, top_pages_payload)
        top_pages = [
            {"path": row[0], "pageviews": int(row[1]), "unique_visitors": int(row[2])}
            for row in (top_pages_result.get("results") or [])
        ]

        # ── Top Events ────────────────────────────────────────────────────────
        top_events_payload = {
            "query": {
                "kind": "HogQLQuery",
                "query": f"""
                    SELECT
                        event,
                        count() AS count,
                        count(DISTINCT person_id) AS unique_users
                    FROM events
                    WHERE timestamp >= now() - INTERVAL {days} DAY
                        AND event NOT IN ('$feature_flag_called', '$$anon_distinct_id_change')
                    GROUP BY event
                    ORDER BY count DESC
                    LIMIT 20
                """,
            }
        }
        top_events_result = _ph_query(api_key, project_id, host, top_events_payload)
        top_events = [
            {"event": row[0], "count": int(row[1]), "unique_users": int(row[2])}
            for row in (top_events_result.get("results") or [])
        ]

        # ── Top Referrers ─────────────────────────────────────────────────────
        referrers_payload = {
            "query": {
                "kind": "HogQLQuery",
                "query": f"""
                    SELECT
                        coalesce(properties.$referrer, '(direct)') AS referrer,
                        count() AS sessions
                    FROM events
                    WHERE event = '$pageview'
                        AND timestamp >= now() - INTERVAL {days} DAY
                    GROUP BY referrer
                    ORDER BY sessions DESC
                    LIMIT 15
                """,
            }
        }
        referrers_result = _ph_query(api_key, project_id, host, referrers_payload)
        top_referrers = [
            {"referrer": row[0], "sessions": int(row[1])}
            for row in (referrers_result.get("results") or [])
        ]

        # ── Country Breakdown ─────────────────────────────────────────────────
        country_payload = {
            "query": {
                "kind": "HogQLQuery",
                "query": f"""
                    SELECT
                        coalesce(properties.$geoip_country_name, 'Unknown') AS country,
                        count(DISTINCT person_id) AS users
                    FROM events
                    WHERE event = '$pageview'
                        AND timestamp >= now() - INTERVAL {days} DAY
                    GROUP BY country
                    ORDER BY users DESC
                    LIMIT 15
                """,
            }
        }
        country_result = _ph_query(api_key, project_id, host, country_payload)
        countries = [
            {"country": row[0], "users": int(row[1])}
            for row in (country_result.get("results") or [])
        ]

        # ── Device Breakdown ──────────────────────────────────────────────────
        device_payload = {
            "query": {
                "kind": "HogQLQuery",
                "query": f"""
                    SELECT
                        coalesce(properties.$device_type, 'Unknown') AS device_type,
                        count(DISTINCT person_id) AS users
                    FROM events
                    WHERE event = '$pageview'
                        AND timestamp >= now() - INTERVAL {days} DAY
                    GROUP BY device_type
                    ORDER BY users DESC
                    LIMIT 10
                """,
            }
        }
        device_result = _ph_query(api_key, project_id, host, device_payload)
        devices = [
            {"device": row[0], "users": int(row[1])}
            for row in (device_result.get("results") or [])
        ]

        result = {
            "configured": True,
            "range": range_,
            "summary": {
                "pageviews": total_pageviews,
                "sessions": total_sessions,
                "users": total_users,
            },
            "timeseries": timeseries,
            "top_pages": top_pages,
            "top_events": top_events,
            "top_referrers": top_referrers,
            "countries": countries,
            "devices": devices,
        }
        _cache_set(cache_key, result)
        return result

    except Exception as exc:
        logger.error("PostHog overview error: %s", exc)
        return {"configured": True, "error": "Failed to fetch PostHog overview data. Check server logs for details."}


# ────────────────────────────────────────────────────────────────────────────
# Funnel Endpoint
# ────────────────────────────────────────────────────────────────────────────

# Single source of truth for the core user-journey funnel steps.
# Each entry maps directly to a FunnelsQuery series node.
DEFAULT_FUNNEL_STEPS = [
    {
        "name": "Landing (Home)",
        "property_key": "$pathname",
        "operator": "exact",
        "value": "/",
    },
    {
        "name": "Engagement (Search or Pill)",
        "property_key": "$pathname",
        "operator": "regex",
        "value": "^(/search|/pill/)",
    },
    {
        "name": "Deep Engagement (Drug Page)",
        "property_key": "$pathname",
        "operator": "icontains",
        "value": "/drug/",
    },
]


def _build_funnel_series(steps: list) -> list:
    """Convert DEFAULT_FUNNEL_STEPS into FunnelsQuery series nodes."""
    return [
        {
            "kind": "EventsNode",
            "event": "$pageview",
            "name": step["name"],
            "properties": [
                {
                    "key": step["property_key"],
                    "operator": step["operator"],
                    "value": step["value"],
                    "type": "event",
                }
            ],
        }
        for step in steps
    ]


@router.get("/funnel")
def posthog_funnel(
    range_: str = Query("28d", alias="range", pattern="^(1d|7d|28d|90d)$"),
    admin: dict = Depends(get_admin_user),
):
    """Core user journey funnel: landing → search/pill → drug page."""
    api_key, project_id, host = _get_posthog_config()
    if not api_key:
        return _not_configured()

    cache_key = f"ph_funnel_{range_}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    days = _days_for_range(range_)
    date_from = f"-{days}d"

    try:
        funnel_payload = {
            "query": {
                "kind": "FunnelsQuery",
                "series": _build_funnel_series(DEFAULT_FUNNEL_STEPS),
                "dateRange": {"date_from": date_from},
                "funnelsFilter": {
                    "funnelWindowInterval": 14,
                    "funnelWindowIntervalUnit": "day",
                },
            }
        }
        result = _ph_query(api_key, project_id, host, funnel_payload)

        steps = []
        if result.get("results") and len(result["results"]) > 0:
            raw_steps = result["results"]
            for i, step in enumerate(raw_steps):
                count = step.get("count", 0)
                prev_count = raw_steps[i - 1].get("count", count) if i > 0 else count
                conversion_from_prev = (count / prev_count * 100) if prev_count > 0 else 0
                total_count = raw_steps[0].get("count", count) if raw_steps else count
                conversion_from_start = (count / total_count * 100) if total_count > 0 else 0
                steps.append({
                    "name": step.get("name", f"Step {i + 1}"),
                    "count": count,
                    "conversion_from_prev": round(conversion_from_prev, 1),
                    "conversion_from_start": round(conversion_from_start, 1),
                    "drop_off": prev_count - count if i > 0 else 0,
                })

        out = {"configured": True, "range": range_, "steps": steps}
        _cache_set(cache_key, out)
        return out

    except Exception as exc:
        logger.error("PostHog funnel error: %s", exc)
        return {"configured": True, "error": "Failed to fetch PostHog funnel data. Check server logs for details."}


# ────────────────────────────────────────────────────────────────────────────
# Replays Endpoint
# ────────────────────────────────────────────────────────────────────────────

@router.get("/replays")
def posthog_replays(
    limit: int = Query(10, ge=1, le=50),
    range_: str = Query("28d", alias="range", pattern="^(1d|7d|28d|90d)$"),
    admin: dict = Depends(get_admin_user),
):
    """Recent session replays with metadata and deep-link URLs."""
    api_key, project_id, host = _get_posthog_config()
    if not api_key:
        return _not_configured()

    range_to_date = {"1d": "-1d", "7d": "-7d", "28d": "-28d", "90d": "-90d"}
    date_from = range_to_date.get(range_, "-30d")
    cache_key = f"ph_replays_{limit}_{range_}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    try:
        url = f"{host}/api/projects/{project_id}/session_recordings/"
        params = {
            "limit": limit,
            "date_from": date_from,
        }
        data = _ph_get(api_key, url, params=params)

        replays = []
        posthog_ui_host = "https://us.posthog.com"
        for rec in data.get("results", [])[:limit]:
            session_id = rec.get("id", "")
            replays.append({
                "session_id": session_id,
                "start_time": rec.get("start_time"),
                "end_time": rec.get("end_time"),
                "duration": rec.get("recording_duration"),
                "distinct_id": rec.get("distinct_id"),
                "click_count": rec.get("click_count", 0),
                "keypress_count": rec.get("keypress_count", 0),
                "start_url": rec.get("start_url") or (rec.get("urls") or [None])[0] or "",
                "replay_url": f"{posthog_ui_host}/project/{project_id}/replay/{session_id}",
            })

        out = {"configured": True, "replays": replays}
        _cache_set(cache_key, out)
        return out

    except Exception as exc:
        logger.error("PostHog replays error: %s", exc)
        return {"configured": True, "error": "Failed to fetch PostHog replays. Check server logs for details."}


# ────────────────────────────────────────────────────────────────────────────
# Retention Endpoint
# ────────────────────────────────────────────────────────────────────────────

_MAX_RETENTION_WEEKS = 52


@router.get("/retention")
def posthog_retention(
    range_: str = Query("12w", alias="range", pattern=r"^\d+w$"),
    admin: dict = Depends(get_admin_user),
):
    """Weekly retention cohort grid."""
    api_key, project_id, host = _get_posthog_config()
    if not api_key:
        return _not_configured()

    # Cap weeks to prevent unbounded queries/cache growth
    try:
        weeks = int(range_.rstrip("w"))
    except ValueError:
        weeks = 12
    weeks = min(weeks, _MAX_RETENTION_WEEKS)
    safe_range = f"{weeks}w"

    cache_key = f"ph_retention_{safe_range}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    date_from = f"-{weeks}w"

    try:
        retention_payload = {
            "query": {
                "kind": "RetentionQuery",
                "retentionFilter": {
                    "retentionType": "retention_first_time",
                    "totalIntervals": weeks,
                    "period": "Week",
                    "targetEntity": {"id": "$pageview", "name": "$pageview", "type": "events"},
                    "returningEntity": {"id": "$pageview", "name": "$pageview", "type": "events"},
                },
                "dateRange": {"date_from": date_from},
            }
        }
        result = _ph_query(api_key, project_id, host, retention_payload)

        cohorts = []
        for row in result.get("result", []):
            values_list = row.get("values", [])
            cohort_size = values_list[0].get("count", 0) if values_list else 0
            cohorts.append({
                "date": row.get("date"),
                "cohort_size": cohort_size,
                "values": [
                    {
                        "period": v.get("label", f"Week {i}"),
                        "count": v.get("count", 0),
                        "percentage": round(v.get("count", 0) / cohort_size * 100, 1) if cohort_size > 0 else 0,
                    }
                    for i, v in enumerate(values_list)
                ],
            })

        out = {"configured": True, "range": safe_range, "cohorts": cohorts}
        _cache_set(cache_key, out)
        return out

    except Exception as exc:
        logger.error("PostHog retention error: %s", exc)
        return {"configured": True, "error": "Failed to fetch PostHog retention data. Check server logs for details."}


# ────────────────────────────────────────────────────────────────────────────
# Visitor Locations Endpoint
# ────────────────────────────────────────────────────────────────────────────

@router.get("/visitor-locations")
def posthog_visitor_locations(
    range_: str = Query("28d", alias="range", pattern="^(1d|7d|28d|90d)$"),
    admin: dict = Depends(get_admin_user),
):
    """Return visitor locations including IP, city, region, country from PostHog GeoIP data."""
    api_key, project_id, host = _get_posthog_config()
    if not api_key:
        return _not_configured()

    cache_key = f"ph_visitor_locations_{range_}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    days = int(_days_for_range(range_))

    try:
        payload = {
            "query": {
                "kind": "HogQLQuery",
                "query": f"""
                    SELECT
                        properties.$ip AS ip_address,
                        coalesce(properties.$geoip_city_name, 'Unknown') AS city,
                        coalesce(properties.$geoip_subdivision_1_name, 'Unknown') AS region,
                        coalesce(properties.$geoip_country_name, 'Unknown') AS country,
                        coalesce(properties.$geoip_country_code, '') AS country_code,
                        max(timestamp) AS last_seen,
                        count() AS pageviews,
                        count(DISTINCT person_id) AS users
                    FROM events
                    WHERE event = '$pageview'
                        AND timestamp >= now() - INTERVAL {days} DAY
                        AND properties.$ip IS NOT NULL
                    GROUP BY ip_address, city, region, country, country_code
                    ORDER BY last_seen DESC
                    LIMIT 100
                """,
            }
        }
        result = _ph_query(api_key, project_id, host, payload)
        locations = [
            {
                "ip": row[0] or "",
                "city": row[1] or "Unknown",
                "region": row[2] or "Unknown",
                "country": row[3] or "Unknown",
                "country_code": row[4] or "",
                "last_seen": str(row[5]) if row[5] else None,
                "pageviews": int(row[6]) if row[6] else 0,
                "users": int(row[7]) if row[7] else 0,
            }
            for row in (result.get("results") or [])
        ]
        out = {"configured": True, "range": range_, "locations": locations}
        _cache_set(cache_key, out)
        return out

    except Exception as exc:
        logger.error("PostHog visitor locations error: %s", exc)
        return {"configured": True, "error": "Failed to fetch PostHog visitor locations. Check server logs for details."}


# ────────────────────────────────────────────────────────────────────────────
# Live Visitors Endpoint
# ────────────────────────────────────────────────────────────────────────────

@router.get("/live")
def posthog_live(response: Response, admin: dict = Depends(get_admin_user)):
    """Return active users in last 5 minutes and recent live page events."""
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    api_key, project_id, host = _get_posthog_config()
    if not api_key:
        return _not_configured()

    try:
        # Active users in last 5 minutes
        active_users = _scalar_count(api_key, project_id, host, """
            SELECT count(DISTINCT person_id) FROM events
            WHERE event = '$pageview'
              AND timestamp >= now() - INTERVAL 5 MINUTE
        """, "live_active_users")

        # Recent page events (last 30 minutes, up to 100 rows)
        payload = {
            "query": {
                "kind": "HogQLQuery",
                "query": """
                    SELECT
                        timestamp,
                        properties.$pathname AS path,
                        coalesce(properties.$geoip_country_name, 'Unknown') AS country,
                        coalesce(properties.$geoip_country_code, '') AS country_code,
                        coalesce(properties.$geoip_city_name, '') AS city,
                        properties.$ip AS ip,
                        coalesce(properties.$device_type, 'Desktop') AS device,
                        coalesce(properties.$browser, '') AS browser
                    FROM events
                    WHERE event = '$pageview'
                      AND timestamp >= now() - INTERVAL 30 MINUTE
                    ORDER BY timestamp DESC
                    LIMIT 100
                """,
            }
        }
        result = _ph_query(api_key, project_id, host, payload)
        events = [
            {
                "timestamp": str(row[0]) if row[0] else None,
                "path": row[1] or "/",
                "country": row[2] or "Unknown",
                "country_code": row[3] or "",
                "city": row[4] or "",
                "ip": row[5] or "",
                "device": row[6] or "Desktop",
                "browser": row[7] or "",
            }
            for row in (result.get("results") or [])
        ]

        return {
            "configured": True,
            "active_users": active_users,
            "events": events,
            "as_of": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }

    except Exception as exc:
        logger.error("PostHog live error: %s", exc)
        return {"configured": True, "error": "Failed to fetch live data."}
