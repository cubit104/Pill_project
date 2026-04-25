"""Admin analytics endpoints — PostHog product analytics, funnels, replays, retention."""
import logging
import os
import threading
import time
from typing import Optional

import requests
from fastapi import APIRouter, Depends, Query

from routes.admin.auth import get_admin_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/analytics/posthog", tags=["admin-analytics-posthog"])

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

RANGE_DAYS = {"7d": 7, "28d": 28, "90d": 90}
_CACHE: dict = {}
_CACHE_LOCK = threading.Lock()
CACHE_TTL = 300  # 5 minutes


def _not_configured() -> dict:
    return {
        "configured": False,
        "message": "PostHog admin queries not configured. Set POSTHOG_PROJECT_API_KEY.",
    }


def _get_posthog_config():
    """Return (project_api_key, project_id, host) or (None, None, None).

    Prefers POSTHOG_PROJECT_API_KEY (the recommended env var); falls back to
    POSTHOG_PERSONAL_API_KEY for backward compatibility with older deployments.
    """
    key = os.getenv("POSTHOG_PROJECT_API_KEY") or os.getenv("POSTHOG_PERSONAL_API_KEY")
    project_id = os.getenv("POSTHOG_PROJECT_ID", "396739")
    host = os.getenv("POSTHOG_HOST", "https://us.posthog.com").rstrip("/")
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


# ─────────────────────────────────────────────────────────────────────────────
# Overview Endpoint
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/overview")
def posthog_overview(
    range_: str = Query("28d", alias="range", pattern="^(7d|28d|90d)$"),
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

    days = _days_for_range(range_)

    try:
        # ── Pageviews timeseries ──────────────────────────────────────────────
        timeseries_error = None
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
        try:
            ts_result = _ph_query(api_key, project_id, host, ts_payload)
            timeseries = []
            for row in (ts_result.get("results") or []):
                day_val = str(row[0])[:10] if row[0] else ""
                timeseries.append({"date": day_val, "pageviews": int(row[1])})
        except Exception as ts_exc:
            logger.error("PostHog timeseries query failed: %s", ts_exc, exc_info=True)
            timeseries = []
            timeseries_error = f"Failed to load timeseries: {ts_exc}"

        # ── Summary stats ─────────────────────────────────────────────────────
        kpi_error = None
        try:
            pv_result = _ph_query(api_key, project_id, host, {
                "query": {
                    "kind": "HogQLQuery",
                    "query": f"SELECT count() FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL {days} DAY",
                }
            })
            total_pageviews = int((pv_result.get("results") or [[0]])[0][0])

            sess_result = _ph_query(api_key, project_id, host, {
                "query": {
                    "kind": "HogQLQuery",
                    "query": f"SELECT count(DISTINCT properties.$session_id) FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL {days} DAY",
                }
            })
            total_sessions = int((sess_result.get("results") or [[0]])[0][0])

            users_result = _ph_query(api_key, project_id, host, {
                "query": {
                    "kind": "HogQLQuery",
                    "query": f"SELECT count(DISTINCT distinct_id) FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL {days} DAY",
                }
            })
            total_users = int((users_result.get("results") or [[0]])[0][0])
        except Exception as kpi_exc:
            logger.error("PostHog KPI query failed: %s", kpi_exc, exc_info=True)
            total_pageviews = 0
            total_sessions = 0
            total_users = 0
            kpi_error = f"Failed to load PostHog KPIs — check POSTHOG_PROJECT_API_KEY scope. Error: {kpi_exc}"

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
            **({"kpi_error": kpi_error} if kpi_error else {}),
            **({"timeseries_error": timeseries_error} if timeseries_error else {}),
        }
        _cache_set(cache_key, result)
        return result

    except Exception as exc:
        logger.error("PostHog overview error: %s", exc)
        return {"configured": True, "error": "Failed to fetch PostHog overview data. Check server logs for details."}


# ─────────────────────────────────────────────────────────────────────────────
# Funnel Endpoint
# ─────────────────────────────────────────────────────────────────────────────

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
    range_: str = Query("28d", alias="range", pattern="^(7d|28d|90d)$"),
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


# ─────────────────────────────────────────────────────────────────────────────
# Replays Endpoint
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/replays")
def posthog_replays(
    limit: int = Query(10, ge=1, le=50),
    admin: dict = Depends(get_admin_user),
):
    """Recent session replays with metadata and deep-link URLs."""
    api_key, project_id, host = _get_posthog_config()
    if not api_key:
        return _not_configured()

    cache_key = f"ph_replays_{limit}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    try:
        url = f"{host}/api/projects/{project_id}/session_recordings/"
        params = {
            "limit": limit,
            "date_from": "-30d",
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


# ─────────────────────────────────────────────────────────────────────────────
# Retention Endpoint
# ─────────────────────────────────────────────────────────────────────────────

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
