"""Valuation engine: FCFF DCF (2-stage with fade), scenarios, sensitivities,
reverse DCF and trading comparables.

The same DCF is implemented in docs/assets/dcf.js for the interactive page;
tests/test_dcf_parity.py checks that both give identical results.

Conventions (documented because they move the result):
  * FCFF = EBIT × (1 − t) + D&A − capex − ΔBFR. Stock-based compensation is
    NOT added back: it is treated as a real cost (it is, it dilutes shareholders).
  * Revenue growth: explicit years from the assumption file, then a linear fade
    to the terminal growth rate in year N.
  * Mid-year convention (optional): cash flows arrive in the middle of each year,
    so year t is discounted by (1+WACC)^(t−0.5). With the Gordon-growth terminal
    value the same half-year shift applies to the terminal value.
  * Equity value = EV + cash + short-term investments − financial debt.
"""
from __future__ import annotations

import copy
import statistics

# --------------------------------------------------------------------------- assumptions


def deep_merge(base: dict, over: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def resolve(assump: dict, fin: dict, market: dict) -> dict:
    """Turn the YAML (which may contain 'auto') into plain numbers, and record where each came from.

    market = {price, shares, rf: (val, src, asof), beta: {...} | None, mcap}
    """
    d = assump["dcf"]
    w = assump["wacc"]
    T = fin["ttm"]
    src = {}

    def auto(val, computed, label, fallback=None):
        if val == "auto" or val is None:
            if computed is None:
                src[label] = "fallback"
                return fallback
            src[label] = "données (TTM)"
            return computed
        src[label] = "hypothèse"
        return float(val)

    rev = T.get("revenue")
    if d.get("base_revenue", "ttm") == "ttm":
        base_rev, src["base_revenue"] = rev, f"CA {T.get('_label', 'TTM')}"
    elif d["base_revenue"] == "last_fy":
        last = fin["periods"]["annual"][-1]["label"]
        base_rev, src["base_revenue"] = fin["lines"]["revenue"]["annual"][last], f"CA {last}"
    else:
        base_rev, src["base_revenue"] = float(d["base_revenue"]), "hypothèse"

    m0 = (T.get("operating_income") / rev) if rev else None
    da = (T.get("d_and_a") / rev) if rev and T.get("d_and_a") is not None else None
    cx = (T.get("capex") / rev) if rev and T.get("capex") is not None else None

    r = {
        "years": int(d.get("years", 10)),
        "base_revenue": base_rev,
        "revenue_growth": [float(x) for x in d["revenue_growth"]],
        "ebit_margin_start": auto(d.get("ebit_margin_start", "auto"), m0, "ebit_margin_start", 0.2),
        "ebit_margin_target": float(d["ebit_margin_target"]),
        "margin_years_to_target": int(d.get("margin_years_to_target", 5)),
        "tax_rate": float(d["tax_rate"]),
        "d_and_a_pct_revenue": auto(d.get("d_and_a_pct_revenue", "auto"), da, "d_and_a_pct_revenue", 0.03),
        "capex_pct_revenue": auto(d.get("capex_pct_revenue", "auto"), cx, "capex_pct_revenue", 0.04),
        "nwc_pct_incremental_revenue": float(d.get("nwc_pct_incremental_revenue", 0.1)),
        "terminal_growth": float(d["terminal_growth"]),
        "terminal_roic": float(d["terminal_roic"]) if d.get("terminal_roic") not in (None, "null") else None,
        "mid_year": bool(d.get("mid_year", True)),
    }

    # ---- WACC
    rf_val, rf_src, rf_asof = market["rf"]
    if w.get("risk_free", "auto") == "auto":
        rf, src["risk_free"] = rf_val, f"{rf_src}" + (f" au {rf_asof}" if rf_asof else "")
    else:
        rf, src["risk_free"] = float(w["risk_free"]), "hypothèse"
    if w.get("beta", "auto") == "auto":
        b = market.get("beta")
        if b and b.get("r2", 0) >= 0.05:
            beta, src["beta"] = b["adjusted"], (f"régression 2 ans hebdo vs SPY (brut {b['raw']}, "
                                                f"R² {b['r2']}, ajusté Blume)")
        else:
            beta = float(w.get("beta_fallback", 1.2))
            src["beta"] = ("fallback : régression non significative (R² < 0,05)" if b
                           else "fallback : historique de cours insuffisant")
    else:
        beta, src["beta"] = float(w["beta"]), "hypothèse"
    erp = float(w["equity_risk_premium"])
    kd = float(w.get("pre_tax_cost_of_debt", 0.05))
    debt = T.get("total_debt") or 0.0
    mcap = market.get("mcap") or 0.0
    if w.get("debt_weight", "auto") == "auto":
        wd = debt / (debt + mcap) if (debt + mcap) > 0 else 0.0
        src["debt_weight"] = "poids de marché (dette / (dette + capitalisation))"
    else:
        wd, src["debt_weight"] = float(w["debt_weight"]), "hypothèse"
    ke = rf + beta * erp
    if w.get("method", "capm") == "fixed":
        wacc, src["wacc"] = float(w["fixed"]), "hypothèse (fixe)"
    else:
        wacc = (1 - wd) * ke + wd * kd * (1 - r["tax_rate"])
        src["wacc"] = "CAPM"
    r["wacc"] = wacc
    r["wacc_detail"] = {"risk_free": rf, "beta": beta, "equity_risk_premium": erp, "cost_of_equity": ke,
                        "pre_tax_cost_of_debt": kd, "after_tax_cost_of_debt": kd * (1 - r["tax_rate"]),
                        "debt_weight": wd, "equity_weight": 1 - wd, "method": w.get("method", "capm")}

    # ---- bridge EV -> equity
    r["cash"] = (T.get("cash") or 0.0) + (T.get("short_term_investments") or 0.0)
    r["debt"] = debt
    r["shares"] = market["shares"]
    r["price"] = market.get("price")
    r["_sources"] = src
    return r


# --------------------------------------------------------------------------- DCF


def growth_path(r: dict) -> list[float]:
    n, ex, tg = r["years"], list(r["revenue_growth"]), r["terminal_growth"]
    ex = ex[:n]
    e = len(ex)
    if e == 0:
        return [tg] * n
    last = ex[-1]
    path = ex[:]
    for t in range(e + 1, n + 1):
        path.append(last + (tg - last) * (t - e) / (n - e))
    return path


def dcf(r: dict) -> dict:
    n, w, g = r["years"], r["wacc"], r["terminal_growth"]
    if w <= g + 0.0025:
        raise ValueError(f"WACC ({w:.2%}) doit être supérieur à la croissance terminale ({g:.2%})")
    gp = growth_path(r)
    m0, m1, my = r["ebit_margin_start"], r["ebit_margin_target"], max(1, r["margin_years_to_target"])
    rows, rev_prev, pv_sum = [], r["base_revenue"], 0.0
    for t in range(1, n + 1):
        rev = rev_prev * (1 + gp[t - 1])
        m = m0 + (m1 - m0) * min(t, my) / my
        ebit = rev * m
        nopat = ebit * (1 - r["tax_rate"])
        da = rev * r["d_and_a_pct_revenue"]
        capex = rev * r["capex_pct_revenue"]
        dnwc = (rev - rev_prev) * r["nwc_pct_incremental_revenue"]
        fcff = nopat + da - capex - dnwc
        expo = t - 0.5 if r["mid_year"] else t
        df = 1 / (1 + w) ** expo
        pv = fcff * df
        pv_sum += pv
        rows.append({"year": t, "revenue": rev, "growth": gp[t - 1], "ebit_margin": m, "ebit": ebit,
                     "nopat": nopat, "d_and_a": da, "capex": capex, "delta_nwc": dnwc, "fcff": fcff,
                     "discount_factor": df, "pv": pv})
        rev_prev = rev
    last = rows[-1]
    if r.get("terminal_roic"):
        reinvest = g / r["terminal_roic"]
        fcff_next = last["nopat"] * (1 + g) * (1 - reinvest)
        tv_method = f"Gordon, réinvestissement = g / ROIC terminal ({r['terminal_roic']:.0%})"
    else:
        fcff_next = last["fcff"] * (1 + g)
        tv_method = "Gordon sur FCFF(N) × (1 + g)"
    tv = fcff_next / (w - g)
    tv_expo = n - 0.5 if r["mid_year"] else n
    pv_tv = tv / (1 + w) ** tv_expo
    ev = pv_sum + pv_tv
    equity = ev + r["cash"] - r["debt"]
    per_share = equity / r["shares"] if r["shares"] else None
    ebitda_n = last["ebit"] + last["d_and_a"]
    return {
        "rows": rows,
        "sum_pv_fcff": pv_sum,
        "terminal_value": tv,
        "pv_terminal_value": pv_tv,
        "terminal_value_share_of_ev": pv_tv / ev if ev else None,
        "terminal_method": tv_method,
        "implied_exit_ev_ebitda": tv / ebitda_n if ebitda_n > 0 else None,
        "enterprise_value": ev,
        "cash": r["cash"],
        "debt": r["debt"],
        "equity_value": equity,
        "shares": r["shares"],
        "value_per_share": per_share,
        "upside": (per_share / r["price"] - 1) if per_share and r.get("price") else None,
    }


def value_only(r: dict) -> float | None:
    try:
        return dcf(r)["value_per_share"]
    except ValueError:
        return None


def sensitivity(r: dict) -> dict:
    w_off = [-0.015, -0.01, -0.005, 0.0, 0.005, 0.01, 0.015]
    g_off = [-0.01, -0.005, 0.0, 0.005, 0.01]
    wacc_vals = [r["wacc"] + x for x in w_off]
    g_vals = [r["terminal_growth"] + x for x in g_off]
    grid1 = [[value_only({**r, "wacc": wv, "terminal_growth": gv}) for gv in g_vals] for wv in wacc_vals]

    m_off = [-0.15, -0.10, -0.05, 0.0, 0.05]
    k_vals = [0.6, 0.8, 1.0, 1.2, 1.4]
    m_vals = [r["ebit_margin_target"] + x for x in m_off]
    grid2 = [[value_only({**r, "ebit_margin_target": mv,
                          "revenue_growth": [x * k for x in r["revenue_growth"]]}) for k in k_vals]
             for mv in m_vals]
    return {
        "wacc_x_g": {"rows": wacc_vals, "cols": g_vals, "values": grid1,
                     "row_label": "WACC", "col_label": "Croissance terminale"},
        "margin_x_growth": {"rows": m_vals, "cols": k_vals, "values": grid2,
                            "row_label": "Marge EBIT cible", "col_label": "Multiplicateur de croissance explicite"},
    }


def reverse_dcf(r: dict) -> dict | None:
    """Constant revenue growth over the explicit years that justifies today's price
    (all other assumptions unchanged)."""
    price = r.get("price")
    e = max(1, len(r["revenue_growth"]))
    if not price:
        return None

    def f(c):
        v = value_only({**r, "revenue_growth": [c] * e})
        return None if v is None else v - price

    lo, hi = -0.5, 2.0
    flo, fhi = f(lo), f(hi)
    if flo is None or fhi is None or flo > 0 or fhi < 0:
        return {"implied_growth": None, "years": e, "note": "hors de la plage [−50 %, +200 %]"}
    for _ in range(80):
        mid = (lo + hi) / 2
        fm = f(mid)
        if fm is None:
            break
        if fm > 0:
            hi = mid
        else:
            lo = mid
    c = (lo + hi) / 2
    return {"implied_growth": c, "years": e,
            "implied_revenue_year_n": r["base_revenue"] * (1 + c) ** e,
            "assumed_growth_cagr": _cagr(r["revenue_growth"])}


def _cagr(path):
    p = 1.0
    for x in path:
        p *= 1 + x
    return p ** (1 / len(path)) - 1 if path else None


def scenarios(assump: dict, fin: dict, market: dict) -> dict:
    sc = assump.get("scenarios") or {"base": {"probability": 1.0}}
    out, tot = {}, 0.0
    for name, spec in sc.items():
        a = copy.deepcopy(assump)
        ov = (spec or {}).get("overrides") or {}
        a["dcf"] = deep_merge(a["dcf"], ov.get("dcf") or {})
        a["wacc"] = deep_merge(a["wacc"], ov.get("wacc") or {})
        r = resolve(a, fin, market)
        res = dcf(r)
        p = float((spec or {}).get("probability", 0))
        tot += p
        out[name] = {"probability": p, "value_per_share": res["value_per_share"],
                     "enterprise_value": res["enterprise_value"], "wacc": r["wacc"],
                     "revenue_year_n": res["rows"][-1]["revenue"], "ebit_margin_target": r["ebit_margin_target"],
                     "growth_path": growth_path(r), "narrative": (spec or {}).get("narrative", ""),
                     "overrides": (spec or {}).get("overrides", {})}
    weighted = None
    if tot > 0:
        weighted = sum(v["probability"] * v["value_per_share"] for v in out.values()) / tot
        for v in out.values():
            v["probability"] = v["probability"] / tot
    return {"cases": out, "weighted_value_per_share": weighted}


# --------------------------------------------------------------------------- comparables
MULTIPLES = {
    "ev_sales": ("VE / CA", "enterprise", "revenue"),
    "ev_ebitda": ("VE / EBITDA", "enterprise", "ebitda"),
    "pe": ("P / E (cours / BPA)", "equity", "net_income"),
    "p_fcf": ("Capi / FCF", "equity", "fcf"),
}


def company_snapshot(ticker: str, name: str, fin: dict, price: float | None, shares: float | None) -> dict:
    T = fin["ttm"]
    cash = (T.get("cash") or 0) + (T.get("short_term_investments") or 0)
    debt = T.get("total_debt") or 0
    mcap = price * shares if price and shares else None
    ev = mcap + debt - cash if mcap is not None else None
    rev = T.get("revenue")
    snap = {
        "ticker": ticker, "name": name, "price": price, "shares": shares, "market_cap": mcap,
        "cash_and_investments": cash, "debt": debt, "enterprise_value": ev,
        "revenue_ttm": rev, "ebitda_ttm": T.get("ebitda"), "net_income_ttm": T.get("net_income"),
        "fcf_ttm": T.get("fcf"), "operating_income_ttm": T.get("operating_income"),
        "revenue_growth_ttm": (rev / T["revenue_prev"] - 1) if rev and T.get("revenue_prev") else None,
        "gross_margin_ttm": (T["gross_profit"] / rev) if rev and T.get("gross_profit") is not None else None,
        "operating_margin_ttm": (T["operating_income"] / rev) if rev and T.get("operating_income") is not None
        else None,
        "net_margin_ttm": (T["net_income"] / rev) if rev and T.get("net_income") is not None else None,
        "rnd_pct_ttm": (T["rnd"] / rev) if rev and T.get("rnd") is not None else None,
        "period": T.get("_label"),
    }
    for k, (_, base, metric) in MULTIPLES.items():
        num = ev if base == "enterprise" else mcap
        den = T.get(metric)
        snap[k] = num / den if (num is not None and den and den > 0) else None
    return snap


def comps(target: dict, peers: list[dict]) -> dict:
    out = {"multiples": {}, "implied": {}}
    implied_vals = []
    for k, (label, base, metric) in MULTIPLES.items():
        vals = [p[k] for p in peers if p.get(k) is not None and 0 < p[k] < 500]
        if not vals:
            out["multiples"][k] = {"label": label, "n": 0}
            continue
        med = statistics.median(vals)
        metric_val = {"revenue": target["revenue_ttm"], "ebitda": target["ebitda_ttm"],
                      "net_income": target["net_income_ttm"], "fcf": target["fcf_ttm"]}[metric]
        per_share = None
        if metric_val and metric_val > 0 and target.get("shares"):
            if base == "enterprise":
                eq = med * metric_val + target["cash_and_investments"] - target["debt"]
            else:
                eq = med * metric_val
            per_share = eq / target["shares"]
            implied_vals.append(per_share)
        out["multiples"][k] = {"label": label, "n": len(vals), "median": med, "mean": sum(vals) / len(vals),
                               "low": min(vals), "high": max(vals), "target": target.get(k),
                               "premium_vs_median": (target[k] / med - 1) if target.get(k) else None}
        out["implied"][k] = per_share
    if implied_vals:
        out["implied_summary"] = {"low": min(implied_vals), "median": statistics.median(implied_vals),
                                  "high": max(implied_vals)}
    # Growth-adjusted view: EV/Sales regressed on TTM growth across peers (indicative only, small n)
    pts = [(p["revenue_growth_ttm"], p["ev_sales"]) for p in peers
           if p.get("revenue_growth_ttm") is not None and p.get("ev_sales")]
    if len(pts) >= 3:
        xs, ys = zip(*pts)
        mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
        sxx = sum((x - mx) ** 2 for x in xs)
        if sxx > 0:
            slope = sum((x - mx) * (y - my) for x, y in pts) / sxx
            icpt = my - slope * mx
            tg = target.get("revenue_growth_ttm")
            out["growth_regression"] = {
                "slope": slope, "intercept": icpt, "n": len(pts),
                "implied_ev_sales_for_target": (icpt + slope * tg) if tg is not None else None,
                "warning": "n très faible : indicatif uniquement, pas un objectif de cours"}
    return out
