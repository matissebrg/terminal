"""The site's prediction form (docs/assets/js/predict-core.js) writes files that pipeline/predictions.py
scores: same schema, same units. The YAML is produced by the browser code itself, run under node."""
import json
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import pytest

from pipeline import predictions as P
from tests.test_predictions import RESULTS, _git, fin, repo  # noqa: F401  (pytest fixtures)

CORE = Path(__file__).resolve().parent.parent / "docs" / "assets" / "js" / "predict-core.js"
pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node non installé")


def browser_yaml(form: dict, now_iso: str) -> tuple[str, str, list[str]]:
    script = f"""const P = require({json.dumps(str(CORE))});
const d = {json.dumps(form)}, now = new Date({json.dumps(now_iso)});
process.stdout.write(JSON.stringify({{yaml: P.toYaml(d, now), file: P.fileName(d, now),
  errors: P.validate(d, {{today: now.toISOString().slice(0, 10), metricsAllowed: d.ticker === "NVDA"}})}}));"""
    out = json.loads(subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True).stdout)
    return out["yaml"], out["file"], out["errors"]


def commit_text(root, rel, text, when):
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)
    _git(root, "add", rel)
    _git(root, "commit", "-m", "pred", when=when)


def test_form_file_is_scored_by_the_pipeline(repo, fin):  # noqa: F811
    form = {"ticker": "NVDA", "period": "Q2 FY2027",
            "metrics": {"revenue": {"value": "46,5", "low": "45", "high": "48"}, "gross_margin": {"value": "72,5"},
                        "eps_diluted": {"value": "1,05", "low": "0,95", "high": "1,15"}},
            "events": [{"question": 'Chiffre "record" ?', "probability": "65"}],
            "price": [{"date": "2026-09-30", "value": "180", "low": "160", "high": "200"}],
            "note": "Data center.\nDeuxième ligne."}
    text, rel, errors = browser_yaml(form, "2026-08-20T09:00:00Z")
    assert errors == []
    assert rel.startswith("config/predictions/NVDA/") and rel.endswith("-q2-fy2027.yaml")
    commit_text(repo, rel, text, "2026-08-20T09:05:00+00:00")
    bars = {"NVDA": [{"t": "2026-09-29", "c": 170.0}, {"t": "2026-09-30", "c": 185.0}, {"t": "2026-10-01", "c": 190.0}]}
    out, _ = P.evaluate(root=repo, fins={"NVDA": fin}, filings={"NVDA": RESULTS}, bars=bars, guidance={}, consensus={},
                        next_earnings={}, now=datetime(2026, 10, 28, tzinfo=timezone.utc))
    assert out["errors"] == []
    (rec,) = out["predictions"]
    assert rec["status"] == "partial" and rec["verified"]   # the yes / no question is still open
    m = {x["key"]: x for x in rec["metrics"]}
    assert m["revenue"]["value"] == pytest.approx(46.5e9) and m["revenue"]["low"] == pytest.approx(45e9)
    assert m["gross_margin"]["value"] == pytest.approx(0.725)
    assert m["eps_diluted"]["value"] == pytest.approx(1.05)
    assert all(x["actual"] is not None for x in rec["metrics"])
    assert "in_interval" in m["revenue"] and "in_interval" not in m["gross_margin"]
    (ev,) = rec["events"]
    assert ev["question"] == 'Chiffre "record" ?' and ev["probability"] == pytest.approx(0.65) and ev["outcome"] is None
    (px,) = rec["price"]
    assert px["actual"] == 185.0 and px["in_interval"] is True
    assert rec["note"].startswith("Data center.\nDeuxième ligne.")

    # after the release: only the outcome is filled in, by hand, as the file's comment says
    assert "outcome: null" in text
    commit_text(repo, rel, text.replace("outcome: null", "outcome: true"), "2026-08-28T09:00:00+00:00")
    out, _ = P.evaluate(root=repo, fins={"NVDA": fin}, filings={"NVDA": RESULTS}, bars=bars, guidance={}, consensus={},
                        next_earnings={}, now=datetime(2026, 10, 28, tzinfo=timezone.utc))
    (rec,) = out["predictions"]
    assert rec["status"] == "resolved"
    assert rec["events"][0]["outcome"] is True and rec["events"][0]["brier"] == pytest.approx(0.35 ** 2)
    assert rec["metrics"][0]["value"] == pytest.approx(46.5e9)   # the scored forecast is still the pre-release one


def test_price_and_question_file_without_period(repo, fin):  # noqa: F811
    """Comparables (Sanofi, Novo, AstraZeneca) and the ETF: no period, price targets and yes / no only."""
    form = {"ticker": "SNY", "period": "", "metrics": {},
            "events": [{"question": "Décision favorable avant juin ?", "probability": "40"}],
            "price": [{"date": "2026-12-31", "value": "52"}], "note": ""}
    text, rel, errors = browser_yaml(form, "2026-10-01T09:00:00Z")
    assert errors == [] and "period:" not in text
    commit_text(repo, rel, text, "2026-10-01T09:05:00+00:00")
    out, _ = P.evaluate(root=repo, fins={"NVDA": fin}, filings={"NVDA": RESULTS}, bars={"SNY": [{"t": "2026-10-27", "c": 50.0}]},
                        guidance={}, consensus={}, next_earnings={}, now=datetime(2026, 10, 28, tzinfo=timezone.utc))
    assert out["errors"] == []
    (rec,) = out["predictions"]
    assert rec["ticker"] == "SNY" and rec["period"] is None and rec["status"] == "pending"
    assert rec["price"][0]["value"] == 52 and rec["price"][0]["actual"] is None
    assert rec["events"][0]["probability"] == pytest.approx(0.40)
