"""Normalization tests on synthetic SEC-shaped fixtures (tests/fixtures/make_fixtures.py).

The generator knows the true discrete quarterly values, so every reconstruction
(Q4 = FY − 9M, cash-flow YTD differencing, tag switch, restatement) is checked
against ground truth.
"""
import json
from pathlib import Path

import pytest

from pipeline import normalize
from tests.fixtures import make_fixtures as mf

FIX = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="module", params=["NVDA", "AMD", "AVGO", "QCOM", "INTC", "MRVL"])
def case(request):
    tk = request.param
    facts = json.loads((FIX / f"facts_{tk}.json").read_text())
    _, _, cal, quarters, bal = mf.build_company(tk)
    return tk, normalize.normalize(facts, max_years=20, max_quarters=100), quarters, bal


def _label(q):
    return f"Q{q['k']} FY{q['fy']}"


def test_quarterly_revenue_matches_truth(case):
    tk, n, quarters, _ = case
    got = n["lines"]["revenue"]["quarterly"]
    for q in quarters:
        assert got[_label(q)] == pytest.approx(round(q["revenue"]), rel=1e-9), (tk, _label(q))


def test_q4_is_full_year_minus_nine_months(case):
    tk, n, quarters, _ = case
    q4s = [q for q in quarters if q["k"] == 4]
    assert q4s, "fixture should contain closed fiscal years"
    for q in q4s:
        assert n["lines"]["net_income"]["quarterly"][_label(q)] == pytest.approx(q["ni"], rel=1e-6, abs=2)


def test_cash_flow_ytd_differencing(case):
    """10-Q cash flows are YTD only: discrete quarters must be rebuilt."""
    tk, n, quarters, _ = case
    for key, concept in (("cfo", "cfo"), ("capex", "capex"), ("da", "d_and_a"), ("sbc", "sbc")):
        got = n["lines"][concept]["quarterly"]
        for q in quarters:
            assert got[_label(q)] == pytest.approx(q[key], rel=1e-6, abs=3), (tk, concept, _label(q))


def test_annual_equals_sum_of_quarters(case):
    tk, n, quarters, _ = case
    by_fy = {}
    for q in quarters:
        by_fy.setdefault(q["fy"], []).append(q)
    for fy, qs in by_fy.items():
        if len(qs) == 4:
            assert n["lines"]["revenue"]["annual"][f"FY{fy}"] == pytest.approx(sum(x["revenue"] for x in qs), abs=5)
            assert n["lines"]["cfo"]["annual"][f"FY{fy}"] == pytest.approx(sum(x["cfo"] for x in qs), abs=5)


def test_partial_current_fiscal_year_has_no_annual(case):
    tk, n, quarters, _ = case
    last_fy = quarters[-1]["fy"]
    if quarters[-1]["k"] < 4:
        assert f"FY{last_fy}" not in n["lines"]["revenue"]["annual"]


def test_balance_sheet_instants(case):
    tk, n, quarters, bal = case
    q = quarters[-1]
    b = bal[q["end"]]
    assert n["lines"]["cash"]["quarterly"][_label(q)] == pytest.approx(b["cash"], abs=1)
    assert n["lines"]["total_debt"]["quarterly"][_label(q)] == pytest.approx(b["dnc"] + b["dc"], abs=2)


def test_ttm_is_sum_of_last_four(case):
    tk, n, quarters, _ = case
    assert n["ttm"]["revenue"] == pytest.approx(sum(round(q["revenue"]) for q in quarters[-4:]), abs=4)
    assert n["ttm"]["revenue_prev"] == pytest.approx(sum(round(q["revenue"]) for q in quarters[-8:-4]), abs=4)


def test_tag_switch_is_merged():
    facts = json.loads((FIX / "facts_NVDA.json").read_text())
    n = normalize.normalize(facts, max_years=20, max_quarters=100)
    assert "SalesRevenueNet" in n["coverage"]["revenue"]["tags"]
    assert "Revenues" in n["coverage"]["revenue"]["tags"]
    assert "FY2021" in n["lines"]["revenue"]["annual"]  # only reported under the old tag


def test_restatement_keeps_latest_filed():
    """The fixture contains one wrong, earlier-filed revenue value (−10 %); it must be ignored."""
    facts = json.loads((FIX / "facts_NVDA.json").read_text())
    n = normalize.normalize(facts, max_years=20, max_quarters=100)
    _, _, _, quarters, _ = mf.build_company("NVDA")
    for q in quarters:
        assert n["lines"]["revenue"]["quarterly"][_label(q)] == pytest.approx(round(q["revenue"]), rel=1e-9)


def test_53_week_year_labels():
    facts = json.loads((FIX / "facts_NVDA.json").read_text())
    years = normalize.fiscal_years(facts)
    fy2021 = next(y for y in years if y.fy == 2021)
    assert (fy2021.end - fy2021.start).days + 1 == 371  # 53 weeks
    assert years[-1].reported is False                  # current fiscal year still open
