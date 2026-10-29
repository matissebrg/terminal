"""Results announced (8-K 2.02) before the 10-Q: provisional headline figures."""
import json
from datetime import date, timedelta
from pathlib import Path

from pipeline import build, normalize, predictions

FIX = Path(__file__).parent / "fixtures"


class Src:
    def __init__(self, rows):
        self.rows = rows

    def reported_quarters(self, sym):
        return self.rows


def _fin():
    return normalize.normalize(json.loads((FIX / "facts_NVDA.json").read_text()), max_years=20, max_quarters=100)


def test_provisional_when_8k_but_no_10q():
    fin = _fin()
    nq = predictions.next_quarter(fin)
    end = date.fromisoformat(nq["end_estimate"])
    filed = (end + timedelta(days=25)).isoformat()
    filings = [{"form": "8-K", "filed": filed, "is_results": True, "url": "u"}]
    prev = predictions.actual(fin, f"Q{nq['q']} FY{nq['fy'] - 1}", "revenue")
    rows = [{"end": end.isoformat(), "revenue": prev * 1.5, "gross_profit": 1.0, "operating_income": 2.0,
             "net_income": 3.0, "eps_diluted": 0.5}]
    cons = [{"date": (end + timedelta(days=20)).isoformat(), "period": nq["label"], "revenue_avg": prev * 1.4}]
    p = build.provisional_results(Src(rows), "NVDA", fin, filings, cons)
    assert p["period"] == nq["label"] and p["filed"] == filed
    assert abs(p["revenue_yoy"] - 0.5) < 1e-9
    assert abs(p["surprise"] - (1.5 / 1.4 - 1)) < 1e-9


def test_no_provisional_without_new_release():
    fin = _fin()
    assert build.provisional_results(Src([]), "NVDA", fin, [], []) is None
    old = fin["periods"]["quarterly"][-1]["end"]
    filings = [{"form": "8-K", "filed": old, "is_results": True}]          # the release of the last known quarter
    assert build.provisional_results(Src([]), "NVDA", fin, filings, []) is None


def test_release_without_yahoo_figures_still_flagged():
    fin = _fin()
    end = date.fromisoformat(predictions.next_quarter(fin)["end_estimate"])
    filings = [{"form": "8-K", "filed": (end + timedelta(days=25)).isoformat(), "is_results": True}]
    p = build.provisional_results(Src([]), "NVDA", fin, filings, [])
    assert p and p["values"] is None


class Cal:
    def __init__(self, dates):
        self.dates = dates

    def calendar(self, t, fin=None):
        return {"earnings_dates": self.dates, "revenue_avg": 1e11, "eps_avg": 2.0}


def test_stale_yahoo_date_is_ignored_with_its_consensus():
    fin = _fin()
    nq = predictions.next_quarter(fin)
    stale = (date.fromisoformat(fin["periods"]["quarterly"][-1]["end"]) + timedelta(days=28)).isoformat()
    status = {"errors": []}
    ne, cal = build.next_earnings(Cal([stale]), "NVDA", {}, fin, [], status, stale)
    assert ne["date"] > nq["end_estimate"] and "estimation" in ne["source"]
    assert cal["revenue_avg"] is None                                   # not stored as next quarter's consensus
    good = (date.fromisoformat(nq["end_estimate"]) + timedelta(days=30)).isoformat()
    ne, cal = build.next_earnings(Cal([stale, good]), "NVDA", {}, fin, [], status, stale)
    assert ne["date"] == good and cal["revenue_avg"] == 1e11
