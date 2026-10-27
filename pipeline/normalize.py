"""Turn raw SEC 'companyfacts' XBRL into a clean, canonical set of statements.

Why this is not trivial
-----------------------
* 10-Q cash-flow statements are reported year-to-date (3M, 6M, 9M), never as
  discrete quarters. Discrete quarters must be rebuilt by differencing.
* Q4 is never reported on its own: Q4 = full year - 9M year-to-date.
* The same period appears in several filings (comparatives, restatements):
  we keep the most recently filed value.
* Companies switch XBRL tags over time (e.g. SalesRevenueNet -> Revenues),
  so each canonical line maps to an ordered list of candidate tags.
* Fiscal years can be 52/53 weeks and end on odd dates (NVIDIA: late January),
  so every date comparison uses a tolerance.

The canonical schema below is the internal "language" of the whole project:
valuation, ratios and the UI only ever see these names, never raw XBRL tags.
That is what will make adding IFRS / European sources possible later.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Iterable

FLOW, INSTANT, PER_SHARE, SHARES_AVG = "flow", "instant", "per_share", "shares_avg"
TOL = 6  # days of tolerance when matching period boundaries

# name: (kind, unit, [(taxonomy, tag), ...] in priority order, label FR, statement)
CONCEPTS: dict[str, tuple] = {
    # ---- Income statement
    "revenue": (FLOW, "USD", [("us-gaap", "Revenues"),
                              ("us-gaap", "RevenueFromContractWithCustomerExcludingAssessedTax"),
                              ("us-gaap", "RevenueFromContractWithCustomerIncludingAssessedTax"),
                              ("us-gaap", "SalesRevenueNet"),
                              ("us-gaap", "SalesRevenueGoodsNet")], "Chiffre d'affaires", "income"),
    "cost_of_revenue": (FLOW, "USD", [("us-gaap", "CostOfRevenue"),
                                      ("us-gaap", "CostOfGoodsAndServicesSold"),
                                      ("us-gaap", "CostOfGoodsSold")], "Coût des ventes", "income"),
    "gross_profit": (FLOW, "USD", [("us-gaap", "GrossProfit")], "Marge brute", "income"),
    "rnd": (FLOW, "USD", [("us-gaap", "ResearchAndDevelopmentExpense"),
                          ("us-gaap", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost")],
            "R&D", "income"),
    "sga": (FLOW, "USD", [("us-gaap", "SellingGeneralAndAdministrativeExpense")], "Frais commerciaux & G&A", "income"),
    "operating_expenses": (FLOW, "USD", [("us-gaap", "OperatingExpenses")], "Total charges opérationnelles", "income"),
    "operating_income": (FLOW, "USD", [("us-gaap", "OperatingIncomeLoss")], "Résultat opérationnel (EBIT)", "income"),
    "interest_expense": (FLOW, "USD", [("us-gaap", "InterestExpense"),
                                       ("us-gaap", "InterestExpenseNonoperating"),
                                       ("us-gaap", "InterestExpenseDebt")], "Charges d'intérêts", "income"),
    "pretax_income": (FLOW, "USD", [
        ("us-gaap", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest"),
        ("us-gaap", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"),
        ("us-gaap", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic")], "Résultat avant impôt", "income"),
    "income_tax": (FLOW, "USD", [("us-gaap", "IncomeTaxExpenseBenefit")], "Impôt sur les sociétés", "income"),
    "net_income": (FLOW, "USD", [("us-gaap", "NetIncomeLoss"), ("us-gaap", "ProfitLoss")], "Résultat net", "income"),
    "eps_diluted": (PER_SHARE, "USD/shares", [("us-gaap", "EarningsPerShareDiluted")], "BPA dilué ($)", "income"),
    "diluted_shares": (SHARES_AVG, "shares", [("us-gaap", "WeightedAverageNumberOfDilutedSharesOutstanding")],
                       "Actions diluées (moy.)", "income"),
    # ---- Cash flow statement
    "cfo": (FLOW, "USD", [("us-gaap", "NetCashProvidedByUsedInOperatingActivities"),
                          ("us-gaap", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations")],
            "Flux de trésorerie opérationnel", "cashflow"),
    "d_and_a": (FLOW, "USD", [("us-gaap", "DepreciationDepletionAndAmortization"),
                              ("us-gaap", "DepreciationAmortizationAndAccretionNet"),
                              ("us-gaap", "DepreciationAndAmortization"),
                              ("us-gaap", "DepreciationAmortizationAndOther"),
                              ("us-gaap", "Depreciation")], "Dotations aux amortissements", "cashflow"),
    "sbc": (FLOW, "USD", [("us-gaap", "ShareBasedCompensation"),
                          ("us-gaap", "AllocatedShareBasedCompensationExpense")], "Rémunération en actions", "cashflow"),
    "capex": (FLOW, "USD", [("us-gaap", "PaymentsToAcquirePropertyPlantAndEquipment"),
                            ("us-gaap", "PaymentsToAcquireProductiveAssets"),
                            ("us-gaap", "PaymentsToAcquirePropertyPlantAndEquipmentAndIntangibleAssets")],
              "Investissements (capex)", "cashflow"),
    "acquisitions": (FLOW, "USD", [("us-gaap", "PaymentsToAcquireBusinessesNetOfCashAcquired")],
                     "Acquisitions", "cashflow"),
    "buybacks": (FLOW, "USD", [("us-gaap", "PaymentsForRepurchaseOfCommonStock")], "Rachats d'actions", "cashflow"),
    "dividends_paid": (FLOW, "USD", [("us-gaap", "PaymentsOfDividends"),
                                     ("us-gaap", "PaymentsOfDividendsCommonStock")], "Dividendes versés", "cashflow"),
    # ---- Balance sheet
    "cash": (INSTANT, "USD", [("us-gaap", "CashAndCashEquivalentsAtCarryingValue"),
                              ("us-gaap", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents")],
             "Trésorerie", "balance"),
    "short_term_investments": (INSTANT, "USD", [("us-gaap", "MarketableSecuritiesCurrent"),
                                                ("us-gaap", "AvailableForSaleSecuritiesDebtSecuritiesCurrent"),
                                                ("us-gaap", "ShortTermInvestments"),
                                                ("us-gaap", "AvailableForSaleSecuritiesCurrent")],
                               "Placements court terme", "balance"),
    "receivables": (INSTANT, "USD", [("us-gaap", "AccountsReceivableNetCurrent")], "Créances clients", "balance"),
    "inventory": (INSTANT, "USD", [("us-gaap", "InventoryNet")], "Stocks", "balance"),
    "current_assets": (INSTANT, "USD", [("us-gaap", "AssetsCurrent")], "Actif courant", "balance"),
    "total_assets": (INSTANT, "USD", [("us-gaap", "Assets")], "Total actif", "balance"),
    "current_liabilities": (INSTANT, "USD", [("us-gaap", "LiabilitiesCurrent")], "Passif courant", "balance"),
    "total_liabilities": (INSTANT, "USD", [("us-gaap", "Liabilities")], "Total dettes (passif hors CP)", "balance"),
    "liabilities_and_equity": (INSTANT, "USD", [("us-gaap", "LiabilitiesAndStockholdersEquity")],
                               "Total passif", "balance"),
    "debt_noncurrent": (INSTANT, "USD", [("us-gaap", "LongTermDebtNoncurrent"),
                                         ("us-gaap", "LongTermDebtAndCapitalLeaseObligations"),
                                         ("us-gaap", "LongTermDebt")], "Dette long terme", "balance"),
    "debt_current": (INSTANT, "USD", [("us-gaap", "LongTermDebtCurrent"),
                                      ("us-gaap", "DebtCurrent"),
                                      ("us-gaap", "ShortTermBorrowings"),
                                      ("us-gaap", "CommercialPaper")], "Dette court terme", "balance"),
    "equity": (INSTANT, "USD", [("us-gaap", "StockholdersEquity"),
                                ("us-gaap", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest")],
               "Capitaux propres", "balance"),
}

# Lines computed from others (never read from XBRL). label FR, statement
DERIVED = {
    "ebitda": ("EBITDA (EBIT + D&A)", "income"),
    "fcf": ("Free cash flow (CFO − capex)", "cashflow"),
    "total_debt": ("Dette financière totale", "balance"),
    "net_cash": ("Trésorerie nette (cash + placements − dette)", "balance"),
}

ALLOWED_FORMS = ("10-K", "10-Q", "20-F", "40-F", "10-KT", "10-QT")


@dataclass(frozen=True)
class Fact:
    start: date | None
    end: date
    val: float
    filed: date
    form: str
    accn: str
    rank: int
    tag: str

    @property
    def days(self) -> int:
        return (self.end - self.start).days + 1 if self.start else 0


def _d(s: str | None) -> date | None:
    return date.fromisoformat(s) if s else None


def collect(facts_json: dict, concept: str) -> list[Fact]:
    kind, unit, tags, *_ = CONCEPTS[concept]
    out: list[Fact] = []
    facts = facts_json.get("facts", {})
    for rank, (tax, tag) in enumerate(tags):
        node = facts.get(tax, {}).get(tag)
        if not node:
            continue
        for f in node.get("units", {}).get(unit, []):
            form = f.get("form", "")
            if not form.startswith(ALLOWED_FORMS):
                continue
            try:
                out.append(Fact(_d(f.get("start")), _d(f["end"]), float(f["val"]), _d(f["filed"]),
                                form, f.get("accn", ""), rank, tag))
            except (KeyError, ValueError, TypeError):
                continue
    return out


def _best(cands: Iterable[Fact]) -> Fact | None:
    """Prefer the highest-priority tag, then the most recently filed value."""
    cands = list(cands)
    if not cands:
        return None
    return sorted(cands, key=lambda f: (f.rank, -f.filed.toordinal()))[0]


def _close(a: date, b: date, tol: int = TOL) -> bool:
    return abs((a - b).days) <= tol


# --------------------------------------------------------------------------- calendar
@dataclass
class FiscalYear:
    fy: int
    start: date
    end: date
    reported: bool  # False for the current, not-yet-closed fiscal year


def fiscal_years(facts_json: dict) -> list[FiscalYear]:
    """Infer fiscal years from annual (≈52/53-week) duration facts on key concepts."""
    spans: list[tuple[date, date]] = []
    for c in ("revenue", "net_income", "cfo", "operating_income"):
        for f in collect(facts_json, c):
            if f.start and 350 <= f.days <= 380 and f.form.startswith(("10-K", "20-F", "40-F")):
                spans.append((f.start, f.end))
    spans.sort(key=lambda s: s[1])
    years: list[FiscalYear] = []
    for s, e in spans:
        if years and _close(years[-1].end, e):
            continue
        years.append(FiscalYear(e.year, s, e, True))
    if years:
        last = years[-1]
        nxt_start = last.end + timedelta(days=1)
        nxt_end = last.end + timedelta(days=364)
        years.append(FiscalYear(nxt_end.year, nxt_start, nxt_end, False))
    return years


def _quarter_index(fy: FiscalYear, end: date) -> int:
    k = round(((end - fy.start).days + 1) / 91.3)
    return k if 1 <= k <= 4 else 0


# --------------------------------------------------------------------------- per concept
def build_flow(facts: list[Fact], years: list[FiscalYear], additive: bool = True):
    """Return (annual {fy: (val, accn)}, quarterly {(fy, q): (val, end, accn)})."""
    annual: dict[int, tuple] = {}
    quarterly: dict[tuple[int, int], tuple] = {}
    for fy in years:
        in_year = [f for f in facts if f.start and f.start >= fy.start - timedelta(days=TOL)
                   and f.end <= fy.end + timedelta(days=TOL)]
        cum: dict[int, Fact] = {}
        disc: dict[int, Fact] = {}
        for k in range(1, 5):
            cum_c = [f for f in in_year if _close(f.start, fy.start) and f.days >= 75
                     and round(f.days / 91.3) == k]
            b = _best(cum_c)
            if b:
                cum[k] = b
            disc_c = [f for f in in_year if 75 <= f.days <= 105 and _quarter_index(fy, f.end) == k]
            b = _best(disc_c)
            if b:
                disc[k] = b
        q: dict[int, tuple] = {}
        for k in range(1, 5):
            if k in disc:
                q[k] = (disc[k].val, disc[k].end, disc[k].accn)
            elif k == 1 and 1 in cum:
                q[1] = (cum[1].val, cum[1].end, cum[1].accn)
            elif k in cum and additive:
                if (k - 1) in cum:
                    q[k] = (cum[k].val - cum[k - 1].val, cum[k].end, cum[k].accn)
                elif all(j in q for j in range(1, k)):
                    q[k] = (cum[k].val - sum(q[j][0] for j in range(1, k)), cum[k].end, cum[k].accn)
        for k, v in q.items():
            quarterly[(fy.fy, k)] = v
        if 4 in cum and fy.reported:
            annual[fy.fy] = (cum[4].val, cum[4].accn)
    return annual, quarterly


def build_instant(facts: list[Fact], ends: dict) -> dict:
    """ends: {key: end_date}; returns {key: (val, accn)} for the instant closest to each end."""
    inst = [f for f in facts if f.start is None]
    out = {}
    for key, end in ends.items():
        b = _best([f for f in inst if _close(f.end, end)])
        if b:
            out[key] = (b.val, b.accn)
    return out


def shares_outstanding(facts_json: dict) -> list[dict]:
    """Cover-page share count (dei), one point per filing date."""
    node = facts_json.get("facts", {}).get("dei", {}).get("EntityCommonStockSharesOutstanding", {})
    pts = {}
    for f in node.get("units", {}).get("shares", []):
        try:
            pts[f["end"]] = float(f["val"])
        except (KeyError, ValueError):
            continue
    # One value per cover date. Multi-class issuers (e.g. Alphabet) would need the classes
    # summed; NVIDIA and the US semis peers have a single class, so this is left for later.
    return [{"date": k, "shares": v} for k, v in sorted(pts.items())]


# --------------------------------------------------------------------------- main entry
def normalize(facts_json: dict, max_years: int = 10, max_quarters: int = 16) -> dict:
    years = fiscal_years(facts_json)
    if not years:
        raise ValueError("Impossible d'inférer l'exercice fiscal (aucun fait annuel trouvé)")

    flows_a: dict[str, dict] = {}
    flows_q: dict[str, dict] = {}
    coverage: dict[str, dict] = {}
    for name, (kind, *_rest) in CONCEPTS.items():
        if kind == INSTANT:
            continue
        facts = collect(facts_json, name)
        a, q = build_flow(facts, years, additive=(kind == FLOW))
        if kind in (PER_SHARE, SHARES_AVG):
            # Q4 is not reported on its own. EPS: FY - (Q1+Q2+Q3) is a close approximation.
            # Average share counts are not additive: leave Q4 shares empty.
            if kind == PER_SHARE:
                for fy in years:
                    if fy.fy in a and all((fy.fy, k) in q for k in (1, 2, 3)) and (fy.fy, 4) not in q:
                        v = a[fy.fy][0] - sum(q[(fy.fy, k)][0] for k in (1, 2, 3))
                        q[(fy.fy, 4)] = (round(v, 4), fy.end, a[fy.fy][1])
        flows_a[name], flows_q[name] = a, q
        used = sorted({f.tag for f in facts}, key=lambda t: [x[1] for x in CONCEPTS[name][2]].index(t))
        coverage[name] = {"tags": used, "annual": len(a), "quarterly": len(q)}

    # Period skeleton: union of quarter keys seen on revenue / net income
    q_keys = sorted(set(flows_q["revenue"]) | set(flows_q["net_income"]))
    q_keys = q_keys[-max_quarters:]
    a_keys = sorted(set(flows_a["revenue"]) | set(flows_a["net_income"]))[-max_years:]
    fy_by = {fy.fy: fy for fy in years}

    q_end: dict[tuple, date] = {}
    for key in q_keys:
        for c in ("revenue", "net_income", "operating_income"):
            if key in flows_q[c]:
                q_end[key] = flows_q[c][key][1]
                break
    a_end = {k: fy_by[k].end for k in a_keys}

    inst_a, inst_q = {}, {}
    for name, (kind, *_rest) in CONCEPTS.items():
        if kind != INSTANT:
            continue
        facts = collect(facts_json, name)
        inst_a[name] = build_instant(facts, a_end)
        inst_q[name] = build_instant(facts, q_end)
        coverage[name] = {"tags": sorted({f.tag for f in facts}), "annual": len(inst_a[name]),
                          "quarterly": len(inst_q[name])}

    def qlabel(k):
        return f"Q{k[1]} FY{k[0]}"

    periods = {
        "annual": [{"label": f"FY{k}", "fy": k, "start": fy_by[k].start.isoformat(), "end": a_end[k].isoformat()}
                   for k in a_keys],
        "quarterly": [{"label": qlabel(k), "fy": k[0], "q": k[1], "end": q_end[k].isoformat()}
                      for k in q_keys if k in q_end],
    }
    q_keys = [k for k in q_keys if k in q_end]

    lines: dict[str, dict] = {}
    for name in CONCEPTS:
        kind = CONCEPTS[name][0]
        if kind == INSTANT:
            av = {f"FY{k}": v[0] for k, v in inst_a[name].items()}
            qv = {qlabel(k): v[0] for k, v in inst_q[name].items()}
        else:
            av = {f"FY{k}": flows_a[name][k][0] for k in a_keys if k in flows_a[name]}
            qv = {qlabel(k): flows_q[name][k][0] for k in q_keys if k in flows_q[name]}
        lines[name] = {"annual": av, "quarterly": qv}

    _derive(lines, periods)
    ttm = _ttm(lines, periods)

    # Source filing per period (from revenue / net income facts)
    sources = {"annual": {}, "quarterly": {}}
    for k in a_keys:
        for c in ("revenue", "net_income"):
            if k in flows_a[c]:
                sources["annual"][f"FY{k}"] = flows_a[c][k][1]
                break
    for k in q_keys:
        for c in ("revenue", "net_income"):
            if k in flows_q[c]:
                sources["quarterly"][qlabel(k)] = flows_q[c][k][2]
                break

    return {
        "periods": periods,
        "lines": lines,
        "ttm": ttm,
        "shares_outstanding": shares_outstanding(facts_json),
        "sources": sources,
        "coverage": coverage,
        "labels": {**{k: v[3] for k, v in CONCEPTS.items()}, **{k: v[0] for k, v in DERIVED.items()}},
        "statement": {**{k: v[4] for k, v in CONCEPTS.items()}, **{k: v[1] for k, v in DERIVED.items()}},
        "kinds": {**{k: v[0] for k, v in CONCEPTS.items()}, "ebitda": FLOW, "fcf": FLOW,
                  "total_debt": INSTANT, "net_cash": INSTANT},
    }


def _derive(lines: dict, periods: dict) -> None:
    for freq in ("annual", "quarterly"):
        labels = [p["label"] for p in periods[freq]]
        g = lambda n, l: lines[n][freq].get(l)  # noqa: E731
        for n in DERIVED:
            lines.setdefault(n, {"annual": {}, "quarterly": {}})
        for l in labels:
            rev, cost, gp = g("revenue", l), g("cost_of_revenue", l), g("gross_profit", l)
            if gp is None and rev is not None and cost is not None:
                lines["gross_profit"][freq][l] = rev - cost
            if cost is None and rev is not None and gp is not None:
                lines["cost_of_revenue"][freq][l] = rev - gp
            ebit, da = g("operating_income", l), g("d_and_a", l)
            if ebit is not None and da is not None:
                lines["ebitda"][freq][l] = ebit + da
            cfo, capex = g("cfo", l), g("capex", l)
            if cfo is not None:
                lines["fcf"][freq][l] = cfo - (capex or 0.0)
            dn, dc = g("debt_noncurrent", l), g("debt_current", l)
            if dn is not None or dc is not None:
                lines["total_debt"][freq][l] = (dn or 0.0) + (dc or 0.0)
            cash, sti = g("cash", l), g("short_term_investments", l)
            if cash is not None:
                lines["net_cash"][freq][l] = cash + (sti or 0.0) - (lines["total_debt"][freq].get(l) or 0.0)
            if g("total_liabilities", l) is None and g("liabilities_and_equity", l) is not None \
                    and g("equity", l) is not None:
                lines["total_liabilities"][freq][l] = g("liabilities_and_equity", l) - g("equity", l)


def _ttm(lines: dict, periods: dict) -> dict:
    """Trailing twelve months: sum of the last 4 consecutive quarters for flows,
    latest quarter for balance-sheet items."""
    q = periods["quarterly"]
    out: dict[str, float | None] = {}
    kinds = {**{k: v[0] for k, v in CONCEPTS.items()},
             "ebitda": FLOW, "fcf": FLOW, "total_debt": INSTANT, "net_cash": INSTANT}
    last4 = [p["label"] for p in q[-4:]]
    consecutive = len(q) >= 4 and _consecutive(q[-4:])
    for name, kind in kinds.items():
        series = lines.get(name, {}).get("quarterly", {})
        if kind in (FLOW, PER_SHARE):
            vals = [series.get(l) for l in last4]
            out[name] = sum(vals) if consecutive and all(v is not None for v in vals) else None
        elif kind == SHARES_AVG:
            vals = [series.get(p["label"]) for p in reversed(q) if series.get(p["label"]) is not None]
            out[name] = vals[0] if vals else None
        else:
            out[name] = series.get(q[-1]["label"]) if q else None
    out["_label"] = f"TTM {q[-1]['label']}" if q else "TTM"
    out["_quarters"] = last4
    # Same metric one year earlier (for TTM growth)
    if len(q) >= 8 and _consecutive(q[-8:]):
        prev4 = [p["label"] for p in q[-8:-4]]
        for name in ("revenue", "operating_income", "net_income", "fcf", "eps_diluted"):
            series = lines.get(name, {}).get("quarterly", {})
            vals = [series.get(l) for l in prev4]
            out[f"{name}_prev"] = sum(vals) if all(v is not None for v in vals) else None
    return out


def _consecutive(qs: list[dict]) -> bool:
    for a, b in zip(qs, qs[1:]):
        if (b["fy"], b["q"]) != ((a["fy"], a["q"] + 1) if a["q"] < 4 else (a["fy"] + 1, 1)):
            return False
    return True
