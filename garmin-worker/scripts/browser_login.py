#!/usr/bin/env python3
"""
Garmin Browser Login — get OAuth tokens via a real browser login.

Vendored from sidequest-scribe/garmin-browser-login (MIT), reviewed line by
line. Garmin 429s all garth mobile-endpoint logins since 2026-03; this drives
the web-widget flow in a real Chromium window instead. Credentials are typed
into garmin.com directly — the script only captures the resulting SSO ticket.

Opens a Chromium window, you log in manually, script captures the SSO ticket
and exchanges it for garth-compatible OAuth tokens. No credentials stored.

Usage:
    python garmin_login.py
    python garmin_login.py --output ~/.garmin_tokens
    python garmin_login.py --output ~/.garmin_tokens --verify
"""

import argparse
import json
import os
import re
import time
from urllib.parse import parse_qs

import requests
from requests_oauthlib import OAuth1Session
from playwright.sync_api import sync_playwright

# Public OAuth consumer credentials (from garth project).
# These are the same for everyone — not a secret.
OAUTH_CONSUMER = {
    "consumer_key": "fc3e99d2-118c-44b8-8ae3-03370dde24c0",
    "consumer_secret": "E08WAR897WEy2knn7aFBrvegVAf0AFdWBBF",
}

DEFAULT_TOKEN_DIR = os.path.join(os.path.expanduser("~"), ".garmin_tokens")

SSO_URL = (
    "https://sso.garmin.com/sso/embed"
    "?id=gauth-widget"
    "&embedWidget=true"
    "&gauthHost=https://sso.garmin.com/sso"
    "&clientId=GarminConnect"
    "&locale=en_US"
    "&redirectAfterAccountLoginUrl=https://sso.garmin.com/sso/embed"
    "&service=https://sso.garmin.com/sso/embed"
)


def browser_login():
    """Open a real browser, let user log in, capture the SSO ticket."""
    ticket = None
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        page = browser.new_context().new_page()
        page.goto(SSO_URL)

        print()
        print("  ┌─────────────────────────────────────────┐")
        print("  │  Browser opened — log in with your      │")
        print("  │  Garmin credentials.                    │")
        print("  │  Window closes automatically when done. │")
        print("  └─────────────────────────────────────────┘")
        print()

        start = time.time()
        while time.time() - start < 300:  # 5 min timeout
            try:
                content = page.content()
                m = re.search(r'ticket=(ST-[A-Za-z0-9\-]+)', content)
                if m:
                    ticket = m.group(1)
                    break
                url = page.url
                if "ticket=" in url:
                    m = re.search(r'ticket=(ST-[A-Za-z0-9\-]+)', url)
                    if m:
                        ticket = m.group(1)
                        break
            except Exception:
                pass
            page.wait_for_timeout(500)
        browser.close()

    if not ticket:
        print("Timed out waiting for login (5 min). Try again.")
        raise SystemExit(1)
    return ticket


def exchange_oauth1(ticket):
    """Exchange SSO ticket for OAuth1 token."""
    sess = OAuth1Session(
        OAUTH_CONSUMER["consumer_key"],
        OAUTH_CONSUMER["consumer_secret"],
    )
    url = (
        f"https://connectapi.garmin.com/oauth-service/oauth/"
        f"preauthorized?ticket={ticket}"
        f"&login-url=https://sso.garmin.com/sso/embed"
        f"&accepts-mfa-tokens=true"
    )
    resp = sess.get(url, timeout=15)
    resp.raise_for_status()
    parsed = parse_qs(resp.text)
    token = {k: v[0] for k, v in parsed.items()}
    token["domain"] = "garmin.com"
    token["mfa_token"] = token.get("mfa_token")
    token["mfa_expiration_timestamp"] = token.get("mfa_expiration_timestamp")
    return token


def exchange_oauth2(oauth1):
    """Exchange OAuth1 token for OAuth2 token."""
    sess = OAuth1Session(
        OAUTH_CONSUMER["consumer_key"],
        OAUTH_CONSUMER["consumer_secret"],
        resource_owner_key=oauth1["oauth_token"],
        resource_owner_secret=oauth1["oauth_token_secret"],
    )
    data = {}
    if oauth1.get("mfa_token"):
        data["mfa_token"] = oauth1["mfa_token"]
    resp = sess.post(
        "https://connectapi.garmin.com/oauth-service/oauth/exchange/user/2.0",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        data=data,
        timeout=15,
    )
    resp.raise_for_status()
    token = resp.json()
    token["expires_at"] = int(time.time() + token["expires_in"])
    token["refresh_token_expires_at"] = int(
        time.time() + token["refresh_token_expires_in"]
    )
    return token


def verify_tokens(oauth2):
    """Quick check that the tokens actually work."""
    resp = requests.get(
        "https://connectapi.garmin.com/userprofile-service/socialProfile",
        headers={"Authorization": f"Bearer {oauth2['access_token']}"},
        timeout=15,
    )
    resp.raise_for_status()
    profile = resp.json()
    return profile.get("displayName", "unknown")


def save_tokens(output_dir, oauth1, oauth2):
    """Write garth-compatible token files."""
    os.makedirs(output_dir, exist_ok=True)
    with open(os.path.join(output_dir, "oauth1_token.json"), "w") as f:
        json.dump(oauth1, f, indent=2)
    with open(os.path.join(output_dir, "oauth2_token.json"), "w") as f:
        json.dump(oauth2, f, indent=2)


def main():
    parser = argparse.ArgumentParser(
        description="Get Garmin OAuth tokens via browser login"
    )
    parser.add_argument(
        "--output", default=DEFAULT_TOKEN_DIR,
        help=f"Token output directory (default: {DEFAULT_TOKEN_DIR})"
    )
    parser.add_argument(
        "--verify", action="store_true",
        help="Verify tokens against Garmin API after saving"
    )
    args = parser.parse_args()

    print("Garmin Browser Login")
    print("=" * 45)

    # Step 1: Browser login
    print("Launching browser...")
    ticket = browser_login()
    print(f"  Got SSO ticket")

    # Step 2: OAuth1
    print("Exchanging for OAuth1 token...")
    oauth1 = exchange_oauth1(ticket)
    print(f"  Done")

    # Step 3: OAuth2
    print("Exchanging for OAuth2 token...")
    oauth2 = exchange_oauth2(oauth1)
    print(f"  access_token expires in: {round(oauth2['expires_in'] / 3600)}h")
    print(f"  refresh_token expires in: {round(oauth2['refresh_token_expires_in'] / 86400)}d")

    # Step 4: Save
    save_tokens(args.output, oauth1, oauth2)
    print(f"\nTokens saved to: {args.output}")

    # Step 5: Verify (optional)
    if args.verify:
        print("Verifying tokens...")
        name = verify_tokens(oauth2)
        print(f"  Authenticated as: {name}")

    print("\nDone! See README for how to use these tokens.")


if __name__ == "__main__":
    main()
