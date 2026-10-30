"""rNPV engine: base rates, programme maths, catalyst maths, browser parity."""
import json
import shutil
import subprocess
from datetime import date
from pathlib import Path

import pytest

from pipeline import rnpv

JS = Path(__file__).resolve().parent.parent / "docs" / "assets" / "rnpv.js"
VD = date(2026, 10, 31)

CFG = {
    "discount_rate": 0.10, "tax_rate": 0.21, "horizon": 2045,
    "corporate": {"annual_cost": 2.0e8, "years": 10}, "other_value": 5.0e7,
    "assets": [
        {"name": "Mkt", "stage": "marketed", "launch_year": 2024, "peak_sales": 2.5e9, "years_to_peak": 6,
         "loe_year": 2038, "cogs_pct": 0.08, "opex_pct": 0.25},
        {"name": "Roy", "stage": "marketed", "launch_year": 2025, "peak_sales": 6e8, "royalty_rate": 0.30, "loe_year": 2038},
        {"name": "Filed", "stage": "filed", "area": "rare", "launch_year": 2027, "peak_sales": 8e8, "years_to_peak": 5,
         "loe_year": 2040, "dev_cost": 5e7},
        {"name": "P3", "stage": "phase3", "area": "endocrine", "launch_year": 2029, "peak_sales": 1e9, "dev_cost": 3e8},
        {"name": "P2", "stage": "phase2", "area": "rare", "pos": 0.25, "launch_year": 2030, "peak_sales": 5e8,
         "dev_cost": 2e8, "share": 0.5},
    ],
}
CTX = {"net_cash": -1.09e9, "shares": 1.948e8, "price": 74.95, "valuation_date": VD.isoformat()}


def run():
    return rnpv.value(CFG, net_cash=CTX["net_cash"], shares=CTX["shares"], price=CTX["price"], valuation_date=VD)


def test_base_rates_compound():
    assert rnpv.pos_to_market("phase1", "all") == pytest.approx(0.52 * 0.289 * 0.578 * 0.906)
    assert rnpv.pos_to_market("phase1", "all") == pytest.approx(0.079, abs=0.001)    # LOA 7.9 % in the report
    assert rnpv.pos_to_market("filed", "rare") == pytest.approx(0.936)
    assert rnpv.pos_to_market("marketed", "oncology") == 1.0
    assert rnpv.step_probability("phase3", "endocrine") == pytest.approx(0.662)


def test_programme_values_and_catalysts():
    v = run()
    a = {x["name"]: x for x in v["assets"]}
    assert a["Mkt"]["pos"] == 1 and a["Mkt"]["step_p"] is None and a["Mkt"]["rnpv"] > 0
    assert a["Filed"]["step_p"] == pytest.approx(0.936) and a["Filed"]["later_p"] == 1.0
    # success on the next event removes that step's risk; failure is worth nothing
    assert a["P3"]["value_if_success"] > a["P3"]["rnpv"] > 0 and a["P3"]["value_if_failure"] == 0
    assert a["P2"]["pos_source"] == "hypothèse" and a["P2"]["step_p"] == pytest.approx(0.25 / rnpv.pos_to_market("phase3", "rare"))
    # equity bridge
    eq = sum(x["rnpv"] for x in v["assets"]) + v["overhead_pv"] + CTX["net_cash"] + 5e7
    assert v["equity_value"] == pytest.approx(eq) and v["value_per_share"] == pytest.approx(eq / CTX["shares"])
    # market-implied probability: plugging it back reproduces the price
    f = a["Filed"]
    unrisked = f["revenue_pv"] / f["pos"]
    implied_equity = v["equity_value"] - f["rnpv"] + unrisked * f["implied_pos"] + f["dev_pv"]
    assert implied_equity / CTX["shares"] == pytest.approx(CTX["price"])
    assert f["move_up"] >= 0 >= f["move_down"]


def test_royalty_asset_has_no_costs():
    v = run()
    roy = next(x for x in v["assets"] if x["name"] == "Roy")
    s2030 = next(s for s in roy["series"] if s["year"] == 2030)
    assert s2030["risked_cf"] == pytest.approx(rnpv.sales_curve({**rnpv.DEFAULTS, **CFG["assets"][1]}, 2030) * 0.30 * 0.79)


@pytest.mark.skipif(shutil.which("node") is None, reason="node non installé")
def test_js_matches_python():
    py = run()
    script = f"""const R = require({json.dumps(str(JS))});
process.stdout.write(JSON.stringify(R.value({json.dumps(CFG)}, {json.dumps(CTX)})));"""
    js = json.loads(subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True).stdout)
    assert js["value_per_share"] == pytest.approx(py["value_per_share"], rel=1e-12)
    for a, b in zip(js["assets"], py["assets"]):
        for k in ("rnpv", "revenue_pv", "dev_pv", "value_if_success", "implied_pos", "move_up", "move_down", "expected_abs_move"):
            if b[k] is None:
                assert a[k] is None, (a["name"], k)
            else:
                assert a[k] == pytest.approx(b[k], rel=1e-10, abs=1e-6), (a["name"], k)


def test_options_event_move_strips_ordinary_volatility():
    opt = {"expiries": [{"date": "2026-11-20", "dte": 20}, {"date": "2026-12-18", "dte": 48}],
           "chains": {"2026-11-20": [{"strike": 75, "c_mid": 3.0, "p_mid": 3.0, "c_iv": 0.40, "p_iv": 0.40}],
                      "2026-12-18": [{"strike": 75, "c_mid": 7.0, "p_mid": 7.0, "c_iv": 0.70, "p_iv": 0.70}]}}
    m = rnpv.implied_move(opt, "2026-11-27", 75.0)
    assert m["expiry"] == "2026-12-18" and m["front_expiry"] == "2026-11-20"
    assert m["straddle_move"] == pytest.approx(14 / 75)
    import math
    assert m["event_move"] == pytest.approx(math.sqrt((0.49 - 0.16) * 48 / 365) * math.sqrt(2 / math.pi))
    assert rnpv.implied_move(opt, "2027-01-15", 75.0) is None
