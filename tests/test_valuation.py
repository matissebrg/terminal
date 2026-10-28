"""DCF / comps tests against hand calculations."""
import copy

import pytest

from pipeline import valuation as V


def base_r(**kw):
    r = {
        "years": 5, "base_revenue": 100.0, "revenue_growth": [0.10, 0.10, 0.10, 0.10, 0.10],
        "ebit_margin_start": 0.20, "ebit_margin_target": 0.20, "margin_years_to_target": 1,
        "tax_rate": 0.25, "d_and_a_pct_revenue": 0.05, "capex_pct_revenue": 0.05,
        "nwc_pct_incremental_revenue": 0.0, "terminal_growth": 0.02, "terminal_roic": None,
        "mid_year": False, "wacc": 0.08, "cash": 10.0, "debt": 5.0, "shares": 10.0, "price": 20.0,
    }
    r.update(kw)
    return r


def test_dcf_hand_calculation():
    r = base_r()
    res = V.dcf(r)
    # FCFF_t = 0.2 * 0.75 * Rev_t = 0.15 Rev_t ; Rev_t = 100 * 1.1^t
    pv = sum(0.15 * 100 * 1.1 ** t / 1.08 ** t for t in range(1, 6))
    tv = 0.15 * 100 * 1.1 ** 5 * 1.02 / (0.08 - 0.02)
    ev = pv + tv / 1.08 ** 5
    assert res["sum_pv_fcff"] == pytest.approx(pv)
    assert res["terminal_value"] == pytest.approx(tv)
    assert res["enterprise_value"] == pytest.approx(ev)
    assert res["value_per_share"] == pytest.approx((ev + 10 - 5) / 10)


def test_mid_year_shifts_half_a_year():
    a = V.dcf(base_r())["enterprise_value"]
    b = V.dcf(base_r(mid_year=True))["enterprise_value"]
    assert b == pytest.approx(a * 1.08 ** 0.5)


def test_growth_fade_reaches_terminal():
    r = base_r(years=10, revenue_growth=[0.5, 0.3], terminal_growth=0.03)
    gp = V.growth_path(r)
    assert gp[:2] == [0.5, 0.3]
    assert gp[-1] == pytest.approx(0.03)
    assert all(a >= b for a, b in zip(gp, gp[1:]))  # monotonic fade


def test_margin_converges_linearly():
    res = V.dcf(base_r(ebit_margin_start=0.10, ebit_margin_target=0.30, margin_years_to_target=4))
    m = [row["ebit_margin"] for row in res["rows"]]
    assert m == pytest.approx([0.15, 0.20, 0.25, 0.30, 0.30])


def test_nwc_investment_reduces_fcff():
    a = V.dcf(base_r())["rows"][0]["fcff"]
    b = V.dcf(base_r(nwc_pct_incremental_revenue=0.2))["rows"][0]["fcff"]
    assert a - b == pytest.approx(0.2 * 10)  # ΔRev year 1 = 10


def test_terminal_roic_value_driver():
    r = base_r(terminal_roic=0.20)
    res = V.dcf(r)
    nopat5 = res["rows"][-1]["nopat"]
    assert res["terminal_value"] == pytest.approx(nopat5 * 1.02 * (1 - 0.02 / 0.20) / 0.06)


def test_wacc_must_exceed_g():
    with pytest.raises(ValueError):
        V.dcf(base_r(wacc=0.02, terminal_growth=0.02))


def test_sensitivity_monotonic():
    s = V.sensitivity(base_r())
    g = s["wacc_x_g"]["values"]
    for row in g:   # higher g -> higher value
        vals = [v for v in row if v is not None]
        assert vals == sorted(vals)
    for j in range(len(g[0])):  # higher WACC -> lower value
        col = [row[j] for row in g if row[j] is not None]
        assert col == sorted(col, reverse=True)
    assert g[3][2] == pytest.approx(V.dcf(base_r())["value_per_share"])


def test_reverse_dcf_recovers_growth():
    r = base_r()
    price = V.dcf({**r, "revenue_growth": [0.17] * 5})["value_per_share"]
    out = V.reverse_dcf({**r, "price": price})
    assert out["implied_growth"] == pytest.approx(0.17, abs=1e-6)


def test_scenarios_weighting():
    fin = {"ttm": {"revenue": 100.0, "operating_income": 20.0, "d_and_a": 5.0, "capex": 5.0, "cash": 10.0,
                   "short_term_investments": 0.0, "total_debt": 5.0, "_label": "TTM"},
           "periods": {"annual": [], "quarterly": []}, "lines": {}}
    assump = {
        "dcf": {"years": 5, "base_revenue": "ttm", "revenue_growth": [0.1] * 5, "ebit_margin_start": "auto",
                "ebit_margin_target": 0.2, "margin_years_to_target": 1, "tax_rate": 0.25,
                "d_and_a_pct_revenue": "auto", "capex_pct_revenue": "auto", "nwc_pct_incremental_revenue": 0,
                "terminal_growth": 0.02, "mid_year": False},
        "wacc": {"method": "fixed", "fixed": 0.08, "risk_free": 0.04, "beta": 1.0, "equity_risk_premium": 0.05,
                 "debt_weight": 0.0},
        "scenarios": {"base": {"probability": 2}, "bull": {"probability": 1, "overrides": {"dcf": {
            "ebit_margin_target": 0.3}}}, "bear": {"probability": 1, "overrides": {"wacc": {"fixed": 0.10}}}},
    }
    mkt = {"price": 20.0, "shares": 10.0, "mcap": 200.0, "rf": [0.04, "t", None], "beta": None}
    sc = V.scenarios(assump, fin, mkt)
    c = sc["cases"]
    assert c["base"]["value_per_share"] == pytest.approx(V.dcf(base_r())["value_per_share"])
    assert c["bull"]["value_per_share"] > c["base"]["value_per_share"] > c["bear"]["value_per_share"]
    assert sum(x["probability"] for x in c.values()) == pytest.approx(1.0)
    w = (2 * c["base"]["value_per_share"] + c["bull"]["value_per_share"] + c["bear"]["value_per_share"]) / 4
    assert sc["weighted_value_per_share"] == pytest.approx(w)
    assert assump["dcf"]["ebit_margin_target"] == 0.2  # overrides never mutate the base file


def test_capm_wacc():
    fin = {"ttm": {"revenue": 100.0, "operating_income": 20.0, "total_debt": 50.0, "_label": "TTM"},
           "periods": {"annual": [], "quarterly": []}, "lines": {}}
    assump = {"dcf": {"revenue_growth": [0.1], "ebit_margin_target": 0.2, "tax_rate": 0.2, "terminal_growth": 0.02},
              "wacc": {"method": "capm", "risk_free": "auto", "beta": "auto", "beta_fallback": 1.5,
                       "equity_risk_premium": 0.05, "pre_tax_cost_of_debt": 0.06, "debt_weight": "auto"}}
    mkt = {"price": 10.0, "shares": 15.0, "mcap": 150.0, "rf": [0.04, "t", None],
           "beta": {"raw": 1.3, "adjusted": 1.2, "r2": 0.4}}
    r = V.resolve(assump, fin, mkt)
    ke = 0.04 + 1.2 * 0.05
    assert r["wacc"] == pytest.approx(0.75 * ke + 0.25 * 0.06 * 0.8)
    # insignificant regression -> fallback beta
    mkt["beta"] = {"raw": 0.1, "adjusted": 0.4, "r2": 0.01}
    r = V.resolve(copy.deepcopy(assump), fin, mkt)
    assert r["wacc_detail"]["beta"] == 1.5


def test_comps_excludes_negative_multiples():
    tgt = {"revenue_ttm": 100.0, "ebitda_ttm": 40.0, "net_income_ttm": 30.0, "fcf_ttm": 25.0, "shares": 10.0,
           "cash_and_investments": 20.0, "debt": 0.0, "ev_sales": 10.0}
    peers = [{"ev_sales": 4.0, "ev_ebitda": 10.0, "pe": 20.0, "p_fcf": None, "revenue_growth_ttm": 0.1},
             {"ev_sales": 6.0, "ev_ebitda": None, "pe": None, "p_fcf": 15.0, "revenue_growth_ttm": 0.2},
             {"ev_sales": 8.0, "ev_ebitda": 14.0, "pe": 25.0, "p_fcf": 30.0, "revenue_growth_ttm": 0.3}]
    c = V.comps(tgt, peers)
    assert c["multiples"]["ev_sales"]["median"] == 6.0
    assert c["multiples"]["ev_ebitda"]["n"] == 2
    assert c["implied"]["ev_sales"] == pytest.approx((6.0 * 100 + 20) / 10)
    assert c["implied"]["pe"] == pytest.approx(22.5 * 30 / 10)
    assert c["growth_regression"]["slope"] == pytest.approx(20.0)


def test_equity_investments_added_to_bridge():
    a = V.dcf(base_r())
    b = V.dcf(base_r(investments=20.0))
    assert b["enterprise_value"] == pytest.approx(a["enterprise_value"])
    assert b["value_per_share"] - a["value_per_share"] == pytest.approx(2.0)  # 20 / 10 shares
