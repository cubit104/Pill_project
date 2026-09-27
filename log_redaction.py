"""Keep API keys out of the logs.

httpx logs every outside call with its full URL, and some services take the key in the
query string (openFDA ?api_key=, Google ?key=). The key would then land in Render's logs,
in the line itself and in error tracebacks (an httpx error quotes the URL).
"""

import logging
import re

_SECRET_PARAM = re.compile(r"([?&](?:api_key|apikey|key|token|access_token)=)[^&\s\"']+", re.IGNORECASE)


def redact(text: str) -> str:
    return _SECRET_PARAM.sub(r"\1***", text)


class SecretRedactingFormatter(logging.Formatter):
    """Wraps a handler's formatter; secret query-string values become *** in the finished text, traceback included."""

    def __init__(self, inner: logging.Formatter | None = None) -> None:
        super().__init__()
        self.inner = inner or logging.Formatter()

    def format(self, record: logging.LogRecord) -> str:
        return redact(self.inner.format(record))


def install_secret_redaction() -> None:
    """On the root handlers, and on uvicorn's own: uvicorn logs a request's unhandled error through its handler."""
    for name in ("", "uvicorn", "uvicorn.error", "uvicorn.access"):
        for handler in logging.getLogger(name).handlers:
            if not isinstance(handler.formatter, SecretRedactingFormatter):
                handler.setFormatter(SecretRedactingFormatter(handler.formatter))
