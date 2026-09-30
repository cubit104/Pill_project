"""Label builds run off the event loop.

build_guide() is async but makes blocking calls (SQLAlchemy, `requests` to DailyMed). Awaited on
uvicorn's single event loop, one slow label stopped every request on the server: on 2026-09-30 a
crawler opening label pages froze the API for minutes, /api/features included. The label routes are
now plain `def` routes (FastAPI runs them on its worker threads) and run the build here, on that
thread with an event loop of its own.

At most GUIDE_BUILDS_AT_ONCE builds run together, and a request past that is refused at once instead
of waiting for a slot: a worker thread held while waiting is a worker the rest of the API needs, so a
burst of label pages must not queue up on them.
"""

import asyncio
import os
import threading
from typing import Any, Callable, Coroutine, TypeVar

from fastapi.responses import JSONResponse

T = TypeVar("T")

GUIDE_BUILDS_AT_ONCE = int(os.getenv("GUIDE_BUILDS_AT_ONCE", "6"))
_slots = threading.BoundedSemaphore(GUIDE_BUILDS_AT_ONCE)


class GuideBusyError(Exception):
    """GUIDE_BUILDS_AT_ONCE builds are already running."""


def run_guide_build(make_build: Callable[[], Coroutine[Any, Any, T]]) -> T:
    """Run one label build to the end on the calling worker thread. Only from a sync (`def`) route."""
    if not _slots.acquire(blocking=False):
        raise GuideBusyError("Too many label builds at once")
    try:
        return asyncio.run(make_build())
    finally:
        _slots.release()


def busy_response() -> JSONResponse:
    """Every build slot is taken: ask the caller to come back rather than queue."""
    return JSONResponse(
        status_code=503,
        content={"error": "Busy loading FDA labels; try again shortly"},
        headers={"Retry-After": "30"},
    )
