"""Risk-adjusted NPV (rNPV) for drug pipelines, and what a catalyst means for the share price.

A biotech's value is a sum of programmes, each a cash-flow profile multiplied by the probability that
the drug reaches the market. The probability comes from historical phase-transition rates (BIO /
Informa / QLS, "Clinical Development Success Rates 2011-2020") unless the YAML gives one.

Per programme and per year t (from the valuation date to the horizon):
    sales(t)    linear ramp from launch to peak over `years_to_peak`, flat until loss of exclusivity,
                then -`post_loe_decline` per year
    profit(t)   sales x share x (1 - cogs - opex)   or   sales x royalty_rate for an out-licensed drug
                - tax on positive profit (losses give no shield: conservative)
    risked      profit(t) x PoS(to market)                       (revenue side)
                - dev_cost(t) x P(programme still alive in t)    (cost side, spread until launch)
    PV          discounted at `discount_rate` to mid-year (failure risk is in the PoS, not in the rate)

Equity = sum of programmes - PV(unallocated corporate costs after tax) + net cash (+ other value).

Catalysts: a pending event moves a programme one stage (phase 3 -> filed, filed -> marketed...).
On success the PoS is divided by the step probability; on failure the programme is worth 0 (future
development costs are avoided). Solving for the probability that makes the model equal to the market
price gives the market-implied probability of the event, with everything else held at your inputs.
docs/assets/rnpv.js is the browser twin (tests/test_rnpv.py checks they agree).
"""
from __future__ import annotations

from datetime import date

# (phase I->II, phase II->III, phase III->NDA/BLA, NDA/BLA->approval)
SOURCE = "BIO, Informa Pharma Intelligence, QLS - Clinical Development Success Rates 2011-2020 (2021)"
BASE_RATES: dict[str, tuple[float, float, float, float]] = {
    "all": (0.520, 0.289, 0.578, 0.906),
    "oncology": (0.488, 0.246, 0.477, 0.920),
    "hematology": (0.696, 0.481, 0.768, 0.931),
    "metabolic": (0.618, 0.450, 0.636, 0.875),
    "endocrine": (0.433, 0.266, 0.662, 0.863),
    "neurology": (0.477, 0.268, 0.531, 0.867),
    "cardiovascular": (0.500, 0.210, 0.552, 0.825),
    "infectious": (0.578, 0.384, 0.640, 0.929),
    "autoimmune": (0.552, 0.314, 0.653, 0.941),
    "ophthalmology": (0.716, 0.355, 0.512, 0.911),
    "respiratory": (0.559, 0.219, 0.645, 0.956),
    "psychiatry": (0.527, 0.268, 0.563, 0.912),
    "gastroenterology": (0.467, 0.342, 0.571, 0.909),
    "urology": (0.409, 0.150, 0.692, 0.846),
    "allergy": (0.564, 0.283, 0.647, 1.000),
    "rare": (0.674, 0.446, 0.604, 0.936),          # rare diseases, non-oncology
    "biomarker": (0.524, 0.463, 0.682, 0.960),     # trials with patient-preselection biomarkers
}
AREA_LABELS = {
    "all": "Toutes indications", "oncology": "Oncologie", "hematology": "Hématologie", "metabolic": "Métabolisme",
    "endocrine": "Endocrinologie", "neurology": "Neurologie", "cardiovascular": "Cardiovasculaire",
    "infectious": "Infectiologie", "autoimmune": "Auto-immunité", "ophthalmology": "Ophtalmologie",
    "respiratory": "Respiratoire", "psychiatry": "Psychiatrie", "gastroenterology": "Gastro-entérologie",
    "urology": "Urologie", "allergy": "Allergologie", "rare": "Maladies rares (hors oncologie)",
    "biomarker": "Essais avec biomarqueur de sélection",
}
STAGES = ["phase1", "phase2", "phase3", "filed", "marketed"]
STAGE_LABELS = {"phase1": "Phase 1", "phase2": "Phase 2", "phase3": "Phase 3", "filed": "Dossier déposé (NDA/BLA)",
                "marketed": "Commercialisé"}
NEXT_EVENT = {"phase1": "résultats de phase 1", "phase2": "résultats de phase 2", "phase3": "résultats de phase 3",
              "filed": "décision de la FDA", "marketed": None}

DEFAULTS = {"years_to_peak": 6, "post_loe_decline": 0.6, "cogs_pct": 0.10, "opex_pct": 0.25, "share": 1.0,
            "royalty_rate": None, "dev_cost": 0.0, "pos": "auto", "area": "all"}


def rates(area: str | None) -> tuple[float, ...]:
    return BASE_RATES.get((area or "all").lower(), BASE_RATES["all"])


def pos_to_market(stage: str, area: str | None) -> float:
    """Cumulative probability of approval from the current stage."""
    if stage == "marketed":
        return 1.0
    r = rates(area)
    i = STAGES.index(stage)
    p = 1.0
    for k in range(i, 4):
        p *= r[k]
    return p


def step_probability(stage: str, area: str | None) -> float | None:
    """Probability of the NEXT event succeeding (e.g. phase 3 -> filing, filing -> approval)."""
    if stage == "marketed":
        return None
    return rates(area)[STAGES.index(stage)]


def _year_weights(year: int, valuation_date: date) -> tuple[float, float]:
    """(fraction of the year still ahead, discount time in years to the middle of that part)."""
    y0 = valuation_date.year
    if year < y0:
        return 0.0, 0.0
    if year == y0:
        frac = max(0.0, (date(y0 + 1, 1, 1) - valuation_date).days / 365.25)
        return frac, frac / 2
    start = (date(year, 1, 1) - valuation_date).days / 365.25
    return 1.0, start + 0.5


def sales_curve(a: dict, year: int) -> float:
    launch, peak = int(a["launch_year"]), float(a["peak_sales"])
    if year < launch:
        return 0.0
    ytp = max(1, int(a.get("years_to_peak") or DEFAULTS["years_to_peak"]))
    s = peak * min(1.0, (year - launch + 1) / ytp)
    loe = a.get("loe_year")
    if loe and year >= int(loe):
        s *= (1 - float(a.get("post_loe_decline", DEFAULTS["post_loe_decline"]))) ** (year - int(loe) + 1)
    return s


def resolve_asset(a: dict) -> dict:
    a = {**DEFAULTS, **a}
    stage = str(a.get("stage", "phase2")).lower()
    if stage not in STAGES:
        raise ValueError(f"programme {a.get('name')}: stade inconnu '{stage}' ({', '.join(STAGES)})")
    a["stage"] = stage
    base = pos_to_market(stage, a.get("area"))
    auto = a.get("pos") in (None, "auto")
    a["pos_base"] = base
    a["pos"] = base if auto else min(1.0, max(0.0, float(a["pos"])))
    a["pos_source"] = "taux historique" if auto else "hypothèse"
    # probability of the steps AFTER the next event (base rates); the next event's probability is what
    # remains of the programme's PoS once those are taken out (= the base rate when PoS is "auto")
    a["later_p"] = pos_to_market(STAGES[STAGES.index(stage) + 1], a.get("area")) if stage != "marketed" else None
    a["step_base"] = step_probability(stage, a.get("area"))
    a["step_p"] = min(1.0, a["pos"] / a["later_p"]) if a["later_p"] else None
    return a


def asset_value(a: dict, *, discount_rate: float, tax_rate: float, valuation_date: date, horizon: int,
                pos: float | None = None) -> dict:
    """PV of one programme. `pos` overrides the probability (used for success scenarios)."""
    p = a["pos"] if pos is None else pos
    launch = int(a["launch_year"])
    # probability the programme is still alive while costs are spent: geometric path from 1 today to
    # P(reaching a filing) the year before launch (approximation of the phase-by-phase attrition)
    p_file = min(1.0, p / (rates(a.get("area"))[3] if a["stage"] != "marketed" else 1.0))
    dev_years = [y for y in range(valuation_date.year, launch) if _year_weights(y, valuation_date)[0] > 0]
    dev_total = float(a.get("dev_cost") or 0.0)
    rev_pv = dev_pv = 0.0
    series = []
    for y in range(valuation_date.year, horizon + 1):
        w, t = _year_weights(y, valuation_date)
        if w <= 0:
            continue
        df = (1 + discount_rate) ** -t
        sales = sales_curve(a, y) * w
        if a.get("royalty_rate"):
            profit = sales * float(a["royalty_rate"])
        else:
            profit = sales * float(a["share"]) * (1 - float(a["cogs_pct"]) - float(a["opex_pct"]))
        profit -= max(0.0, profit) * tax_rate
        dev = 0.0
        if dev_total and y in dev_years:
            n = len(dev_years)
            i = dev_years.index(y)
            alive = p_file ** (i / n) if n else 1.0
            dev = -dev_total / n * alive   # R&D before revenue: no tax shield assumed (conservative)
        rev_pv += profit * p * df
        dev_pv += dev * df
        series.append({"year": y, "sales": sales, "risked_cf": profit * p + dev})
    return {"rnpv": rev_pv + dev_pv, "revenue_pv": rev_pv, "dev_pv": dev_pv, "series": series}


def value(cfg: dict, *, net_cash: float, shares: float, price: float | None, valuation_date: date) -> dict:
    """cfg = the `rnpv:` block of config/assumptions/<T>.yaml."""
    r = float(cfg.get("discount_rate", 0.10))
    tax = float(cfg.get("tax_rate", 0.21))
    horizon = int(cfg.get("horizon", valuation_date.year + 20))
    assets = [resolve_asset(a) for a in cfg.get("assets") or []]
    kw = dict(discount_rate=r, tax_rate=tax, valuation_date=valuation_date, horizon=horizon)
    out_assets = []
    for a in assets:
        v = asset_value(a, **kw)
        succ = None
        if a["step_p"]:
            succ = asset_value(a, pos=a["later_p"], **kw)["rnpv"]
        out_assets.append({
            "name": a.get("name"), "indication": a.get("indication"), "stage": a["stage"],
            "stage_label": STAGE_LABELS[a["stage"]], "area": a.get("area"),
            "area_label": AREA_LABELS.get((a.get("area") or "all").lower(), a.get("area")),
            "pos": a["pos"], "pos_base": a["pos_base"], "pos_source": a["pos_source"], "step_p": a["step_p"],
            "step_base": a["step_base"], "later_p": a["later_p"],
            "next_event": NEXT_EVENT[a["stage"]], "peak_sales": float(a["peak_sales"]),
            "launch_year": int(a["launch_year"]), "loe_year": a.get("loe_year"),
            "years_to_peak": int(a.get("years_to_peak") or DEFAULTS["years_to_peak"]),
            "royalty_rate": a.get("royalty_rate"), "share": float(a["share"]),
            "cogs_pct": float(a["cogs_pct"]), "opex_pct": float(a["opex_pct"]),
            "post_loe_decline": float(a.get("post_loe_decline", DEFAULTS["post_loe_decline"])),
            "dev_cost": float(a.get("dev_cost") or 0.0), "note": a.get("note"),
            "rnpv": v["rnpv"], "revenue_pv": v["revenue_pv"], "dev_pv": v["dev_pv"],
            "value_if_success": succ, "value_if_failure": 0.0 if a["step_p"] else None,
            "series": v["series"],
        })
    corp = cfg.get("corporate") or {}
    oh_cost, oh_years = float(corp.get("annual_cost", 0.0)), int(corp.get("years", 10))
    overhead_pv = 0.0
    for i in range(oh_years):
        y = valuation_date.year + i
        w, t = _year_weights(y, valuation_date)
        overhead_pv += oh_cost * w * (1 - tax) * (1 + r) ** -t
    other = float(cfg.get("other_value", 0.0))
    pipeline_value = sum(a["rnpv"] for a in out_assets)
    equity = pipeline_value - overhead_pv + net_cash + other
    per_share = equity / shares if shares else None
    for a in out_assets:
        a["per_share"] = a["rnpv"] / shares if shares else None
        a.update(catalyst_math(a, equity=equity, shares=shares, price=price))
    return {
        "discount_rate": r, "tax_rate": tax, "horizon": horizon, "valuation_date": valuation_date.isoformat(),
        "assets": out_assets, "pipeline_value": pipeline_value, "overhead_pv": -overhead_pv,
        "overhead": {"annual_cost": oh_cost, "years": oh_years}, "net_cash": net_cash, "other_value": other,
        "equity_value": equity, "shares": shares, "value_per_share": per_share,
        "upside": (per_share / price - 1) if per_share is not None and price else None,
        "base_rates": {"source": SOURCE, "areas": {k: {"label": AREA_LABELS[k], "rates": v} for k, v in BASE_RATES.items()}},
    }


def catalyst_math(a: dict, *, equity: float, shares: float, price: float | None) -> dict:
    """What the next event of a programme means for the stock.

    move_up / move_down   share-price jump on success / failure, from today's price, if the market holds
                          your probability (success: the event's risk disappears; failure: the
                          programme is worth 0)
    expected_abs_move     p x up + (1 - p) x |down| : the size of move the event should cause
    implied_pos / _step   probability that makes the WHOLE model equal to the price, holding every other
                          input: above 100 % means the price needs more than this programme succeeding
                          (the market is more optimistic elsewhere, or your inputs are too low)
    """
    out = {"implied_pos": None, "implied_step": None, "move_up": None, "move_down": None,
           "expected_abs_move": None}
    if not (a["step_p"] and price and shares):
        return out
    v_succ = a["value_if_success"] if a.get("value_if_success") is not None else a["rnpv"]
    up = (v_succ - a["rnpv"]) / shares / price
    down = (0.0 - a["rnpv"]) / shares / price
    p = a["step_p"]
    out.update({"move_up": up, "move_down": down, "expected_abs_move": p * up + (1 - p) * abs(down)})
    if a["revenue_pv"] > 0:
        unrisked_rev = a["revenue_pv"] / a["pos"]            # revenue side at PoS = 100 %
        p_mkt = (price * shares - (equity - a["rnpv"]) - a["dev_pv"]) / unrisked_rev
        out["implied_pos"] = p_mkt
        out["implied_step"] = p_mkt / a["later_p"] if a["later_p"] else None
    return out


SPREAD_MAX = 0.5   # (ask - bid) / mid above this: the quote says little (illiquid small caps)


def _spread(bid, ask):
    if bid is None or ask is None or ask <= 0 or bid < 0 or ask < bid:
        return None
    mid = (bid + ask) / 2
    return (ask - bid) / mid if mid > 0 else None


def implied_move(options: dict | None, event_date: str, spot: float | None) -> dict | None:
    """Options-implied move for an event.

    straddle_move  ATM straddle (mid) of the first expiry after the event / spot: expected absolute move
                   until that expiry, ordinary volatility included
    event_move     the event alone, when an expiry exists clearly before it (3 days of margin: FDA decisions
                   due on a weekend often come on the Friday): the earlier expiry's ATM volatility is taken
                   as the ordinary one, the extra variance of the later expiry is the event's,
                   sigma_event^2 = (iv_after^2 - iv_before^2) x T_after, expressed as an expected absolute
                   move (x sqrt(2/pi)) to be comparable with the straddle
    reliable       False when the bid-ask spreads of the at-the-money options are too wide to trust
    """
    import math
    from datetime import date as _date, timedelta as _td
    if not options or not spot:
        return None
    chains = options.get("chains", {})
    exps = sorted((e["date"], e.get("dte")) for e in options.get("expiries", []) if chains.get(e["date"]))
    cutoff = (_date.fromisoformat(event_date) - _td(days=3)).isoformat()
    after = [e for e in exps if e[0] >= event_date]
    before = [e for e in exps if e[0] < cutoff and (e[1] or 0) >= 3]
    if not after:
        return None

    def atm(exp):
        """Among the 3 strikes nearest the spot, the one whose call and put quotes are tightest."""
        rows = sorted(chains[exp], key=lambda x: abs(x["strike"] - spot))[:3]
        rows = [r for r in rows if r.get("c_mid") is not None and r.get("p_mid") is not None] or rows

        def worst(r):
            sp = [_spread(r.get("c_bid"), r.get("c_ask")), _spread(r.get("p_bid"), r.get("p_ask"))]
            return max((x if x is not None else 9.0) for x in sp)
        r = min(rows, key=lambda x: (worst(x) > SPREAD_MAX, abs(x["strike"] - spot)))
        ivs = [v for v in (r.get("c_iv"), r.get("p_iv")) if v]
        return r, (sum(ivs) / len(ivs) if ivs else None), worst(r) <= SPREAD_MAX

    r2, iv2, ok2 = atm(after[0][0])
    c, p = r2.get("c_mid"), r2.get("p_mid")
    if c is None or p is None:
        return None
    out = {"expiry": after[0][0], "strike": r2["strike"], "straddle": c + p, "straddle_move": (c + p) / spot,
           "iv_after": iv2, "event_move": None, "front_expiry": None, "iv_before": None, "reliable": ok2}
    if before and iv2 and after[0][1] and ok2:
        r1, iv1, ok1 = atm(before[-1][0])
        if iv1 and ok1:
            var = (iv2 ** 2 - iv1 ** 2) * (after[0][1] / 365.0)
            out.update({"front_expiry": before[-1][0], "iv_before": iv1,
                        "event_move": math.sqrt(var) * math.sqrt(2 / math.pi) if var > 0 else 0.0})
    return out
