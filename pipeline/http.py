"""HTTP helpers: one shared session, polite rate limiting, retries.

The SEC requires a descriptive User-Agent (https://www.sec.gov/os/accessing-edgar-data)
and caps traffic at 10 requests/second. We stay well below that.
"""
from __future__ import annotations

import os
import time
from typing import Optional

import requests

DEFAULT_SEC_UA = "matissebrg-terminal/1.0 (+https://github.com/matissebrg/terminal)"
BROWSER_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)

_session: Optional[requests.Session] = None
_last_call: dict[str, float] = {}


def session() -> requests.Session:
    global _session
    if _session is None:
        _session = requests.Session()
    return _session


def sec_user_agent() -> str:
    ua = os.environ.get("SEC_USER_AGENT", "").strip()
    return ua or DEFAULT_SEC_UA


def get(url: str, *, host_key: str, min_interval: float = 0.15, headers: dict | None = None,
        params: dict | None = None, retries: int = 3, timeout: float = 30.0) -> requests.Response:
    """GET with per-host throttling and exponential backoff on 429/5xx."""
    last_exc: Exception | None = None
    for attempt in range(retries):
        wait = _last_call.get(host_key, 0) + min_interval - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _last_call[host_key] = time.monotonic()
        try:
            r = session().get(url, headers=headers or {}, params=params, timeout=timeout)
        except requests.RequestException as exc:  # network error -> retry
            last_exc = exc
            time.sleep(1.5 * (attempt + 1))
            continue
        if r.status_code in (429, 500, 502, 503, 504):
            last_exc = requests.HTTPError(f"{r.status_code} for {url}")
            time.sleep(2.0 * (attempt + 1))
            continue
        r.raise_for_status()
        return r
    raise last_exc or RuntimeError(f"GET failed: {url}")


def sec_get_json(url: str) -> dict:
    r = get(url, host_key="sec", min_interval=0.15,
            headers={"User-Agent": sec_user_agent(), "Accept-Encoding": "gzip, deflate"})
    return r.json()
