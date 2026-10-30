"""End-to-end offline build of a clinical-stage (pre-revenue) biotech: the run must not crash, the DCF is
the net cash, the rNPV is the headline value and the catalyst calendar is written."""
import json
import shutil
from pathlib import Path

import yaml

from pipeline import build

FIX = Path(__file__).resolve().parent / "fixtures"
REVENUE_TAGS = {"Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "CostOfRevenue", "GrossProfit",
                "SalesRevenueNet", "CostOfGoodsAndServicesSold"}


def test_prerevenue_biotech_builds(tmp_path, monkeypatch):
    fx = tmp_path / "fx"
    shutil.copytree(FIX, fx, ignore=shutil.ignore_patterns("__pycache__", "*.py"))
    facts = json.loads((FIX / "facts_NVDA.json").read_text())
    facts["facts"]["us-gaap"] = {k: v for k, v in facts["facts"]["us-gaap"].items() if k not in REVENUE_TAGS}
    (fx / "facts_PRE.json").write_text(json.dumps(facts))
    for kind in ("subs", "prices"):
        shutil.copy(FIX / f"{kind}_NVDA.json", fx / f"{kind}_PRE.json")
    root = tmp_path / "root"
    (root / "config" / "assumptions").mkdir(parents=True)
    (root / "config" / "universe.yaml").write_text(yaml.safe_dump({
        "benchmarks": {"SPY": "S&P 500"}, "families": {"PRE": "sante"},
        "tickers": {"PRE": {"name": "Pre Bio", "sector": "Biotechnologie", "industry": "x", "peers": ["AMD"],
                            "benchmarks": ["SPY"]}}}))
    nvda = yaml.safe_load((Path(build.ROOT) / "config" / "assumptions" / "NVDA.yaml").read_text())
    nvda["rnpv"] = {"primary": True, "discount_rate": 0.1, "horizon": 2040, "net_cash": 5e8,
                    "assets": [{"name": "Lead", "stage": "filed", "area": "rare", "launch_year": 2028, "peak_sales": 1e9}]}
    nvda["catalysts"] = [{"id": "lead-pdufa", "date": "2030-01-15", "kind": "pdufa", "asset": "Lead", "confirmed": True}]
    nvda["trials"] = {"enabled": False}
    (root / "config" / "assumptions" / "PRE.yaml").write_text(yaml.safe_dump(nvda))
    out = tmp_path / "out"
    monkeypatch.setattr(build, "ROOT", root)
    monkeypatch.setattr(build, "OUT", out)
    build.run(build.FixtureSource(fx), ["PRE"])
    status = json.loads((out / "status.json").read_text())
    assert not [e for e in status["errors"] if e.startswith("PRE:")], status["errors"]
    uni = json.loads((out / "universe.json").read_text())
    pre = uni["tickers"][0]
    assert pre["method"] == "rnpv" and pre["value_base"] > 0
    val = json.loads((out / "PRE" / "valuation.json").read_text())
    assert val["dcf"]["inputs"]["base_revenue"] == 0.0           # DCF of today's business = net cash
    cal = json.loads((out / "biotech.json").read_text())["calendar"]
    assert cal[0]["id"] == "lead-pdufa" and cal[0]["p_base"] > 0.9
