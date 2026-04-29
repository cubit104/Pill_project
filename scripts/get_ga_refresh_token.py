"""One-time helper to obtain a Google OAuth2 refresh token for the GA4, Search Console,
and Google Indexing API integrations.

Usage
-----
Run this script ONCE locally (not in production) to authorise your Google account and
obtain a long-lived refresh token.  The token is printed to stdout; copy it into your
production environment as ``GOOGLE_OAUTH_REFRESH_TOKEN``.

Prerequisites
-------------
1. Create OAuth 2.0 credentials in Google Cloud Console:
   - Go to APIs & Services → Credentials → Create credentials → OAuth client ID.
   - Application type: **Desktop app** (easiest) or Web app with
     ``http://localhost`` as an authorised redirect URI.
   - Note the **Client ID** and **Client Secret**.

2. Enable the following APIs in your Cloud project:
   - Google Analytics Data API (for GA4)
   - Google Search Console API (for GSC)
   - Web Search Indexing API (for the Google Indexing API)

3. Export (or pass via ``--client-id`` / ``--client-secret``) your credentials:
       export GOOGLE_OAUTH_CLIENT_ID=your-client-id
       export GOOGLE_OAUTH_CLIENT_SECRET=your-client-secret
       python scripts/get_ga_refresh_token.py

The script will open a browser window for you to consent.  After consent it prints
the refresh token — add it to your production env as ``GOOGLE_OAUTH_REFRESH_TOKEN``.

Scopes requested
----------------
- ``analytics.readonly``  — GA4 Data API read access
- ``webmasters.readonly`` — Search Console read access
- ``indexing``            — Google Indexing API (submit URLs for crawling)

All three scopes are bundled into a single token so that one ``GOOGLE_OAUTH_REFRESH_TOKEN``
env var covers every Google integration in this project.
"""

import argparse
import os
import sys


def main():
    parser = argparse.ArgumentParser(
        description="Obtain a Google OAuth2 refresh token for the GA4 / Search Console integration.",
    )
    parser.add_argument(
        "--client-id",
        default=os.getenv("GOOGLE_OAUTH_CLIENT_ID", ""),
        help="OAuth2 client ID (defaults to GOOGLE_OAUTH_CLIENT_ID env var)",
    )
    parser.add_argument(
        "--client-secret",
        default=os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", ""),
        help="OAuth2 client secret (defaults to GOOGLE_OAUTH_CLIENT_SECRET env var)",
    )
    args = parser.parse_args()

    if not args.client_id or not args.client_secret:
        print(
            "ERROR: GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be set "
            "(via env vars or --client-id / --client-secret flags).",
            file=sys.stderr,
        )
        sys.exit(1)

    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError:
        print(
            "ERROR: google-auth-oauthlib is not installed.  Run:\n"
            "  pip install google-auth-oauthlib",
            file=sys.stderr,
        )
        sys.exit(1)

    scopes = [
        "https://www.googleapis.com/auth/analytics.readonly",
        "https://www.googleapis.com/auth/webmasters.readonly",
        "https://www.googleapis.com/auth/indexing",  # Google Indexing API
    ]

    client_config = {
        "installed": {
            "client_id": args.client_id,
            "client_secret": args.client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": ["http://localhost"],
        }
    }

    flow = InstalledAppFlow.from_client_config(client_config, scopes=scopes)
    # access_type=offline ensures we get a refresh token; prompt=consent forces
    # Google to return a new refresh token even if the user previously consented.
    creds = flow.run_local_server(
        port=0,
        access_type="offline",
        prompt="consent",
    )

    if not creds.refresh_token:
        print(
            "ERROR: No refresh token returned.  Make sure you requested "
            "access_type='offline' and prompt='consent'.",
            file=sys.stderr,
        )
        sys.exit(1)

    print("\n✅  Refresh token obtained successfully!\n")
    print(f"GOOGLE_OAUTH_REFRESH_TOKEN={creds.refresh_token}\n")
    print(
        "Copy the line above into your production environment variables, then restart the service."
    )


if __name__ == "__main__":
    main()
