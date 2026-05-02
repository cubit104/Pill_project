"""Admin analytics endpoints — GA4, Search Console, PageSpeed Insights, Page Health."""
import logging
import os
import re
import threading
import time
from typing import Optional

import requests
from fastapi import APIRouter, Depends, Query
from sqlalchemy import text

import database
from routes.admin.auth import get_admin_user
from routes.admin.pills import _build_meta_title as _pill_build_meta_title

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/analytics", tags=["admin-analytics"])

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

RANGE_DAYS = {"1d": 1, "7d": 7, "28d": 28, "90d": 90}

# In-memory access-token cache: {"token": str, "expiry": float (epoch seconds)}
_TOKEN_CACHE: dict = {}
_TOKEN_LOCK = threading.Lock()
_TOKEN_EXPIRY_BUFFER = 60  # refresh 60 s before actual expiry

# Separate cache for the Indexing API scope
_INDEXING_TOKEN_CACHE: dict = {}
_INDEXING_TOKEN_LOCK = threading.Lock()


def _not_configured(service: str, instructions: str) -> dict:
    return {"configured": False, "message": f"{service} not configured. {instructions}"}


def _build_oauth2_credentials():
    """Build Google OAuth2 credentials from env vars.

    Returns a ``google.oauth2.credentials.Credentials`` instance ready to use,
    or raises ``RuntimeError`` with a descriptive message if any required var is
    missing.  Access tokens are cached in memory and refreshed automatically.
    """
    client_id = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "")
    client_secret = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "")
    refresh_token = os.getenv("GOOGLE_OAUTH_REFRESH_TOKEN", "")

    missing = [
        name
        for name, val in [
            ("GOOGLE_OAUTH_CLIENT_ID", client_id),
            ("GOOGLE_OAUTH_CLIENT_SECRET", client_secret),
            ("GOOGLE_OAUTH_REFRESH_TOKEN", refresh_token),
        ]
        if not val
    ]
    if missing:
        raise RuntimeError(
            f"Google OAuth2 not configured — missing env var(s): {', '.join(missing)}. "
            "See docs/admin-analytics.md for setup instructions."
        )

    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request

    with _TOKEN_LOCK:
        cached = _TOKEN_CACHE.get("token")
        expiry = _TOKEN_CACHE.get("expiry", 0.0)
        if cached and time.time() < expiry - _TOKEN_EXPIRY_BUFFER:
            # Return cached credentials (token still valid)
            creds = Credentials(
                token=cached,
                refresh_token=refresh_token,
                client_id=client_id,
                client_secret=client_secret,
                token_uri="https://oauth2.googleapis.com/token",
                scopes=[
                    "https://www.googleapis.com/auth/analytics.readonly",
                    "https://www.googleapis.com/auth/webmasters.readonly",
                ],
            )
            return creds

        # Build credentials and force a refresh to get a fresh access token
        creds = Credentials(
            token=None,
            refresh_token=refresh_token,
            client_id=client_id,
            client_secret=client_secret,
            token_uri="https://oauth2.googleapis.com/token",
            scopes=[
                "https://www.googleapis.com/auth/analytics.readonly",
                "https://www.googleapis.com/auth/webmasters.readonly",
            ],
        )
        creds.refresh(Request())
        new_expiry = (
            creds.expiry.timestamp() if creds.expiry else time.time() + 3600
        )
        _TOKEN_CACHE["token"] = creds.token
        _TOKEN_CACHE["expiry"] = new_expiry

    return creds


def _build_indexing_credentials():
    """Build Google OAuth2 credentials scoped for the Indexing API.

    Uses a separate token cache from the Analytics/Search Console credentials
    because the refresh token must have been minted with the
    ``https://www.googleapis.com/auth/indexing`` scope.

    Raises ``RuntimeError`` if any required env var is missing.
    """
    client_id = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "")
    client_secret = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "")
    refresh_token = os.getenv("GOOGLE_OAUTH_REFRESH_TOKEN", "")

    missing = [
        name
        for name, val in [
            ("GOOGLE_OAUTH_CLIENT_ID", client_id),
            ("GOOGLE_OAUTH_CLIENT_SECRET", client_secret),
            ("GOOGLE_OAUTH_REFRESH_TOKEN", refresh_token),
        ]
        if not val
    ]
    if missing:
        raise RuntimeError(
            f"Google OAuth2 not configured — missing env var(s): {', '.join(missing)}. "
            "See docs/admin-analytics.md for setup instructions."
        )

    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request

    with _INDEXING_TOKEN_LOCK:
        cached = _INDEXING_TOKEN_CACHE.get("token")
        expiry = _INDEXING_TOKEN_CACHE.get("expiry", 0.0)
        if cached and time.time() < expiry - _TOKEN_EXPIRY_BUFFER:
            return Credentials(
                token=cached,
                refresh_token=refresh_token,
                client_id=client_id,
                client_secret=client_secret,
                token_uri="https://oauth2.googleapis.com/token",
                scopes=["https://www.googleapis.com/auth/indexing"],
            )

        creds = Credentials(
            token=None,
            refresh_token=refresh_token,
            client_id=client_id,
            client_secret=client_secret,
            token_uri="https://oauth2.googleapis.com/token",
            scopes=["https://www.googleapis.com/auth/indexing"],
        )
        creds.refresh(Request())
        new_expiry = creds.expiry.timestamp() if creds.expiry else time.time() + 3600
        _INDEXING_TOKEN_CACHE["token"] = creds.token
        _INDEXING_TOKEN_CACHE["expiry"] = new_expiry

    return creds


def _get_ga4_property_id():
    """Return the GA4 property ID from env, or None if not set."""
    return os.getenv("GA4_PROPERTY_ID", "") or None


def _get_search_console_site_url():
    """Return the Search Console site URL from env, or None if not set."""
    return os.getenv("SEARCH_CONSOLE_SITE_URL", "") or None


# ─────────────────────────────────────────────────────────────────────────────
# GA4 Overview
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/ga4/overview")
def ga4_overview(
    range: str = Query("28d", pattern="^(1d|7d|28d|90d)$"),
    admin: dict = Depends(get_admin_user),
):
    property_id = _get_ga4_property_id()
    if not property_id:
        return _not_configured(
            "GA4",
            "Set GA4_PROPERTY_ID, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, "
            "and GOOGLE_OAUTH_REFRESH_TOKEN environment variables. "
            "See docs/admin-analytics.md for setup instructions.",
        )

    try:
        from google.analytics.data_v1beta import BetaAnalyticsDataClient
        from google.analytics.data_v1beta.types import (
            DateRange,
            Dimension,
            Metric,
            RunReportRequest,
        )

        credentials = _build_oauth2_credentials()
        client = BetaAnalyticsDataClient(credentials=credentials)

        days = RANGE_DAYS.get(range, 28)
        start_date = "today" if range == "1d" else f"{days}daysAgo"
        date_range = DateRange(start_date=start_date, end_date="today")

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
    range: str = Query("28d", pattern="^(1d|7d|28d|90d)$"),
    admin: dict = Depends(get_admin_user),
):
    site_url = _get_search_console_site_url()
    if not site_url:
        return _not_configured(
            "Search Console",
            "Set SEARCH_CONSOLE_SITE_URL, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, "
            "and GOOGLE_OAUTH_REFRESH_TOKEN environment variables. "
            "See docs/admin-analytics.md for setup instructions.",
        )

    try:
        from googleapiclient.discovery import build
        import datetime

        credentials = _build_oauth2_credentials()
        service = build("searchconsole", "v1", credentials=credentials)

        days = RANGE_DAYS.get(range, 28)
        end = datetime.date.today()
        start = end - datetime.timedelta(days=max(days - 1, 0))

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
# Search Console — Index Coverage (sitemaps)
# ─────────────────────────────────────────────────────────────────────────────

# 1-hour in-memory cache for the indexing endpoint
_INDEXING_CACHE: dict = {}
_INDEXING_CACHE_LOCK = threading.Lock()
_INDEXING_CACHE_TTL = 3600  # seconds


@router.get("/search-console/indexing")
def search_console_indexing(admin: dict = Depends(get_admin_user)):
    site_url = _get_search_console_site_url()
    if not site_url:
        return _not_configured(
            "Search Console",
            "Set SEARCH_CONSOLE_SITE_URL, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, "
            "and GOOGLE_OAUTH_REFRESH_TOKEN environment variables. "
            "See docs/admin-analytics.md for setup instructions.",
        )

    with _INDEXING_CACHE_LOCK:
        cached = _INDEXING_CACHE.get("data")
        cached_at = _INDEXING_CACHE.get("cached_at", 0.0)
        if cached is not None and time.time() - cached_at < _INDEXING_CACHE_TTL:
            return cached

    try:
        from googleapiclient.discovery import build
        import datetime

        credentials = _build_oauth2_credentials()
        service = build("searchconsole", "v1", credentials=credentials)

        result = service.sitemaps().list(siteUrl=site_url).execute()
        sitemaps = result.get("sitemap", [])

        def _get_first_sitemap_content(s: dict) -> dict:
            """Return the first content entry from a sitemap object, or an empty dict."""
            contents = s.get("contents") or []
            return contents[0] if contents else {}

        total_submitted = sum(
            int(_get_first_sitemap_content(s).get("submitted", 0)) for s in sitemaps
        )
        sitemaps_indexed = sum(
            int(_get_first_sitemap_content(s).get("indexed", 0)) for s in sitemaps
        )

        # Count distinct pages with impressions in last ~16 months (max GSC retention).
        # Pages that have appeared in search results are definitionally indexed by Google,
        # making this a live and accurate count unlike the stale sitemaps API indexed field.
        # A separate try/except isolates this call so that quota errors or transient
        # failures fall back to the sitemaps API indexed value rather than failing the
        # whole endpoint.
        try:
            end = datetime.date.today()
            start = end - datetime.timedelta(days=480)  # ~16 months (480 days), max GSC retention
            _PAGE_LIMIT = 25000  # GSC API hard limit per request
            analytics_page_count = 0
            start_row = 0
            while True:
                page = (
                    service.searchanalytics()
                    .query(
                        siteUrl=site_url,
                        body={
                            "startDate": start.isoformat(),
                            "endDate": end.isoformat(),
                            "dimensions": ["page"],
                            "rowLimit": _PAGE_LIMIT,
                            "startRow": start_row,
                        },
                    )
                    .execute()
                    .get("rows", [])
                )
                analytics_page_count += len(page)
                if len(page) < _PAGE_LIMIT:
                    break
                start_row += _PAGE_LIMIT
            total_indexed = analytics_page_count if analytics_page_count > 0 else sitemaps_indexed
        except Exception as analytics_exc:
            logger.warning(
                f"GSC Search Analytics query failed, falling back to sitemaps indexed count: {analytics_exc}"
            )
            total_indexed = sitemaps_indexed

        response = {
            "configured": True,
            "submitted": total_submitted,
            "indexed": total_indexed,
            "not_indexed": max(0, total_submitted - total_indexed),
            "sitemaps": [
                {
                    "path": s.get("path"),
                    "submitted": int(_get_first_sitemap_content(s).get("submitted", 0)),
                    "indexed": int(_get_first_sitemap_content(s).get("indexed", 0)),
                    "last_submitted": s.get("lastSubmitted"),
                    "last_downloaded": s.get("lastDownloaded"),
                    "is_sitemaps_index": s.get("isSitemapsIndex", False),
                    "warnings": int(s.get("warnings", 0)),
                    "errors": int(s.get("errors", 0)),
                }
                for s in sitemaps
            ],
        }

        with _INDEXING_CACHE_LOCK:
            _INDEXING_CACHE["data"] = response
            _INDEXING_CACHE["cached_at"] = time.time()

        return response
    except Exception as exc:
        logger.error(f"GSC indexing error: {exc}", exc_info=True)
        return {"configured": True, "error": str(exc)}


# ─────────────────────────────────────────────────────────────────────────────
# Search Console — URL Inspection
# ─────────────────────────────────────────────────────────────────────────────


@router.post("/search-console/inspect-url")
def inspect_url(body: dict, admin: dict = Depends(get_admin_user)):
    site_url = _get_search_console_site_url()
    if not site_url:
        return _not_configured(
            "Search Console",
            "Set SEARCH_CONSOLE_SITE_URL, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, "
            "and GOOGLE_OAUTH_REFRESH_TOKEN environment variables. "
            "See docs/admin-analytics.md for setup instructions.",
        )

    url = body.get("url", "").strip()
    if not url:
        return {"configured": True, "error": "url is required"}

    # Validate the URL belongs to the configured site to prevent quota abuse
    from urllib.parse import urlparse
    site_host = urlparse(site_url).hostname or ""
    url_host = urlparse(url).hostname or ""
    if site_host and url_host != site_host:
        return {"configured": True, "error": f"URL hostname '{url_host}' does not match the configured site '{site_host}'"}

    try:
        from googleapiclient.discovery import build

        credentials = _build_oauth2_credentials()
        service = build("searchconsole", "v1", credentials=credentials)

        result = service.urlInspection().index().inspect(
            body={
                "inspectionUrl": url,
                "siteUrl": site_url,
            }
        ).execute()

        inspection = result.get("inspectionResult", {})
        index_status = inspection.get("indexStatusResult", {})
        mobile = inspection.get("mobileUsabilityResult", {})

        return {
            "configured": True,
            "url": url,
            "verdict": index_status.get("verdict"),
            "coverage_state": index_status.get("coverageState"),
            "robots_txt_state": index_status.get("robotsTxtState"),
            "indexing_state": index_status.get("indexingState"),
            "last_crawl_time": index_status.get("lastCrawlTime"),
            "page_fetch_state": index_status.get("pageFetchState"),
            "google_canonical": index_status.get("googleCanonical"),
            "user_canonical": index_status.get("userCanonical"),
            "mobile_usability_verdict": mobile.get("verdict"),
            "sitemap": index_status.get("sitemap", []),
            "referring_urls": index_status.get("referringUrls", []),
        }
    except Exception as exc:
        logger.error(f"URL inspection error: {exc}", exc_info=True)
        return {"configured": True, "error": str(exc)}


# ─────────────────────────────────────────────────────────────────────────────
# Search Console — Submit URL for Indexing
# ─────────────────────────────────────────────────────────────────────────────


@router.post("/search-console/submit-indexing")
def submit_url_for_indexing(body: dict, admin: dict = Depends(get_admin_user)):
    """Submit a URL to the Google Indexing API and record the submission."""
    from urllib.parse import urlparse

    url = (body.get("url") or "").strip()
    if not url:
        return {"configured": True, "error": "url is required"}

    # Only allow http(s) URLs
    parsed_url = urlparse(url)
    if parsed_url.scheme not in ("http", "https"):
        return {"configured": True, "error": "url must be an http or https URL"}

    # Validate the URL belongs to the configured site to prevent quota abuse
    site_url = _get_search_console_site_url()
    if site_url:
        site_host = urlparse(site_url).hostname or ""
        url_host = parsed_url.hostname or ""
        if site_host and url_host != site_host:
            return {
                "configured": True,
                "error": f"URL hostname '{url_host}' does not match the configured site '{site_host}'",
            }

    try:
        credentials = _build_indexing_credentials()
    except Exception as exc:
        return _not_configured("Google Indexing API", str(exc))

    indexing_endpoint = "https://indexing.googleapis.com/v3/urlNotifications:publish"
    payload = {"url": url, "type": "URL_UPDATED"}

    response_status = None
    response_raw: dict = {}
    try:
        import google.auth.transport.requests as ga_requests

        auth_req = ga_requests.Request()
        credentials.refresh(auth_req)
        access_token = credentials.token

        resp = requests.post(
            indexing_endpoint,
            json=payload,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            timeout=15,
        )
        response_status = str(resp.status_code)
        # Defensively parse JSON — non-JSON error bodies (e.g. HTML 5xx pages) must not crash
        try:
            response_raw = resp.json() if resp.content else {}
        except ValueError:
            response_raw = {"raw_text": resp.text[:500]}

        # Store the submission regardless of HTTP status
        _record_indexing_submission(
            url=url,
            submitted_by=admin.get("id"),
            response_status=response_status,
            response_raw=response_raw,
        )

        if not resp.ok:
            error_obj = response_raw.get("error", {})
            if isinstance(error_obj, dict):
                error_msg = error_obj.get("message", resp.text[:200])
            else:
                error_msg = str(error_obj)[:200]
            return {"configured": True, "submitted": False, "status": response_status, "url": url, "error": error_msg}

        return {"configured": True, "submitted": True, "status": response_status, "url": url}
    except Exception as exc:
        logger.error(f"submit_url_for_indexing error: {exc}", exc_info=True)
        # Still try to record the failure
        _record_indexing_submission(
            url=url,
            submitted_by=admin.get("id"),
            response_status=response_status or "error",
            response_raw={"error": str(exc)},
        )
        return {"configured": True, "submitted": False, "error": str(exc), "url": url}


def _record_indexing_submission(
    url: str,
    submitted_by: Optional[str],
    response_status: Optional[str],
    response_raw: dict,
) -> None:
    """Insert a row into google_indexing_submissions. Silently ignores errors."""
    import json as _json

    try:
        if not database.db_engine:
            database.connect_to_database()
        with database.db_engine.connect() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO google_indexing_submissions
                        (url, submitted_by, response_status, response_raw)
                    VALUES
                        (:url, :submitted_by, :response_status, CAST(:response_raw AS jsonb))
                    """
                ),
                {
                    "url": url,
                    "submitted_by": submitted_by,
                    "response_status": response_status,
                    "response_raw": _json.dumps(response_raw),
                },
            )
            conn.commit()
    except Exception as exc:
        logger.warning(f"_record_indexing_submission failed (non-fatal): {exc}")


# ─────────────────────────────────────────────────────────────────────────────
# Search Console — Indexing Stats
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/search-console/indexing-stats")
def indexing_stats(admin: dict = Depends(get_admin_user)):
    """Return aggregate counts from google_indexing_submissions."""
    try:
        if not database.db_engine:
            database.connect_to_database()
        with database.db_engine.connect() as conn:
            row = conn.execute(
                text(
                    """
                    SELECT
                        COUNT(*)                                                          AS total_submitted,
                        COUNT(*) FILTER (WHERE submitted_at >= date_trunc('month', now())) AS this_month,
                        COUNT(DISTINCT url)                                               AS unique_pages
                    FROM google_indexing_submissions
                    """
                )
            ).fetchone()
        if row:
            return {
                "total_submitted": int(row[0] or 0),
                "this_month": int(row[1] or 0),
                "unique_pages": int(row[2] or 0),
            }
    except Exception as exc:
        logger.warning(f"indexing_stats query failed (non-fatal): {exc}")
    return {"total_submitted": 0, "this_month": 0, "unique_pages": 0}


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
            params={"url": url, "strategy": strategy, "key": api_key, "category": ["PERFORMANCE", "SEO", "ACCESSIBILITY", "BEST_PRACTICES"]},
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
# GA4 Visitor Locations
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/ga4/visitor-ips")
def ga4_visitor_ips(
    range: str = Query("28d", pattern="^(1d|7d|28d|90d)$"),
    admin: dict = Depends(get_admin_user),
):
    property_id = _get_ga4_property_id()
    if not property_id:
        return _not_configured("GA4", "Set GA4_PROPERTY_ID and Google OAuth2 env vars. See docs/admin-analytics.md for setup instructions.")
    try:
        from google.analytics.data_v1beta import BetaAnalyticsDataClient
        from google.analytics.data_v1beta.types import DateRange, Dimension, Metric, RunReportRequest
        credentials = _build_oauth2_credentials()
        client = BetaAnalyticsDataClient(credentials=credentials)
        days = RANGE_DAYS.get(range, 28)
        start_date = "today" if range == "1d" else f"{days}daysAgo"
        req = RunReportRequest(
            property=f"properties/{property_id}",
            date_ranges=[DateRange(start_date=start_date, end_date="today")],
            dimensions=[Dimension(name="city"), Dimension(name="region"), Dimension(name="country")],
            metrics=[Metric(name="totalUsers"), Metric(name="sessions")],
            limit=100,
            order_bys=[{"metric": {"metric_name": "sessions"}, "desc": True}],
        )
        resp = client.run_report(req)
        rows = [
            {
                "city": r.dimension_values[0].value,
                "region": r.dimension_values[1].value,
                "country": r.dimension_values[2].value,
                "users": int(float(r.metric_values[0].value)),
                "sessions": int(float(r.metric_values[1].value)),
            }
            for r in resp.rows
        ]
        return {"configured": True, "range": range, "locations": rows}
    except Exception as exc:
        logger.error(f"GA4 visitor locations error: {exc}", exc_info=True)
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
                        splcolor_text,
                        splshape_text,
                        spl_strength,
                        splimprint
                    FROM pillfinder
                    WHERE deleted_at IS NULL
                    ORDER BY id
                    LIMIT 5000
                    """
                )
            ).fetchall()
    except Exception as exc:
        # meta_title / meta_description columns may not exist yet — fall back
        logger.warning(f"page_health full query failed ({exc}), falling back to basic columns")
        try:
            with database.db_engine.connect() as conn:
                rows = conn.execute(
                    text(
                        """
                        SELECT id, slug, medicine_name,
                               NULL AS meta_title,
                               NULL AS meta_description,
                               NULL AS splcolor_text,
                               NULL AS splshape_text,
                               NULL AS spl_strength,
                               NULL AS splimprint
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
        row_values = tuple(row)
        if len(row_values) < 9:
            row_values = row_values + (None,) * (9 - len(row_values))
        row_id, slug, medicine_name, meta_title, meta_description, \
            splcolor_text, splshape_text, spl_strength, splimprint = row_values[:9]
        page_url = f"/pill/{slug}" if slug else f"/pill/{row_id}"

        # Garbage drug name (data quality)
        if _is_garbage_drug_name(medicine_name or ""):
            issues.append(
                {
                    "id": str(row_id),
                    "url": page_url,
                    "issue_type": "garbage_drug_name",
                    "severity": "critical",
                    "message": f'Drug name looks like raw ingredient data: "{(medicine_name or "")[:80]}"',
                    "field": "medicine_name",
                    "current_value": medicine_name,
                }
            )
            continue  # Skip SEO checks for garbage-name pages

        # Compute effective title: use stored meta_title or fall back to auto-generated
        effective_title = (meta_title or "").strip() or _pill_build_meta_title({
            "splcolor_text": splcolor_text,
            "splshape_text": splshape_text,
            "medicine_name": medicine_name,
            "spl_strength": spl_strength,
            "splimprint": splimprint,
        })

        # Missing meta_title
        if not effective_title:
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
            title_len = len(effective_title)
            if title_len < 30:
                issues.append(
                    {
                        "id": str(row_id),
                        "url": page_url,
                        "issue_type": "short_meta_title",
                        "severity": "warning",
                        "message": f"Meta title is too short ({title_len} chars, min 30).",
                        "field": "meta_title",
                        "current_value": effective_title,
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
                        "current_value": effective_title,
                    }
                )
            # Accumulate for dup detection
            key = effective_title.strip().lower()
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
