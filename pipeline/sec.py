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


def company_facts(cik: int) -> dict:
    return http.sec_get_json(FACTS_URL.format(cik=cik))


def submissions(cik: int) -> dict:
    return http.sec_get_json(SUBMISSIONS_URL.format(cik=cik))


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
        out.append({
            "accession": acc,
            "form": form,
            "filed": rec["filingDate"][i],
            "report_date": rec.get("reportDate", [""] * n)[i] or None,
            "items": items,
            "is_results": form in ("10-K", "10-Q", "20-F") or (form == "8-K" and "2.02" in items),
            "url": ARCHIVE_URL.format(cik=cik, acc_nodash=acc.replace("-", ""), doc=doc),
        })
        if len(out) >= limit:
            break
    return out


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
