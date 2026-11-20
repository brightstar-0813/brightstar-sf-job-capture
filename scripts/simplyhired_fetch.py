"""
SimplyHired remote search via curl_cffi (Safari iOS TLS fingerprint).
Plain Node fetch / Playwright get a Cloudflare 403; this impersonation passes.

Usage:
  python scripts/simplyhired_fetch.py --queries "Salesforce Developer,Salesforce Administrator" --pages 2 --days 7

Prints one JSON object to stdout:
  {"jobs": [...raw pageProps.jobs items + "_query"...], "blocked": bool, "errors": [...]}
Exit code 3 when every request was blocked, 2 when curl_cffi is missing.
"""

import argparse
import json
import re
import sys
import time
from urllib.parse import urlencode

try:
    from curl_cffi import requests as cffi
except ImportError:
    print(json.dumps({"jobs": [], "blocked": False, "errors": ["curl_cffi not installed"]}))
    sys.exit(2)

NEXT_DATA_RE = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)
BLOCK_MARKERS = ("Just a moment", "cf-chl", "captcha-delivery")


def fetch_page(session, query, days, cursor=None, page=1):
    params = {"q": query, "l": "remote", "t": str(days)}
    if cursor:
        params["cursor"] = cursor
        params["pn"] = str(page)
    url = "https://www.simplyhired.com/search?" + urlencode(params)
    res = session.get(url, timeout=30)
    text = res.text
    if res.status_code in (403, 429) or any(m in text[:5000] for m in BLOCK_MARKERS):
        return None, True, f"HTTP {res.status_code} blocked: {query} p{page}"
    if res.status_code != 200:
        return None, False, f"HTTP {res.status_code}: {query} p{page}"
    m = NEXT_DATA_RE.search(text)
    if not m:
        return None, False, f"no __NEXT_DATA__: {query} p{page}"
    try:
        pp = json.loads(m.group(1)).get("props", {}).get("pageProps", {})
    except ValueError as e:
        return None, False, f"bad JSON: {query} p{page}: {e}"
    return pp, False, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--queries", required=True, help="comma-separated search terms")
    ap.add_argument("--pages", type=int, default=2)
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--delay", type=float, default=0.8)
    args = ap.parse_args()

    queries = [q.strip() for q in args.queries.split(",") if q.strip()]
    session = cffi.Session(impersonate="safari_ios")
    jobs, errors = [], []
    requests_ok = 0
    blocked_count = 0

    for q in queries:
        cursor = None
        for page in range(1, max(1, args.pages) + 1):
            try:
                pp, blocked, err = fetch_page(session, q, args.days, cursor, page)
            except Exception as e:  # network / TLS errors
                pp, blocked, err = None, False, f"{type(e).__name__}: {e}"
            if err:
                errors.append(err)
            if blocked:
                blocked_count += 1
            if pp is None:
                break
            requests_ok += 1
            batch = pp.get("jobs") or []
            for j in batch:
                j["_query"] = q
                jobs.append(j)
            cursor = (pp.get("pageCursors") or {}).get(str(page + 1))
            if not cursor or not batch:
                break
            time.sleep(args.delay)
        time.sleep(args.delay)

    all_blocked = requests_ok == 0 and blocked_count > 0
    print(json.dumps({"jobs": jobs, "blocked": all_blocked, "errors": errors[:20]}))
    sys.exit(3 if all_blocked else 0)


if __name__ == "__main__":
    main()
