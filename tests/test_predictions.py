"""Prediction registry: deadline enforcement through git commit times, scoring, benchmarks."""
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import pytest
import yaml

from pipeline import normalize, predictions as P

FIX = Path(__file__).parent / "fixtures"
RESULTS = [{"form": "8-K", "items": "2.02", "filed": "2026-08-26", "is_results": True, "accession": "x"}]


@pytest.fixture(scope="module")
def fin():
    return normalize.normalize(json.loads((FIX / "facts_NVDA.json").read_text()), max_years=20, max_quarters=100)


def _git(root, *args, when=None):
    env = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t",
           "GIT_COMMITTER_EMAIL": "t@t"}
    if when:
        env["GIT_AUTHOR_DATE"] = env["GIT_COMMITTER_DATE"] = when
    subprocess.run(["git", "-C", str(root), *args], check=True, capture_output=True, env=env)


def _commit(root, rel, content, when):
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(yaml.safe_dump(content, allow_unicode=True))
    _git(root, "add", rel)
    _git(root, "commit", "-m", "pred", when=when)


@pytest.fixture()
def repo(tmp_path):
    _git(tmp_path, "init", "-q", "-b", "main")
    return tmp_path


def _eval(repo, fin, **kw):
    args = dict(root=repo, fins={"NVDA": fin}, filings={"NVDA": RESULTS}, bars={}, guidance={}, consensus={},
                next_earnings={}, now=datetime(2026, 10, 28, tzinfo=timezone.utc))
    args.update(kw)
    out, events = P.evaluate(**args)
    return out, events


def test_version_before_deadline_is_scored_later_edit_ignored(repo, fin):
    rel = "config/predictions/NVDA/q2.yaml"
    base = {"ticker": "NVDA", "period": "Q2 FY2027",
            "metrics": {"revenue": {"value": 90, "low": 85, "high": 100}, "gross_margin": {"value": 74.0}},
            "events": [{"id": "beat", "question": "beat?", "probability": 70, "outcome": None}]}
    _commit(repo, rel, base, "2026-08-20T10:00:00+00:00")
    after = {**base, "metrics": {"revenue": {"value": 96.2}}, "events": [{"id": "beat", "probability": 99, "outcome": True}]}
    _commit(repo, rel, after, "2026-08-27T10:00:00+00:00")
    out, events = _eval(repo, fin)
    r = out["predictions"][0]
    assert r["verified"] and r["status"] == "resolved"
    assert r["edited_after_deadline"] is True
    rev = next(m for m in r["metrics"] if m["key"] == "revenue")
    assert rev["value"] == 90e9                                   # pre-deadline version
    assert rev["actual"] == pytest.approx(96.2e9)
    assert rev["error_pct"] == pytest.approx(90 / 96.2 - 1)
    assert rev["in_interval"] is True
    naive = 81.5e9 * 81.5 / 68.0                                  # Q1 × (Q1 / Q4)
    assert rev["benchmarks"]["naive"] == pytest.approx(naive, rel=1e-6)
    assert rev["vs"]["naive"]["you_win"] is False                 # |-6.4 %| > |+1.5 %|
    ev = r["events"][0]
    assert ev["probability"] == 0.70 and ev["outcome"] is True    # proba frozen, outcome from latest
    assert ev["brier"] == pytest.approx(0.09)
    assert any(e["type"] == "prediction" and "vérifiée" in e["title"] for e in events)
    s = out["summary"]["by_metric"]["revenue"]
    assert s["n"] == 1 and s["interval"]["rate"] == 1.0 and s["bias"] < 0


def test_prediction_committed_after_release_is_late(repo, fin):
    _commit(repo, "config/predictions/NVDA/late.yaml",
            {"ticker": "NVDA", "period": "Q2 FY2027", "metrics": {"revenue": {"value": 96}}}, "2026-08-26T05:00:00+00:00")
    r = _eval(repo, fin)[0]["predictions"][0]
    assert r["status"] == "late"   # 26/08 05:00 UTC = 26/08 01:00 New York: release day already started


def test_deadline_is_midnight_new_york_of_release_day(repo, fin):
    # 26/08/2026 03:59 UTC = 25/08 23:59 EDT -> still valid
    _commit(repo, "config/predictions/NVDA/ok.yaml",
            {"ticker": "NVDA", "period": "Q2 FY2027", "metrics": {"revenue": {"value": 96}}}, "2026-08-26T03:59:00+00:00")
    r = _eval(repo, fin)[0]["predictions"][0]
    assert r["status"] == "resolved"
    assert P.deadline_for(datetime(2026, 8, 26).date()).isoformat() == "2026-08-26T04:00:00+00:00"


def test_pending_uses_expected_release_and_live_consensus(repo, fin):
    _commit(repo, "config/predictions/NVDA/q3.yaml",
            {"ticker": "NVDA", "period": "Q3 FY2027", "metrics": {"revenue": {"value": 110}}}, "2026-10-28T08:00:00+00:00")
    cons = [{"date": "2026-10-27", "period": "Q3 FY2027", "revenue_avg": 104e9},
            {"date": "2026-10-28", "period": "Q3 FY2027", "revenue_avg": 105e9}]
    out, _ = _eval(repo, fin, consensus={"NVDA": cons},
                   guidance={"NVDA": {"Q3 FY2027": {"revenue": 108.0}}},
                   next_earnings={"NVDA": {"period": "Q3 FY2027", "date": "2026-11-18", "estimated": True}})
    r = out["predictions"][0]
    assert r["status"] == "pending" and r["expected_release"] == "2026-11-18"
    assert r["deadline"] == "2026-11-18T05:00:00+00:00"            # EST after 1 November
    m = r["metrics"][0]
    assert m["benchmarks"]["consensus"] == 105e9 and m["benchmarks"]["guidance"] == 108e9


def test_consensus_frozen_before_release_and_surprise_call(repo, fin):
    _commit(repo, "config/predictions/NVDA/q2c.yaml",
            {"ticker": "NVDA", "period": "Q2 FY2027", "metrics": {"revenue": {"value": 97}}}, "2026-08-10T08:00:00+00:00")
    cons = [{"date": "2026-08-25", "period": "Q2 FY2027", "revenue_avg": 94e9},
            {"date": "2026-08-26", "period": "Q2 FY2027", "revenue_avg": 96.5e9}]   # release day: ignored
    m = _eval(repo, fin, consensus={"NVDA": cons})[0]["predictions"][0]["metrics"][0]
    assert m["benchmarks"]["consensus"] == 94e9
    assert m["surprise_call"] == {"you": "au-dessus", "actual": "au-dessus", "correct": True}
    assert m["vs"]["consensus"]["you_win"] is True


def test_uncommitted_file_is_flagged_unverified(repo, fin):
    p = repo / "config/predictions/NVDA/draft.yaml"
    p.parent.mkdir(parents=True)
    p.write_text("ticker: NVDA\nperiod: Q3 FY2027\nmetrics: {revenue: 111}\n")
    r = _eval(repo, fin)[0]["predictions"][0]
    assert r["verified"] is False and r["status"] == "pending"


def test_price_target_and_bad_file(repo, fin):
    _commit(repo, "config/predictions/NVDA/px.yaml",
            {"ticker": "NVDA", "price": [{"date": "2026-10-01", "value": 200, "low": 180, "high": 230}]},
            "2026-09-01T08:00:00+00:00")
    _commit(repo, "config/predictions/NVDA/bad.yaml", {"ticker": "NVDA", "period": "Q9 2027"}, "2026-09-01T08:00:00+00:00")
    bars = {"NVDA": [{"t": "2026-09-30", "c": 190.0}, {"t": "2026-10-01", "c": 210.0}, {"t": "2026-10-02", "c": 211.0}]}
    out, _ = _eval(repo, fin, bars=bars)
    r = next(x for x in out["predictions"] if x["id"].endswith("px.yaml"))
    pr = r["price"][0]
    assert pr["actual"] == 210.0 and pr["in_interval"] is True and pr["error_pct"] == pytest.approx(200 / 210 - 1)
    assert pr["horizon_days"] == 30
    assert any("bad.yaml" in e for e in out["errors"])


def test_margin_errors_in_points(fin):
    act = P.actual(fin, "Q2 FY2027", "gross_margin")
    e = P._err("gross_margin", act + 0.005, act)
    assert e["error_pts"] == pytest.approx(0.5)


def test_period_helpers(fin):
    assert P.parse_period("Q3 FY2027") == ("quarterly", 2027, 3)
    assert P.parse_period("fy2026") == ("annual", 2026, None)
    assert P.next_quarter(fin)["label"] == "Q3 FY2027"
    with pytest.raises(ValueError):
        P.parse_period("T3 2027")
