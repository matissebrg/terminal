"""Generate SYNTHETIC SEC-shaped fixtures for offline tests and local UI preview.

The numbers are invented (loosely NVIDIA-shaped so the UI looks realistic).
They are never published: the real site only ever shows live SEC data.

What the generator reproduces on purpose, because these are the traps of real XBRL:
  * 52/53-week fiscal years ending on odd dates (late January for the target,
    late December / early November / late September for peers)
  * 10-Q income statements with discrete 3-month AND year-to-date facts
  * 10-Q cash-flow statements reported ONLY year-to-date (3M, 6M, 9M)
  * no stand-alone Q4: only the 10-K full year
  * prior-year comparatives in every filing, plus one restatement
  * a revenue tag switch (SalesRevenueNet -> Revenues) in older years
"""
from __future__ import annotations

import json
import math
import random
from datetime import date, timedelta
from pathlib import Path

HERE = Path(__file__).parent

COMPANIES = {
    # ticker: (cik, name, first FY end, n years, quarterly revenue in $bn (chronological), profile)
    "NVDA": (1045810, "NVIDIA CORP", date(2021, 1, 31), [
        3.08, 3.87, 4.73, 5.00, 5.66, 6.51, 7.10, 7.64, 8.29, 6.70, 5.93, 6.05,
        7.19, 13.51, 18.12, 22.10, 26.04, 30.04, 35.08, 39.33, 44.06, 46.74, 57.0, 68.0, 81.5, 96.2],
        dict(gm=(0.62, 0.75), om=(0.25, 0.66), rnd=0.10, tax=0.15, da=0.012, capex=0.025, sbc=0.05,
             shares=24.5e9, cash=0.9, debt=8.5e9, eq_mult=1.6, buyback=0.25, div=0.01, fy_weeks_53={2021})),
    "AMD": (2488, "ADVANCED MICRO DEVICES INC", date(2020, 12, 26), [
        2.6, 3.2, 3.3, 3.9, 4.0, 4.6, 5.3, 5.4, 6.0, 6.6, 5.6, 5.6, 5.4, 5.4, 5.8, 6.2, 5.5, 5.8, 6.8, 7.7,
        7.4, 7.7, 9.2, 10.3, 10.0, 10.8],
        dict(gm=(0.45, 0.52), om=(0.08, 0.14), rnd=0.24, tax=0.10, da=0.12, capex=0.03, sbc=0.06,
             shares=1.62e9, cash=0.25, debt=2.5e9, eq_mult=2.5, buyback=0.3, div=0.0, fy_weeks_53={2022})),
    "AVGO": (1730168, "BROADCOM INC", date(2020, 11, 1), [
        5.7, 5.9, 6.0, 6.6, 6.6, 6.8, 7.4, 7.7, 8.0, 8.1, 8.5, 8.9, 8.9, 8.7, 8.9, 9.3, 11.9, 12.5, 13.1,
        14.1, 14.9, 15.0, 16.0, 17.6, 18.9, 20.3],
        dict(gm=(0.62, 0.68), om=(0.30, 0.40), rnd=0.18, tax=0.12, da=0.15, capex=0.01, sbc=0.12,
             shares=4.7e9, cash=0.15, debt=65e9, eq_mult=1.0, buyback=0.2, div=0.45, fy_weeks_53=set())),
    "QCOM": (804328, "QUALCOMM INC", date(2020, 9, 27), [
        8.2, 7.9, 8.1, 9.3, 10.7, 9.3, 8.0, 9.5, 9.9, 9.4, 8.6, 8.5, 8.6, 9.4, 9.9, 9.3, 10.4, 10.2, 11.0,
        10.8, 10.4, 10.6, 11.2, 11.0, 10.9, 11.3],
        dict(gm=(0.55, 0.58), om=(0.25, 0.30), rnd=0.22, tax=0.12, da=0.04, capex=0.04, sbc=0.07,
             shares=1.10e9, cash=0.35, debt=15e9, eq_mult=1.2, buyback=0.3, div=0.3, fy_weeks_53={2022})),
    "INTC": (50863, "INTEL CORP", date(2020, 12, 26), [
        19.7, 19.6, 19.2, 20.5, 18.4, 15.3, 15.3, 14.0, 11.7, 12.9, 14.2, 15.4, 12.7, 12.8, 13.3, 14.3,
        12.7, 13.7, 13.3, 12.9, 13.0, 13.4, 13.7, 13.8, 13.5, 13.9],
        dict(gm=(0.35, 0.42), om=(-0.05, 0.04), rnd=0.30, tax=0.10, da=0.25, capex=0.40, sbc=0.06,
             shares=4.35e9, cash=0.6, debt=50e9, eq_mult=4.0, buyback=0.0, div=0.02, fy_weeks_53={2022})),
    "MRVL": (1835632, "MARVELL TECHNOLOGY INC", date(2021, 1, 30), [
        0.83, 0.93, 1.08, 1.21, 1.34, 1.45, 1.52, 1.42, 1.32, 1.34, 1.37, 1.43, 1.16, 1.27, 1.52, 1.82,
        1.83, 2.08, 2.31, 2.55, 2.80, 3.01, 3.10, 3.25, 3.4, 3.6],
        dict(gm=(0.45, 0.58), om=(-0.02, 0.18), rnd=0.30, tax=0.08, da=0.18, capex=0.05, sbc=0.12,
             shares=0.865e9, cash=0.12, debt=4.5e9, eq_mult=3.0, buyback=0.15, div=0.05, fy_weeks_53={2022})),
}


def fiscal_calendar(first_end: date, n_years: int, weeks53: set[int]):
    """List of fiscal years: (fy, start, [q1_end, q2_end, q3_end, q4_end])."""
    years = []
    end = first_end
    start = first_end - timedelta(weeks=53 if first_end.year in weeks53 else 52) + timedelta(days=1)
    for _ in range(n_years):
        wk = 53 if end.year in weeks53 else 52
        start = end - timedelta(weeks=wk) + timedelta(days=1)
        qe = [start + timedelta(weeks=13 * k) - timedelta(days=1) for k in (1, 2, 3)] + [end]
        years.append((end.year, start, qe))
        end = end + timedelta(weeks=53 if (end.year + 1) in weeks53 else 52)
    return years


def build_company(tk: str):
    cik, name, first_end, revq, pr = COMPANIES[tk]
    n_q = len(revq)
    n_years = math.ceil(n_q / 4)
    cal = fiscal_calendar(first_end, n_years, pr["fy_weeks_53"])
    rng = random.Random(sum(map(ord, tk)))
    # discrete quarterly economics
    quarters = []
    shares = pr["shares"]
    eq = pr["shares"] * 0.5
    cash = 0.0
    for i, rv in enumerate(revq):
        fy, start, qe = cal[i // 4]
        k = i % 4
        qstart = start if k == 0 else qe[k - 1] + timedelta(days=1)
        t = i / max(1, n_q - 1)
        gm = pr["gm"][0] + (pr["gm"][1] - pr["gm"][0]) * t + rng.uniform(-0.01, 0.01)
        om = pr["om"][0] + (pr["om"][1] - pr["om"][0]) * t + rng.uniform(-0.01, 0.01)
        rev = rv * 1e9
        cost = rev * (1 - gm)
        gp = rev - cost
        rnd = rev * pr["rnd"]
        oi = rev * om
        sga = gp - rnd - oi
        pretax = oi + rev * 0.01
        tax = pretax * pr["tax"] if pretax > 0 else 0.0
        ni = pretax - tax
        shares *= 0.997
        eps = ni / shares
        da = rev * pr["da"]
        sbc = rev * pr["sbc"]
        cfo = ni + da + sbc - rev * 0.03
        capex = rev * pr["capex"]
        bb = max(0.0, cfo * pr["buyback"])
        dv = rev * pr["div"]
        cash += cfo - capex - bb - dv
        eq += ni - bb - dv + sbc
        quarters.append(dict(fy=fy, k=k + 1, start=qstart, end=qe[k], revenue=rev, cost=cost, gp=gp, rnd=rnd,
                             sga=sga, opex=rnd + sga, oi=oi, pretax=pretax, tax=tax, ni=ni, eps=eps, dsh=shares,
                             da=da, sbc=sbc, cfo=cfo, capex=capex, bb=bb, dv=dv))
    # balance sheet per quarter end
    bal = {}
    run_cash = rev_avg = 0
    for q in quarters:
        rev_avg = q["revenue"]
        run_cash = max(run_cash + (q["cfo"] - q["capex"] - q["bb"] - q["dv"]), 0) + rev_avg * pr["cash"] * 0.1
        c = rev_avg * pr["cash"] + run_cash * 0.5
        sti = c * 0.8
        rec = q["revenue"] * 0.55
        inv = q["cost"] * 1.2
        ca = c + sti + rec + inv
        ta = ca * 1.4 + pr["debt"] * 0.5
        cl = q["revenue"] * 0.45
        eqv = max(ta * 0.65, ta - pr["debt"] - cl - 1e9) if pr["eq_mult"] < 3 else ta * 0.45
        tl = ta - eqv
        bal[q["end"]] = dict(cash=c, sti=sti, rec=rec, inv=inv, ca=ca, ta=ta, cl=cl, tl=tl, lae=ta, eq=eqv,
                             dnc=pr["debt"] * 0.9, dc=pr["debt"] * 0.1)
    return cik, name, cal, quarters, bal


def emit(tk: str):
    cik, name, cal, quarters, bal = build_company(tk)
    facts: dict[str, dict] = {}

    def add(tag, unit, start, end, val, form, filed, accn, fy, fp, tax="us-gaap"):
        node = facts.setdefault(tax, {}).setdefault(tag, {"label": tag, "units": {}})
        f = {"end": end.isoformat(), "val": round(val, 4 if unit != "USD" else 0), "accn": accn, "fy": fy,
             "fp": fp, "form": form, "filed": filed.isoformat()}
        if start:
            f["start"] = start.isoformat()
        node["units"].setdefault(unit, []).append(f)

    flow_tags = [("revenue", "Revenues"), ("cost", "CostOfRevenue"), ("gp", "GrossProfit"),
                 ("rnd", "ResearchAndDevelopmentExpense"), ("sga", "SellingGeneralAndAdministrativeExpense"),
                 ("opex", "OperatingExpenses"), ("oi", "OperatingIncomeLoss"),
                 ("pretax", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest"),
                 ("tax", "IncomeTaxExpenseBenefit"), ("ni", "NetIncomeLoss")]
    cf_tags = [("cfo", "NetCashProvidedByUsedInOperatingActivities"), ("da", "DepreciationDepletionAndAmortization"),
               ("sbc", "ShareBasedCompensation"), ("capex", "PaymentsToAcquirePropertyPlantAndEquipment"),
               ("bb", "PaymentsForRepurchaseOfCommonStock"), ("dv", "PaymentsOfDividends")]
    bal_tags = [("cash", "CashAndCashEquivalentsAtCarryingValue"), ("sti", "MarketableSecuritiesCurrent"),
                ("rec", "AccountsReceivableNetCurrent"), ("inv", "InventoryNet"), ("ca", "AssetsCurrent"),
                ("ta", "Assets"), ("cl", "LiabilitiesCurrent"), ("tl", "Liabilities"),
                ("lae", "LiabilitiesAndStockholdersEquity"), ("eq", "StockholdersEquity"),
                ("dnc", "LongTermDebtNoncurrent"), ("dc", "LongTermDebtCurrent")]
    by_fy: dict[int, list] = {}
    for q in quarters:
        by_fy.setdefault(q["fy"], []).append(q)
    fys = sorted(by_fy)
    filings = []
    n = 0
    for fy in fys:
        qs = by_fy[fy]
        prior = by_fy.get(fy - 1, [])
        for q in qs:
            n += 1
            is_k = q["k"] == 4
            form = "10-K" if is_k else "10-Q"
            filed = q["end"] + timedelta(days=55 if is_k else 32)
            accn = f"{cik:010d}-{str(fy)[2:]}-{n:06d}"
            fp = "FY" if is_k else f"Q{q['k']}"
            filings.append((accn, form, filed, q["end"]))
            ytd = qs[:q["k"]]
            pytd = prior[:q["k"]] if len(prior) >= q["k"] else []
            # income statement
            for key, tag in flow_tags:
                rev_tag = tag
                if key == "revenue" and fy <= fys[0] + 1:
                    rev_tag = "SalesRevenueNet"  # tag switch in early years
                periods = []
                if not is_k:
                    periods.append((q["start"], q["end"], q[key]))  # discrete 3M
                    if prior and len(prior) >= q["k"]:
                        pq = prior[q["k"] - 1]
                        periods.append((pq["start"], pq["end"], pq[key]))
                if q["k"] > 1:
                    periods.append((ytd[0]["start"], q["end"], sum(x[key] for x in ytd)))
                    if pytd:
                        periods.append((pytd[0]["start"], pytd[-1]["end"], sum(x[key] for x in pytd)))
                if is_k:
                    for back in (1, 2):
                        ob = by_fy.get(fy - back)
                        if ob and len(ob) == 4:
                            periods.append((ob[0]["start"], ob[-1]["end"], sum(x[key] for x in ob)))
                for s, e, v in periods:
                    add(rev_tag, "USD", s, e, v, form, filed, accn, fy, fp)
            # EPS & diluted shares (not additive: report per period)
            for s, e, grp in ([(q["start"], q["end"], [q])] if not is_k else []) + \
                             ([(ytd[0]["start"], q["end"], ytd)] if q["k"] > 1 else []):
                ni = sum(x["ni"] for x in grp)
                sh = sum(x["dsh"] for x in grp) / len(grp)
                add("EarningsPerShareDiluted", "USD/shares", s, e, ni / sh, form, filed, accn, fy, fp)
                add("WeightedAverageNumberOfDilutedSharesOutstanding", "shares", s, e, sh, form, filed, accn, fy, fp)
            # cash flow: YTD only
            for key, tag in cf_tags:
                add(tag, "USD", ytd[0]["start"], q["end"], sum(x[key] for x in ytd), form, filed, accn, fy, fp)
                if pytd:
                    add(tag, "USD", pytd[0]["start"], pytd[-1]["end"], sum(x[key] for x in pytd), form, filed,
                        accn, fy, fp)
            # balance sheet: current + prior FY end
            for key, tag in bal_tags:
                add(tag, "USD", None, q["end"], bal[q["end"]][key], form, filed, accn, fy, fp)
                if prior:
                    pe = prior[-1]["end"]
                    add(tag, "USD", None, pe, bal[pe][key], form, filed, accn, fy, fp)
            # dei shares outstanding at cover date
            add("EntityCommonStockSharesOutstanding", "shares", None, filed - timedelta(days=5), q["dsh"] * 0.995,
                form, filed, accn, fy, fp, tax="dei")
    # A restatement: the first-filed value of one old quarter is wrong and later corrected
    rev_node = facts["us-gaap"]["Revenues"]["units"]["USD"]
    target = next(f for f in rev_node if f["form"] == "10-Q" and f.get("start"))
    bad = dict(target)
    bad["val"] = target["val"] * 0.9
    bad["filed"] = (date.fromisoformat(target["filed"]) - timedelta(days=400)).isoformat()
    bad["accn"] = "0000000000-00-000001"
    rev_node.append(bad)

    cf = {"cik": cik, "entityName": name, "facts": facts}
    filings.sort(key=lambda x: x[2], reverse=True)
    subs = {"cik": str(cik), "name": name, "sic": "3674", "sicDescription": "Semiconductors & Related Devices",
            "fiscalYearEnd": cal[0][2][3].strftime("%m%d"), "exchanges": ["Nasdaq"], "website": "",
            "stateOfIncorporation": "DE",
            "filings": {"recent": {
                "accessionNumber": [f[0] for f in filings], "form": [f[1] for f in filings],
                "filingDate": [f[2].isoformat() for f in filings], "reportDate": [f[3].isoformat() for f in filings],
                "primaryDocument": [f"{tk.lower()}-{f[3].strftime('%Y%m%d')}.htm" for f in filings],
                "items": ["" for _ in filings]}}}
    return cf, subs, quarters


def prices(sym: str, end_price: float, years: int = 5, seed: int = 1, drift: float = 0.25, vol: float = 0.45):
    rng = random.Random(seed)
    d = date(2026, 10, 26)
    days = []
    cur = d - timedelta(days=365 * years)
    while cur <= d:
        if cur.weekday() < 5:
            days.append(cur)
        cur += timedelta(days=1)
    n = len(days)
    rets = [rng.gauss((drift - vol ** 2 / 2) / 252, vol / math.sqrt(252)) for _ in range(n)]
    tot = sum(rets)
    p0 = end_price / math.exp(tot)
    out, p = [], p0
    for day, r in zip(days, rets):
        o = p
        p = p * math.exp(r)
        hi, lo = max(o, p) * (1 + abs(rng.gauss(0, 0.006))), min(o, p) * (1 - abs(rng.gauss(0, 0.006)))
        out.append({"t": day.isoformat(), "o": round(o, 4), "h": round(hi, 4), "l": round(lo, 4), "c": round(p, 4),
                    "ac": round(p, 4), "v": int(rng.uniform(1e7, 4e8))})
    return out


def main():
    for tk in COMPANIES:
        cf, subs, _ = emit(tk)
        (HERE / f"facts_{tk}.json").write_text(json.dumps(cf))
        (HERE / f"subs_{tk}.json").write_text(json.dumps(subs))
    for sym, px, seed, dr, vo in [("NVDA", 186.0, 7, 0.55, 0.5), ("AMD", 160.0, 3, 0.2, 0.5),
                                  ("AVGO", 340.0, 4, 0.45, 0.35), ("QCOM", 165.0, 5, 0.05, 0.3),
                                  ("INTC", 24.0, 6, -0.15, 0.4), ("MRVL", 88.0, 8, 0.15, 0.55),
                                  ("SPY", 670.0, 9, 0.12, 0.16), ("SOXX", 290.0, 10, 0.2, 0.3)]:
        (HERE / f"prices_{sym}.json").write_text(json.dumps(prices(sym, px, seed=seed, drift=dr, vol=vo)))
    print("fixtures écrites dans", HERE)


if __name__ == "__main__":
    main()
