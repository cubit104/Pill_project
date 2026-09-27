import logging
import sys

from log_redaction import SecretRedactingFormatter, install_secret_redaction


def _logged(msg, *args, exc_info=None):
    record = logging.LogRecord("httpx", logging.INFO, __file__, 1, msg, args, exc_info)
    return SecretRedactingFormatter(logging.Formatter("%(levelname)s %(message)s")).format(record)


def test_openfda_key_in_an_httpx_line_is_hidden():
    line = _logged(
        'HTTP Request: %s %s "%s %d %s"',
        "GET",
        "https://api.fda.gov/drug/label.json?search=openfda.product_ndc%3A%2200527%22&limit=1&api_key=SECRET123",
        "HTTP/1.1",
        429,
        "Too Many Requests",
    )
    assert "SECRET123" not in line
    assert "api_key=***" in line
    assert "search=openfda.product_ndc%3A%2200527%22&limit=1" in line
    assert '"HTTP/1.1 429 Too Many Requests"' in line


def test_key_in_an_error_traceback_is_hidden():
    try:
        try:
            raise ValueError(
                "Client error '429 Too Many Requests' for url 'https://api.fda.gov/drug/label.json?limit=1&api_key=SECRET123'"
            )
        except ValueError as exc:
            raise RuntimeError("openFDA request failed") from exc
    except RuntimeError:
        text = _logged("guide build failed", exc_info=sys.exc_info())
    assert "Traceback" in text and "direct cause" in text
    assert "SECRET123" not in text
    assert "api_key=***" in text


def test_google_key_and_lines_without_secrets():
    assert _logged("GET https://maps.googleapis.com/maps/api/place?key=K3Y&query=a") == (
        "INFO GET https://maps.googleapis.com/maps/api/place?key=***&query=a"
    )
    assert _logged("GET https://example.com/?monkey=1&keyword=aspirin") == "INFO GET https://example.com/?monkey=1&keyword=aspirin"
    assert _logged("nothing to hide in %s", "here") == "INFO nothing to hide in here"


def test_install_wraps_each_handler_once():
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    root = logging.getLogger()
    root.addHandler(handler)
    try:
        install_secret_redaction()
        install_secret_redaction()
        assert isinstance(handler.formatter, SecretRedactingFormatter)
        assert not isinstance(handler.formatter.inner, SecretRedactingFormatter)
    finally:
        root.removeHandler(handler)
