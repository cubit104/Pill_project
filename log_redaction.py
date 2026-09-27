"""Keep API keys out of the logs.

httpx logs every outside call with its full URL, and some services take the key in the
query string (openFDA ?api_key=, Google ?key=), so the key would land in Render's logs.
"""

import logging
import re

_SECRET_PARAM = re.compile(r"([?&](?:api_key|apikey|key|token|access_token)=)[^&\s\"']+", re.IGNORECASE)


class SecretRedactingFilter(logging.Filter):
    """Replace secret query-string values in a log line with ***."""

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        redacted = _SECRET_PARAM.sub(r"\1***", message)
        if redacted != message:
            record.msg, record.args = redacted, ()
        return True


def install_secret_redaction() -> None:
    """On every root handler, so records from all loggers (httpx included) pass through it."""
    for handler in logging.getLogger().handlers:
        handler.addFilter(SecretRedactingFilter())
