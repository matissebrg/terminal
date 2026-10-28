"""The browser DCF (docs/assets/dcf.js) must give exactly the pipeline's numbers."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from pipeline import valuation as V
from tests.test_valuation import base_r

JS = Path(__file__).resolve().parent.parent / "docs" / "assets" / "dcf.js"

CASES = [
    base_r(),
    base_r(mid_year=True, years=10, revenue_growth=[0.5, 0.2, 0.12, 0.08, 0.06], ebit_margin_start=0.66,
           ebit_margin_target=0.55, margin_years_to_target=7, nwc_pct_incremental_revenue=0.15, terminal_growth=0.03,
           wacc=0.105, base_revenue=3.0e11, cash=2.0e11, debt=8.5e9, shares=2.43e10, price=186.0),
    base_r(terminal_roic=0.25, nwc_pct_incremental_revenue=0.1, mid_year=True),
    base_r(investments=12.5, mid_year=True),
]


@pytest.mark.skipif(shutil.which("node") is None, reason="node non installé")
@pytest.mark.parametrize("r", CASES)
def test_js_matches_python(r):
    script = f"""
const D = require({json.dumps(str(JS))});
const r = {json.dumps(r)};
console.log(JSON.stringify({{dcf: D.dcf(r), rev: D.reverseDcf(r)}}));
"""
    out = json.loads(subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True).stdout)
    py = V.dcf(r)
    for k in ("enterprise_value", "equity_value", "value_per_share", "terminal_value", "pv_terminal_value",
              "investments"):
        assert out["dcf"][k] == pytest.approx(py[k], rel=1e-12), k
    for a, b in zip(out["dcf"]["rows"], py["rows"]):
        assert a["fcff"] == pytest.approx(b["fcff"], rel=1e-12)
    rv = V.reverse_dcf(r)
    if rv and rv.get("implied_growth") is not None:
        assert out["rev"]["implied_growth"] == pytest.approx(rv["implied_growth"], abs=1e-9)
