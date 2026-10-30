"""SEC EDGAR client (free, official, no API key).

Endpoints used:
  - https://www.sec.gov/files/company_tickers.json          ticker -> CIK
  - https://data.sec.gov/submissions/CIK##########.json      filing list
  - https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json   all XBRL facts
"""
from __future__ import annotations

from . import http

TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik:010d}.json"
FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"
ARCHIVE_URL = "https://www.sec.gov/Archives/edgar/data/{cik}/{acc_nodash}/{doc}"

TRACKED_FORMS = {"10-K", "10-Q", "10-K/A", "10-Q/A", "8-K", "20-F", "6-K"}


def ticker_map() -> dict[str, int]:
    data = http.sec_get_json(TICKERS_URL)
    return {row["ticker"].upper(): int(row["cik_str"]) for row in data.values()}


def ticker_titles() -> dict[str, tuple[int, str]]:
    """{TICKER: (cik, company name)} from the SEC's public ticker list."""
    data = http.sec_get_json(TICKERS_URL)
    return {row["ticker"].upper(): (int(row["cik_str"]), row.get("title", "")) for row in data.values()}


# Successor issuers: when a company re-organises under a new holding company, the SEC gives the
# holding a new CIK and the ticker moves to it, while the whole financial history stays under the
# old CIK. {new CIK: (old CIK, ...)} - the old facts and filings are merged in.
PREDECESSORS: dict[int, tuple[int, ...]] = {
    2115436: (34088,),  # ExxonMobil Holdings Corp (Texas, 1 July 2026) <- Exxon Mobil Corp (XOM)
}


def merge_facts(primary: dict, *older: dict) -> dict:
    """Union of companyfacts payloads; duplicates (same period, value and filing) are dropped."""
    out = {k: v for k, v in primary.items() if k != "facts"}
    facts: dict = {}
    for payload in (primary, *older):
        for tax, tags in (payload.get("facts") or {}).items():
            for tag, node in tags.items():
                dst = facts.setdefault(tax, {}).setdefault(tag, {k: v for k, v in node.items() if k != "units"})
                units = dst.setdefault("units", {})
                for unit, rows in (node.get("units") or {}).items():
                    lst = units.setdefault(unit, [])
                    seen = {(r.get("start"), r.get("end"), r.get("val"), r.get("accn")) for r in lst}
                    for r in rows:
                        key = (r.get("start"), r.get("end"), r.get("val"), r.get("accn"))
                        if key not in seen:
                            seen.add(key)
                            lst.append(r)
    out["facts"] = facts
    return out


def merge_submissions(primary: dict, *older: dict) -> dict:
    """Successor's profile, with the predecessors' recent filings appended (newest first)."""
    out = dict(primary)
    rows = []
    for payload in (primary, *older):
        rec = (payload.get("filings") or {}).get("recent") or {}
        n = len(rec.get("accessionNumber", []))
        cik = int(payload.get("cik", 0) or 0)
        for i in range(n):
            row = {k: (v[i] if isinstance(v, list) and i < len(v) else None) for k, v in rec.items()}
            row.setdefault("_cik", cik)
            rows.append(row)
    rows.sort(key=lambda r: r.get("filingDate") or "", reverse=True)
    keys = sorted({k for r in rows for k in r})
    out["filings"] = dict(primary.get("filings") or {})
    out["filings"]["recent"] = {k: [r.get(k) for r in rows] for k in keys}
    return out


def company_facts(cik: int) -> dict:
    data = http.sec_get_json(FACTS_URL.format(cik=cik))
    olds = [http.sec_get_json(FACTS_URL.format(cik=c)) for c in PREDECESSORS.get(int(cik), ())]
    return merge_facts(data, *olds) if olds else data


def submissions(cik: int) -> dict:
    data = http.sec_get_json(SUBMISSIONS_URL.format(cik=cik))
    olds = [http.sec_get_json(SUBMISSIONS_URL.format(cik=c)) for c in PREDECESSORS.get(int(cik), ())]
    return merge_submissions(data, *olds) if olds else data


def recent_filings(subs: dict, limit: int = 60) -> list[dict]:
    """Flatten the column-oriented 'recent' block into a list of filings we care about."""
    rec = subs.get("filings", {}).get("recent", {})
    cik = int(subs.get("cik", 0))
    out = []
    n = len(rec.get("accessionNumber", []))
    for i in range(n):
        form = rec["form"][i]
        if form not in TRACKED_FORMS:
            continue
        items = (rec.get("items") or [""] * n)[i] or ""
        # Keep only the 8-Ks that carry results (2.02) or material events (7.01/8.01)
        if form == "8-K" and not any(x in items for x in ("2.02", "7.01", "8.01")):
            continue
        acc = rec["accessionNumber"][i]
        doc = rec["primaryDocument"][i]
        fcik = int((rec.get("_cik") or [None] * n)[i] or cik)  # predecessor filings live under the old CIK
        out.append({
            "accession": acc,
            "form": form,
            "filed": rec["filingDate"][i],
            "report_date": rec.get("reportDate", [""] * n)[i] or None,
            "items": items,
            "accepted": _accepted(rec, i, n),
            "is_results": form in ("10-K", "10-Q", "20-F") or (form == "8-K" and "2.02" in items),
            "url": ARCHIVE_URL.format(cik=fcik, acc_nodash=acc.replace("-", ""), doc=doc),
        })
        if len(out) >= limit:
            break
    return out


def _accepted(rec: dict, i: int, n: int) -> str | None:
    """EDGAR acceptance time (Eastern time, given with a misleading 'Z') -> UTC ISO string."""
    raw = (rec.get("acceptanceDateTime") or [None] * n)[i]
    if not raw:
        return None
    try:
        from datetime import datetime, timedelta
        dt = datetime.fromisoformat(raw.replace("Z", "").split(".")[0])
        off = 4 if 3 < dt.month < 11 else 5   # EDT / EST, close enough for ordering
        return (dt + timedelta(hours=off)).isoformat() + "Z"
    except ValueError:
        return None


def profile(subs: dict) -> dict:
    return {
        "name": subs.get("name"),
        "cik": int(subs.get("cik", 0)),
        "sic": subs.get("sic"),
        "sic_description": subs.get("sicDescription"),
        "fiscal_year_end": subs.get("fiscalYearEnd"),  # "MMDD"
        "exchanges": subs.get("exchanges"),
        "website": subs.get("website") or None,
        "state_of_incorporation": subs.get("stateOfIncorporation"),
    }
