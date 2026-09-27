import logging

from log_redaction import SecretRedactingFilter


def _logged(msg, *args):
    record = logging.LogRecord("httpx", logging.INFO, __file__, 1, msg, args, None)
    assert SecretRedactingFilter().filter(record) is True
    return record.getMessage()


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


def test_google_key_and_lines_without_secrets():
    assert _logged("GET https://maps.googleapis.com/maps/api/place?key=K3Y&query=a") == (
        "GET https://maps.googleapis.com/maps/api/place?key=***&query=a"
    )
    assert _logged("GET https://example.com/?monkey=1&keyword=aspirin") == "GET https://example.com/?monkey=1&keyword=aspirin"
    assert _logged("nothing to hide in %s", "here") == "nothing to hide in here"
