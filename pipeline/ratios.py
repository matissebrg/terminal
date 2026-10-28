"""Financial ratios computed from the canonical statements.

Every ratio is defined once here (formula + French label + format + group), so
the UI can show the definition next to the number. Ratios that need a market
price (P/E, EV/EBITDA...) live in valuation.py, because they move every day.
"""
from __future__ import annotations

PCT, X, DAYS, USD = "pct", "x", "days", "usd"

# key: (label, group, fmt, definition)
RATIOS = {
    "gross_margin": ("Marge brute", "Rentabilité", PCT, "Marge brute / CA"),
    "operating_margin": ("Marge opérationnelle", "Rentabilité", PCT, "EBIT / CA"),
    "ebitda_margin": ("Marge d'EBITDA", "Rentabilité", PCT, "(EBIT + D&A) / CA"),
    "net_margin": ("Marge nette", "Rentabilité", PCT, "Résultat net / CA"),
    "fcf_margin": ("Marge de FCF", "Rentabilité", PCT, "(CFO - capex) / CA"),
    "roe": ("ROE", "Rendement du capital", PCT, "Résultat net / capitaux propres moyens"),
    "roic": ("ROIC", "Rendement du capital", PCT,
             "EBIT × (1 - taux d'impôt effectif) / (capitaux propres + dette - trésorerie et placements), moyenne"),
    "roa": ("ROA", "Rendement du capital", PCT, "Résultat net / total actif moyen"),
    "revenue_growth": ("Croissance du CA", "Croissance", PCT, "CA / CA même période N-1 - 1"),
    "operating_income_growth": ("Croissance de l'EBIT", "Croissance", PCT, "EBIT / EBIT N-1 - 1"),
    "eps_growth": ("Croissance du BPA", "Croissance", PCT, "BPA dilué / BPA N-1 - 1"),
    "fcf_growth": ("Croissance du FCF", "Croissance", PCT, "FCF / FCF N-1 - 1"),
    "rnd_pct": ("R&D / CA", "Structure de coûts", PCT, "Dépenses de R&D / CA"),
    "sga_pct": ("SG&A / CA", "Structure de coûts", PCT, "Frais commerciaux et G&A / CA"),
    "sbc_pct": ("Rémun. en actions / CA", "Structure de coûts", PCT, "Stock-based compensation / CA"),
    "capex_pct": ("Capex / CA", "Structure de coûts", PCT, "Investissements corporels / CA"),
    "tax_rate": ("Taux d'impôt effectif", "Structure de coûts", PCT, "Impôt / résultat avant impôt"),
    "current_ratio": ("Ratio de liquidité générale", "Bilan & liquidité", X, "Actif courant / passif courant"),
    "debt_to_equity": ("Dette / capitaux propres", "Bilan & liquidité", X, "Dette financière / capitaux propres"),
    "net_cash": ("Trésorerie nette", "Bilan & liquidité", USD, "Cash + placements CT - dette financière"),
    "cash_conversion": ("Conversion en cash", "Bilan & liquidité", X, "FCF / résultat net"),
    "dso": ("DSO (délai clients)", "Efficacité", DAYS, "Créances / CA × jours de la période"),
    "dio": ("DIO (rotation des stocks)", "Efficacité", DAYS, "Stocks / coût des ventes × jours de la période"),
    "asset_turnover": ("Rotation de l'actif", "Efficacité", X, "CA / total actif moyen (annualisé)"),
    "shareholder_return_pct": ("Retour aux actionnaires / FCF", "Allocation du capital", PCT,
                               "(Rachats + dividendes) / FCF"),
}


def _div(a, b):
    if a is None or b in (None, 0):
        return None
    return a / b


def _avg(a, b):
    if a is None:
        return None
    return a if b is None else (a + b) / 2


def compute(fin: dict) -> dict:
    out = {"definitions": {k: {"label": v[0], "group": v[1], "fmt": v[2], "def": v[3]} for k, v in RATIOS.items()},
           "annual": {}, "quarterly": {}, "ttm": {}}
    L = fin["lines"]
    for freq, days, annualize in (("annual", 365, 1), ("quarterly", 91, 4)):
        labels = [p["label"] for p in fin["periods"][freq]]
        lag = 1 if freq == "annual" else 4  # YoY comparison
        res = {k: {} for k in RATIOS}
        for i, l in enumerate(labels):
            g = lambda n, lab=l: L.get(n, {}).get(freq, {}).get(lab)  # noqa: E731
            prev_l = labels[i - 1] if i >= 1 else None          # previous period (balance averages)
            yoy_l = labels[i - lag] if i >= lag else None       # same period last year
            gp = lambda n: L.get(n, {}).get(freq, {}).get(prev_l) if prev_l else None  # noqa: E731
            gy = lambda n: L.get(n, {}).get(freq, {}).get(yoy_l) if yoy_l else None  # noqa: E731
            rev = g("revenue")
            r = res
            r["gross_margin"][l] = _div(g("gross_profit"), rev)
            r["operating_margin"][l] = _div(g("operating_income"), rev)
            r["ebitda_margin"][l] = _div(g("ebitda"), rev)
            r["net_margin"][l] = _div(g("net_income"), rev)
            r["fcf_margin"][l] = _div(g("fcf"), rev)
            r["rnd_pct"][l] = _div(g("rnd"), rev)
            r["sga_pct"][l] = _div(g("sga"), rev)
            r["sbc_pct"][l] = _div(g("sbc"), rev)
            r["capex_pct"][l] = _div(g("capex"), rev)
            tax = _div(g("income_tax"), g("pretax_income"))
            r["tax_rate"][l] = tax
            ni = g("net_income")
            r["roe"][l] = _mul(_div(ni, _avg(g("equity"), gp("equity"))), annualize)
            r["roa"][l] = _mul(_div(ni, _avg(g("total_assets"), gp("total_assets"))), annualize)
            ic = _invested_capital(g)
            ic_prev = _invested_capital(gp) if prev_l else None
            t = min(max(tax, 0.0), 0.5) if tax is not None else 0.21
            nopat = g("operating_income") * (1 - t) if g("operating_income") is not None else None
            r["roic"][l] = _mul(_div(nopat, _avg(ic, ic_prev)), annualize)
            r["revenue_growth"][l] = _growth(rev, gy("revenue"))
            r["operating_income_growth"][l] = _growth(g("operating_income"), gy("operating_income"))
            r["eps_growth"][l] = _growth(g("eps_diluted"), gy("eps_diluted"))
            r["fcf_growth"][l] = _growth(g("fcf"), gy("fcf"))
            r["current_ratio"][l] = _div(g("current_assets"), g("current_liabilities"))
            r["debt_to_equity"][l] = _div(g("total_debt"), g("equity"))
            r["net_cash"][l] = g("net_cash")
            r["cash_conversion"][l] = _div(g("fcf"), ni) if (ni or 0) > 0 else None
            r["dso"][l] = _mul(_div(g("receivables"), rev), days)
            r["dio"][l] = _mul(_div(g("inventory"), g("cost_of_revenue")), days)
            r["asset_turnover"][l] = _mul(_div(rev, _avg(g("total_assets"), gp("total_assets"))), annualize)
            ret = (g("buybacks") or 0) + (g("dividends_paid") or 0)
            r["shareholder_return_pct"][l] = _div(ret, g("fcf")) if (g("fcf") or 0) > 0 else None
        out[freq] = {k: {l: _clean(v) for l, v in d.items()} for k, d in res.items()}

    # TTM view (latest)
    T = fin["ttm"]
    rev = T.get("revenue")
    tt = {
        "gross_margin": _div(T.get("gross_profit"), rev),
        "operating_margin": _div(T.get("operating_income"), rev),
        "ebitda_margin": _div(T.get("ebitda"), rev),
        "net_margin": _div(T.get("net_income"), rev),
        "fcf_margin": _div(T.get("fcf"), rev),
        "rnd_pct": _div(T.get("rnd"), rev),
        "sga_pct": _div(T.get("sga"), rev),
        "sbc_pct": _div(T.get("sbc"), rev),
        "capex_pct": _div(T.get("capex"), rev),
        "tax_rate": _div(T.get("income_tax"), T.get("pretax_income")),
        "revenue_growth": _growth(rev, T.get("revenue_prev")),
        "operating_income_growth": _growth(T.get("operating_income"), T.get("operating_income_prev")),
        "eps_growth": _growth(T.get("eps_diluted"), T.get("eps_diluted_prev")),
        "fcf_growth": _growth(T.get("fcf"), T.get("fcf_prev")),
        "current_ratio": _div(T.get("current_assets"), T.get("current_liabilities")),
        "debt_to_equity": _div(T.get("total_debt"), T.get("equity")),
        "net_cash": T.get("net_cash"),
        "cash_conversion": _div(T.get("fcf"), T.get("net_income")) if (T.get("net_income") or 0) > 0 else None,
    }
    q_last = fin["periods"]["quarterly"][-5:-4] if len(fin["periods"]["quarterly"]) >= 5 else []
    eq_prev = L["equity"]["quarterly"].get(q_last[0]["label"]) if q_last else None
    tt["roe"] = _div(T.get("net_income"), _avg(T.get("equity"), eq_prev))
    ic = _invested_capital(lambda n: T.get(n))
    t = tt["tax_rate"] if tt["tax_rate"] is not None else 0.21
    tt["roic"] = _div(T.get("operating_income") * (1 - min(max(t, 0), 0.5)), ic) \
        if T.get("operating_income") is not None else None
    out["ttm"] = {k: _clean(v) for k, v in tt.items()}
    return out


def _invested_capital(g):
    eq = g("equity")
    if eq is None:
        return None
    ic = eq + (g("total_debt") or 0) - (g("cash") or 0) - (g("short_term_investments") or 0)
    # A cash-rich company can have zero or negative invested capital: ROIC is then meaningless.
    return ic if ic > 0 else None


def _growth(a, b):
    if a is None or b in (None, 0) or b < 0:
        return None
    return a / b - 1


def _mul(a, k):
    return None if a is None else a * k


def _clean(v):
    if v is None:
        return None
    return round(v, 6) if abs(v) < 1e6 else round(v, 0)
