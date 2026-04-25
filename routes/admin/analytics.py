"""Admin analytics endpoints — GA4, Search Console, PageSpeed Insights, Page Health."""
import json
import logging
import os
import re
from typing import Optional

import requests
from fastapi import APIRouter, Depends, Query
from sqlalchemy import text

import database
from routes.admin.auth import get_admin_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/analytics", tags=["admin-analytics"])

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

RANGE_DAYS = {"7d": 7, "28d": 28, "90d": 90}


def _not_configured(service: str, instructions: str) -> dict:
    return {"configured": False, "message": f"{service} not configured. {instructions}"}


def _get_ga4_credentials():
    """Load GA4 credentials from env.  Returns (property_id, creds_dict | None)."""
    property_id = os.getenv("GA4_PROPERTY_ID", "")
    sa_json_raw = os.getenv("GA4_SERVICE_ACCOUNT_JSON", "")
    if not property_id or not sa_json_raw:
        return None, None
    # Accept either raw JSON string or a file path
    if sa_json_raw.strip().startswith("{"):
        try:
            creds_dict = json.loads(sa_json_raw)
        except json.JSONDecodeError:
            return None, None
    else:
        if not os.path.isfile(sa_json_raw):
            return None, None
        with open(sa_json_raw) as f:
            creds_dict = json.load(f)
    return property_id, creds_dict


def _get_search_console_credentials():
    """Load Search Console creds from env."""
    site_url = os.getenv("SEARCH_CONSOLE_SITE_URL", "")
    sa_json_raw = os.getenv("GA4_SERVICE_ACCOUNT_JSON", "")  # reuse same service account
    if not site_url or not sa_json_raw:
        return None, None
    if sa_json_raw.strip().startswith("{"):
        try:
            creds_dict = json.loads(sa_json_raw)
        except json.JSONDecodeError:
            return None, None
    else:
        if not os.path.isfile(sa_json_raw):
            return None, None
        with open(sa_json_raw) as f:
            creds_dict = json.load(f)
    return site_url, creds_dict


# ─────────────────────────────────────────────────────────────────────────────
# GA4 Overview
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/ga4/overview")
def ga4_overview(
    range: str = Query("28d", regex="^(7d|28d|90d)$"),
    admin: dict = Depends(get_admin_user),
):
    property_id, creds_dict = _get_ga4_credentials()
    if not property_id:
        return _not_configured(
            "GA4",
            "Set GA4_PROPERTY_ID and GA4_SERVICE_ACCOUNT_JSON environment variables. "
            "See docs/admin-analytics.md for setup instructions.",
        )

    try:
        from google.oauth2 import service_account
        from google.analytics.data_v1beta import BetaAnalyticsDataClient
        from google.analytics.data_v1beta.types import (
            DateRange,
            Dimension,
            Metric,
            RunReportRequest,
        )

        credentials = service_account.Credentials.from_service_account_info(
            creds_dict,
            scopes=["https://www.googleapis.com/auth/analytics.readonly"],
        )
        client = BetaAnalyticsDataClient(credentials=credentials)

        days = RANGE_DAYS.get(range, 28)
        date_range = DateRange(start_date=f"{days}daysAgo", end_date="today")

        # --- Summary metrics ---
        summary_req = RunReportRequest(
            property=f"properties/{property_id}",
            date_ranges=[date_range],
            metrics=[
                Metric(name="totalUsers"),
                Metric(name="sessions"),
                Metric(name="screenPageViews"),
                Metric(name="bounceRate"),
                Metric(name="averageSessionDuration"),
            ],
        )
        summary = client.run_report(summary_req)
        row = summary.rows[0].metric_values if summary.rows else [None] * 5

        def _v(r, i):
            try:
                return float(r[i].value) if r and r[i] else 0.0
            except (IndexError, AttributeError):
                return 0.0

        # --- Daily timeseries ---
        ts_req = RunReportRequest(
            property=f"properties/{property_id}",
            date_ranges=[date_range],
            dimensions=[Dimension(name="date")],
            metrics=[
                Metric(name="totalUsers"),
                Metric(name="sessions"),
                Metric(name="screenPageViews"),
            ],
        )
        ts_resp = client.run_report(ts_req)
        timeseries = [
            {
                "date": r.dimension_values[0].value,
                "users": float(r.metric_values[0].value),
                "sessions": float(r.metric_values[1].value),
                "pageviews": float(r.metric_values[2].value),
            }
            for r in ts_resp.rows
        ]
        timeseries.sort(key=lambda x: x["date"])

        # --- Top pages ---
        pages_req = RunReportRequest(
            property=f"properties/{property_id}",
            date_ranges=[date_range],
            dimensions=[Dimension(name="pagePath")],
            metrics=[
                Metric(name="screenPageViews"),
                Metric(name="averageSessionDuration"),
                Metric(name="bounceRate"),
            ],
            limit=10,
            order_bys=[{"metric": {"metric_name": "screenPageViews"}, "desc": True}],
        )
        pages_resp = client.run_report(pages_req)
        top_pages = [
            {
                "page": r.dimension_values[0].value,
                "views": float(r.metric_values[0].value),
                "avg_session_duration": float(r.metric_values[1].value),
                "bounce_rate": float(r.metric_values[2].value),
            }
            for r in pages_resp.rows
        ]

        # --- Traffic sources ---
        sources_req = RunReportRequest(
            property=f"properties/{property_id}",
            date_ranges=[date_range],
            dimensions=[Dimension(name="sessionDefaultChannelGrouping")],
            metrics=[Metric(name="sessions")],
            limit=10,
            order_bys=[{"metric": {"metric_name": "sessions"}, "desc": True}],
        )
        sources_resp = client.run_report(sources_req)
        traffic_sources = [
            {
                "source": r.dimension_values[0].value,
                "sessions": float(r.metric_values[0].value),
            }
            for r in sources_resp.rows
        ]

        # --- Country breakdown ---
        country_req = RunReportRequest(
            property=f"properties/{property_id}",
            date_ranges=[date_range],
            dimensions=[Dimension(name="country")],
            metrics=[Metric(name="totalUsers")],
            limit=10,
            order_bys=[{"metric": {"metric_name": "totalUsers"}, "desc": True}],
        )
        country_resp = client.run_report(country_req)
        countries = [
            {
                "country": r.dimension_values[0].value,
                "users": float(r.metric_values[0].value),
            }
            for r in country_resp.rows
        ]

        # --- Device breakdown ---
        device_req = RunReportRequest(
            property=f"properties/{property_id}",
            date_ranges=[date_range],
            dimensions=[Dimension(name="deviceCategory")],
            metrics=[Metric(name="sessions")],
        )
        device_resp = client.run_report(device_req)
        devices = [
            {
                "device": r.dimension_values[0].value,
                "sessions": float(r.metric_values[0].value),
            }
            for r in device_resp.rows
        ]

        return {
            "configured": True,
            "range": range,
            "summary": {
                "users": _v(row, 0),
                "sessions": _v(row, 1),
                "pageviews": _v(row, 2),
                "bounce_rate": _v(row, 3),
                "avg_session_duration": _v(row, 4),
            },
            "timeseries": timeseries,
            "top_pages": top_pages,
            "traffic_sources": traffic_sources,
            "countries": countries,
            "devices": devices,
        }
    except Exception as exc:
        logger.error(f"GA4 overview error: {exc}", exc_info=True)
        return {"configured": True, "error": str(exc)}


# ─────────────────────────────────────────────────────────────────────────────
# Search Console Overview
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/search-console/overview")
def search_console_overview(
    range: str = Query("28d", regex="^(7d|28d|90d)$"),
    admin: dict = Depends(get_admin_user),
):
    site_url, creds_dict = _get_search_console_credentials()
    if not site_url:
        return _not_configured(
            "Search Console",
            "Set SEARCH_CONSOLE_SITE_URL and GA4_SERVICE_ACCOUNT_JSON environment variables. "
            "See docs/admin-analytics.md for setup instructions.",
        )

    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
        import datetime

        credentials = service_account.Credentials.from_service_account_info(
            creds_dict,
            scopes=["https://www.googleapis.com/auth/webmasters.readonly"],
        )
        service = build("searchconsole", "v1", credentials=credentials)

        days = RANGE_DAYS.get(range, 28)
        end = datetime.date.today()
        start = end - datetime.timedelta(days=days)

        def _query(dimensions, row_limit=10, extra=None):
            body = {
                "startDate": start.isoformat(),
                "endDate": end.isoformat(),
                "dimensions": dimensions,
                "rowLimit": row_limit,
            }
            if extra:
                body.update(extra)
            return (
                service.searchanalytics()
                .query(siteUrl=site_url, body=body)
                .execute()
                .get("rows", [])
            )

        # --- Summary (no dimensions) ---
        summary_rows = _query([], row_limit=1)
        if summary_rows:
            s = summary_rows[0]
        else:
            body = {
                "startDate": start.isoformat(),
                "endDate": end.isoformat(),
                "rowLimit": 1,
            }
            s = (
                service.searchanalytics()
                .query(siteUrl=site_url, body=body)
                .execute()
            )
        clicks = s.get("clicks", 0)
        impressions = s.get("impressions", 0)
        ctr = s.get("ctr", 0)
        position = s.get("position", 0)

        # --- Top queries ---
        query_rows = _query(["query"], row_limit=50)
        top_queries = [
            {
                "query": r["keys"][0],
                "clicks": r.get("clicks", 0),
                "impressions": r.get("impressions", 0),
                "ctr": r.get("ctr", 0),
                "position": r.get("position", 0),
            }
            for r in query_rows
        ]

        # --- Top pages ---
        page_rows = _query(["page"], row_limit=50)
        top_pages = [
            {
                "page": r["keys"][0],
                "clicks": r.get("clicks", 0),
                "impressions": r.get("impressions", 0),
                "ctr": r.get("ctr", 0),
                "position": r.get("position", 0),
            }
            for r in page_rows
        ]

        # --- Position distribution ---
        all_query_rows = _query(["query"], row_limit=1000)
        dist = {"1-3": 0, "4-10": 0, "11-20": 0, "21-50": 0, "51-100": 0}
        for r in all_query_rows:
            pos = r.get("position", 101)
            if pos <= 3:
                dist["1-3"] += 1
            elif pos <= 10:
                dist["4-10"] += 1
            elif pos <= 20:
                dist["11-20"] += 1
            elif pos <= 50:
                dist["21-50"] += 1
            else:
                dist["51-100"] += 1

        position_distribution = [{"range": k, "count": v} for k, v in dist.items()]

        # --- CTR vs position scatter (top 100 queries) ---
        ctr_scatter = [
            {"position": r.get("position", 0), "ctr": r.get("ctr", 0), "clicks": r.get("clicks", 0)}
            for r in all_query_rows[:100]
        ]

        return {
            "configured": True,
            "range": range,
            "summary": {
                "clicks": clicks,
                "impressions": impressions,
                "ctr": ctr,
                "position": position,
            },
            "top_queries": top_queries,
            "top_pages": top_pages,
            "position_distribution": position_distribution,
            "ctr_scatter": ctr_scatter,
        }
    except Exception as exc:
        logger.error(f"Search Console overview error: {exc}", exc_info=True)
        return {"configured": True, "error": str(exc)}


# ─────────────────────────────────────────────────────────────────────────────
# PageSpeed Insights
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/pagespeed/run")
def run_pagespeed(
    body: dict,
    admin: dict = Depends(get_admin_user),
):
    api_key = os.getenv("PAGESPEED_API_KEY", "")
    if not api_key:
        return _not_configured(
            "PageSpeed Insights",
            "Set PAGESPEED_API_KEY environment variable. "
            "See docs/admin-analytics.md for setup instructions.",
        )

    url = body.get("url", "")
    strategy = body.get("strategy", "mobile")
    if not url:
        return {"configured": True, "error": "url is required"}

    try:
        resp = requests.get(
            "https://www.googleapis.com/pagespeedonline/v5/runPagespeed",
            params={"url": url, "strategy": strategy, "key": api_key},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()

        lhr = data.get("lighthouseResult", {})
        categories = lhr.get("categories", {})
        audits = lhr.get("audits", {})

        def _audit_val(key: str) -> Optional[float]:
            a = audits.get(key, {})
            num = a.get("numericValue")
            return round(num, 1) if num is not None else None

        def _score(key: str) -> Optional[float]:
            a = audits.get(key, {})
            return a.get("score")

        return {
            "configured": True,
            "url": url,
            "strategy": strategy,
            "scores": {
                "performance": (categories.get("performance", {}).get("score") or 0) * 100,
                "seo": (categories.get("seo", {}).get("score") or 0) * 100,
                "accessibility": (categories.get("accessibility", {}).get("score") or 0) * 100,
                "best_practices": (categories.get("best-practices", {}).get("score") or 0) * 100,
            },
            "metrics": {
                "lcp": _audit_val("largest-contentful-paint"),
                "cls": _audit_val("cumulative-layout-shift"),
                "fcp": _audit_val("first-contentful-paint"),
                "ttfb": _audit_val("server-response-time"),
                "tbt": _audit_val("total-blocking-time"),
                "inp": _audit_val("interaction-to-next-paint"),
            },
            "metric_scores": {
                "lcp": _score("largest-contentful-paint"),
                "cls": _score("cumulative-layout-shift"),
                "fcp": _score("first-contentful-paint"),
                "ttfb": _score("server-response-time"),
                "tbt": _score("total-blocking-time"),
                "inp": _score("interaction-to-next-paint"),
            },
        }
    except requests.RequestException as exc:
        logger.error(f"PageSpeed request error: {exc}")
        return {"configured": True, "error": str(exc)}
    except Exception as exc:
        logger.error(f"PageSpeed error: {exc}", exc_info=True)
        return {"configured": True, "error": str(exc)}


# ─────────────────────────────────────────────────────────────────────────────
# Page Health (no external config needed)
# ─────────────────────────────────────────────────────────────────────────────

# Heuristics for garbage drug_name values
_GARBAGE_PATTERNS = [
    re.compile(r"inert\s+ingredients", re.IGNORECASE),
    re.compile(r"active\s+ingredients", re.IGNORECASE),
    re.compile(r"^\d+\s+\w+", re.IGNORECASE),  # starts with digit then word(s)
    re.compile(r";.*\d+", re.IGNORECASE),       # semicolons followed by counts
]
_GARBAGE_LONG = 80  # names longer than this are likely garbage


def _is_garbage_drug_name(name: str) -> bool:
    if not name:
        return False
    if len(name) > _GARBAGE_LONG:
        return True
    for pat in _GARBAGE_PATTERNS:
        if pat.search(name):
            return True
    return False


@router.get("/page-health")
def page_health(admin: dict = Depends(get_admin_user)):
    if not database.db_engine:
        database.connect_to_database()

    issues = []

    try:
        with database.db_engine.connect() as conn:
            rows = conn.execute(
                text(
                    """
                    SELECT
                        id,
                        slug,
                        medicine_name,
                        meta_title,
                        meta_description,
                        noindex
                    FROM pillfinder
                    WHERE deleted_at IS NULL
                    ORDER BY id
                    LIMIT 5000
                    """
                )
            ).fetchall()
    except Exception as exc:
        # meta_title / meta_description / noindex columns may not exist yet — fall back
        logger.warning(f"page_health full query failed ({exc}), falling back to basic columns")
        try:
            with database.db_engine.connect() as conn:
                rows = conn.execute(
                    text(
                        """
                        SELECT id, slug, medicine_name,
                               NULL AS meta_title,
                               NULL AS meta_description,
                               NULL AS noindex
                        FROM pillfinder
                        WHERE deleted_at IS NULL
                        ORDER BY id
                        LIMIT 5000
                        """
                    )
                ).fetchall()
        except Exception as exc2:
            logger.error(f"page_health fallback query failed: {exc2}")
            return {"issues": [], "error": str(exc2)}

    # Track titles / descriptions for duplicate detection
    title_map: dict[str, list[str]] = {}
    desc_map: dict[str, list[str]] = {}

    for row in rows:
        row_id, slug, medicine_name, meta_title, meta_description, noindex = row
        page_url = f"/pill/{slug}" if slug else f"/pill/{row_id}"

        # Garbage drug name (data quality)
        if _is_garbage_drug_name(medicine_name or ""):
            issues.append(
                {
                    "id": str(row_id),
                    "url": page_url,
                    "issue_type": "garbage_drug_name",
                    "severity": "critical",
                    "message": f"Drug name looks like raw ingredient data: "{(medicine_name or '')[:80]}"",
                    "field": "medicine_name",
                    "current_value": medicine_name,
                }
            )
            continue  # Skip SEO checks for garbage-name pages

        # Missing meta_title
        if not meta_title:
            issues.append(
                {
                    "id": str(row_id),
                    "url": page_url,
                    "issue_type": "missing_meta_title",
                    "severity": "critical",
                    "message": "Page is missing a meta title.",
                    "field": "meta_title",
                    "current_value": None,
                }
            )
        else:
            title_len = len(meta_title)
            if title_len < 30:
                issues.append(
                    {
                        "id": str(row_id),
                        "url": page_url,
                        "issue_type": "short_meta_title",
                        "severity": "warning",
                        "message": f"Meta title is too short ({title_len} chars, min 30).",
                        "field": "meta_title",
                        "current_value": meta_title,
                    }
                )
            elif title_len > 60:
                issues.append(
                    {
                        "id": str(row_id),
                        "url": page_url,
                        "issue_type": "long_meta_title",
                        "severity": "warning",
                        "message": f"Meta title is too long ({title_len} chars, max 60).",
                        "field": "meta_title",
                        "current_value": meta_title,
                    }
                )
            # Accumulate for dup detection
            key = meta_title.strip().lower()
            title_map.setdefault(key, []).append(page_url)

        # Missing meta_description
        if not meta_description:
            issues.append(
                {
                    "id": str(row_id),
                    "url": page_url,
                    "issue_type": "missing_meta_description",
                    "severity": "critical",
                    "message": "Page is missing a meta description.",
                    "field": "meta_description",
                    "current_value": None,
                }
            )
        else:
            desc_len = len(meta_description)
            if desc_len < 100:
                issues.append(
                    {
                        "id": str(row_id),
                        "url": page_url,
                        "issue_type": "short_meta_description",
                        "severity": "warning",
                        "message": f"Meta description is too short ({desc_len} chars, min 100).",
                        "field": "meta_description",
                        "current_value": meta_description,
                    }
                )
            elif desc_len > 160:
                issues.append(
                    {
                        "id": str(row_id),
                        "url": page_url,
                        "issue_type": "long_meta_description",
                        "severity": "warning",
                        "message": f"Meta description is too long ({desc_len} chars, max 160).",
                        "field": "meta_description",
                        "current_value": meta_description,
                    }
                )
            key = meta_description.strip().lower()
            desc_map.setdefault(key, []).append(page_url)

        # noindex flag
        if noindex:
            issues.append(
                {
                    "id": str(row_id),
                    "url": page_url,
                    "issue_type": "noindex",
                    "severity": "warning",
                    "message": "Page has noindex set — it will not appear in search results.",
                    "field": "noindex",
                    "current_value": str(noindex),
                }
            )

    # Duplicate title detection
    for title_key, pages in title_map.items():
        if len(pages) > 1:
            for page_url in pages:
                issues.append(
                    {
                        "id": None,
                        "url": page_url,
                        "issue_type": "duplicate_meta_title",
                        "severity": "warning",
                        "message": f"Duplicate meta title shared with {len(pages) - 1} other page(s).",
                        "field": "meta_title",
                        "current_value": title_key,
                    }
                )

    # Duplicate description detection
    for desc_key, pages in desc_map.items():
        if len(pages) > 1:
            for page_url in pages:
                issues.append(
                    {
                        "id": None,
                        "url": page_url,
                        "issue_type": "duplicate_meta_description",
                        "severity": "warning",
                        "message": f"Duplicate meta description shared with {len(pages) - 1} other page(s).",
                        "field": "meta_description",
                        "current_value": desc_key[:80],
                    }
                )

    # Summary counts
    total = len(rows)
    critical_count = sum(1 for i in issues if i["severity"] == "critical")
    warning_count = sum(1 for i in issues if i["severity"] == "warning")

    return {
        "configured": True,
        "total_pages_checked": total,
        "total_issues": len(issues),
        "critical_count": critical_count,
        "warning_count": warning_count,
        "issues": issues,
    }
