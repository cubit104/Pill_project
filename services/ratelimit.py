"""Tiny in-process, per-client rate limiter for public endpoints that trigger
outbound work (registry fan-outs, CMS and Google lookups). One Render instance,
so a process-local table is enough; it is bounded and self-pruning.
"""
from __future__ import annotations

import threading
import time
from typing import Dict, List

from fastapi import HTTPException, Request

_lock = threading.Lock()
_hits: Dict[str, List[float]] = {}
WINDOW_S = 3600


def client_ip(request: Request) -> str:
    """Cloudflare's CF-Connecting-IP when present; else the last X-Forwarded-For hop
    (added by our own proxy; earlier hops are client-controlled); else the socket."""
    cf = request.headers.get("cf-connecting-ip", "").strip()
    if cf:
        return cf
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


def check(request: Request, bucket: str, per_hour: int, detail: str = "Too many requests; please try again later.") -> None:
    """Count one hit for (bucket, client); raise 429 past `per_hour` in the last hour."""
    key = f"{bucket}:{client_ip(request)}"
    now = time.time()
    with _lock:
        hits = [t for t in _hits.get(key, []) if now - t < WINDOW_S]
        if len(hits) >= per_hour:
            raise HTTPException(status_code=429, detail=detail)
        hits.append(now)
        _hits[key] = hits
        if len(_hits) > 20000:
            for k in [k for k, v in _hits.items() if not v or now - v[-1] > WINDOW_S]:
                _hits.pop(k, None)


def reset() -> None:
    """Tests only."""
    with _lock:
        _hits.clear()
