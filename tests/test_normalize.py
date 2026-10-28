"""Normalization tests on synthetic SEC-shaped fixtures (tests/fixtures/make_fixtures.py).

The generator knows the true discrete quarterly values, so every reconstruction
(Q4 = FY - 9M, cash-flow YTD differencing, tag switch, restatement) is checked
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
    """The fixture contains one wrong, earlier-filed revenue value (-10 %); it must be ignored."""
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


# --------------------------------------------------------------------------- tag switches & composites
def _fact(start, end, val, form="10-Q", filed=None, accn="a"):
    f = {"end": end, "val": val, "form": form, "filed": filed or end, "accn": accn, "fy": 2026, "fp": "Q"}
    if start:
        f["start"] = start
    return f


def _mini_facts(extra: dict) -> dict:
    """Two full fiscal years of revenue so the calendar can be inferred, plus extra tags."""
    rev = []
    for y in (2024, 2025):
        rev.append(_fact(f"{y}-01-01", f"{y}-12-31", 100.0, form="10-K", filed=f"{y + 1}-02-15", accn=f"k{y}"))
    for q, (s_, e_) in enumerate([("2025-01-01", "2025-03-31"), ("2025-04-01", "2025-06-30"),
                                  ("2025-07-01", "2025-09-30")], 1):
        rev.append(_fact(s_, e_, 25.0, filed="2025-11-01", accn=f"q{q}"))
    rev.append(_fact("2026-01-01", "2026-03-31", 30.0, filed="2026-05-01", accn="q26"))
    facts = {"us-gaap": {"Revenues": {"units": {"USD": rev}}}}
    for tag, arr in extra.items():
        facts["us-gaap"][tag] = {"units": {"USD": arr}}
    return {"facts": facts}


def test_short_term_investments_tag_switch():
    fj = _mini_facts({
        "MarketableSecuritiesCurrent": [_fact(None, "2025-09-30", 40.0)],
        "DebtSecuritiesCurrent": [_fact(None, "2026-03-31", 55.0, filed="2026-05-01")],
    })
    n = normalize.normalize(fj)
    q = n["lines"]["short_term_investments"]["quarterly"]
    assert q["Q3 FY2025"] == 40.0 and q["Q1 FY2026"] == 55.0
    assert normalize.quality(n) == [] or not any("short_term" in x for x in normalize.quality(n))


def test_d_and_a_composite_when_no_single_tag():
    fj = _mini_facts({
        "OtherDepreciationAndAmortization": [_fact("2026-01-01", "2026-03-31", 3.0, filed="2026-05-01")],
        "AmortizationOfIntangibleAssets": [_fact("2026-01-01", "2026-03-31", 2.0, filed="2026-05-01")],
    })
    n = normalize.normalize(fj)
    assert n["lines"]["d_and_a"]["quarterly"]["Q1 FY2026"] == 5.0
    assert any("somme" in t for t in n["coverage"]["d_and_a"]["tags"])


def test_d_and_a_composite_requires_depreciation():
    fj = _mini_facts({"AmortizationOfIntangibleAssets": [_fact("2026-01-01", "2026-03-31", 2.0, filed="2026-05-01")]})
    n = normalize.normalize(fj)
    assert "Q1 FY2026" not in n["lines"]["d_and_a"]["quarterly"]


def test_direct_tag_wins_over_composite():
    fj = _mini_facts({
        "DepreciationDepletionAndAmortization": [_fact("2026-01-01", "2026-03-31", 9.0, filed="2026-05-01")],
        "OtherDepreciationAndAmortization": [_fact("2026-01-01", "2026-03-31", 3.0, filed="2026-05-01")],
        "AmortizationOfIntangibleAssets": [_fact("2026-01-01", "2026-03-31", 2.0, filed="2026-05-01")],
    })
    assert normalize.normalize(fj)["lines"]["d_and_a"]["quarterly"]["Q1 FY2026"] == 9.0


def test_equity_investments_sum():
    fj = _mini_facts({
        "EquitySecuritiesFvNi": [_fact(None, "2026-03-31", 40.0, filed="2026-05-01")],
        "EquitySecuritiesWithoutReadilyDeterminableFairValueAmount": [_fact(None, "2026-03-31", 45.0, filed="2026-05-01")],
    })
    n = normalize.normalize(fj)
    assert n["lines"]["equity_investments"]["quarterly"]["Q1 FY2026"] == 85.0
    assert n["ttm"]["equity_investments"] == 85.0


def test_optional_flows_not_flagged():
    fj = _mini_facts({"PaymentsOfDividends": [_fact("2025-01-01", "2025-09-30", 1.0, filed="2025-11-01")]})
    assert not any("dividends" in x for x in normalize.quality(normalize.normalize(fj)))


def test_split_adjustment_only_for_values_filed_before_split():
    splits = [{"date": "2025-06-10", "ratio": 10.0}]
    fj = _mini_facts({})
    fj["facts"]["us-gaap"]["EarningsPerShareDiluted"] = {"units": {"USD/shares": [
        # Q1 2025 as first reported (filed before the split) -> must be divided by 10
        _fact("2025-01-01", "2025-03-31", 5.0, filed="2025-05-01", accn="old"),
        # Q1 2026 (after the split) -> untouched
        _fact("2026-01-01", "2026-03-31", 0.7, filed="2026-05-01", accn="new"),
    ]}}
    fj["facts"]["us-gaap"]["WeightedAverageNumberOfDilutedSharesOutstanding"] = {"units": {"shares": [
        _fact("2025-01-01", "2025-03-31", 100.0, filed="2025-05-01", accn="old"),
    ]}}
    n = normalize.normalize(fj, splits=splits)
    assert n["lines"]["eps_diluted"]["quarterly"]["Q1 FY2025"] == pytest.approx(0.5)
    assert n["lines"]["eps_diluted"]["quarterly"]["Q1 FY2026"] == pytest.approx(0.7)
    assert n["lines"]["diluted_shares"]["quarterly"]["Q1 FY2025"] == pytest.approx(1000.0)


def test_split_restated_comparative_not_adjusted_twice():
    from datetime import date as D
    sp = [{"date": "2024-06-10", "ratio": 10.0}, {"date": "2021-07-20", "ratio": 4.0}]
    assert normalize.split_factor(D(2020, 1, 26), D(2020, 2, 20), sp) == 40.0   # before both splits
    assert normalize.split_factor(D(2020, 1, 26), D(2022, 3, 18), sp) == 10.0   # restated for the 2021 split only
    assert normalize.split_factor(D(2023, 1, 29), D(2024, 8, 28), sp) == 1.0    # restated for both


def test_debt_current_sums_current_ltd_and_short_term_borrowings():
    """Walmart: current portion of long-term debt and short-term borrowings are two balance-sheet lines."""
    fj = _mini_facts({
        "LongTermDebtCurrent": [_fact(None, "2026-03-31", 4.0, filed="2026-05-01")],
        "ShortTermBorrowings": [_fact(None, "2026-03-31", 3.0, filed="2026-05-01")],
        "DebtCurrent": [_fact(None, "2025-09-30", 6.5)],          # single total only on an older date
        "LongTermDebtNoncurrent": [_fact(None, "2026-03-31", 30.0, filed="2026-05-01")],
        "FinanceLeaseLiabilityCurrent": [_fact(None, "2026-03-31", 1.0, filed="2026-05-01")],
        "FinanceLeaseLiabilityNoncurrent": [_fact(None, "2026-03-31", 5.0, filed="2026-05-01")],
        "MinorityInterest": [_fact(None, "2026-03-31", 2.5, filed="2026-05-01")],
    })
    n = normalize.normalize(fj)
    L = n["lines"]
    assert L["debt_current"]["quarterly"]["Q1 FY2026"] == 7.0       # sum preferred
    assert L["debt_current"]["quarterly"]["Q3 FY2025"] == 6.5       # single total as fallback
    assert L["finance_leases"]["quarterly"]["Q1 FY2026"] == 6.0
    assert L["total_debt"]["quarterly"]["Q1 FY2026"] == 30.0 + 7.0 + 6.0
    assert n["ttm"]["minority_interest"] == 2.5
    assert not any(x.startswith(("finance_leases", "minority")) for x in normalize.quality(n))
