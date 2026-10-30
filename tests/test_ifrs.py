"""Foreign private issuers (20-F, ifrs-full taxonomy, non-USD presentation currency)."""
import pytest

from pipeline import normalize, valuation


def f(start, end, val, form="20-F", filed=None, accn="a"):
    return {"start": start, "end": end, "val": val, "form": form, "filed": filed or end, "accn": accn}


def i(end, val, form="20-F"):
    return {"end": end, "val": val, "form": form, "filed": end, "accn": "a"}


def unilever_like(cur="EUR"):
    flows = {
        "Revenue": [f("2023-01-01", "2023-12-31", 51.68e9), f("2024-01-01", "2024-12-31", 60.76e9, filed="2025-03-01"),
                    f("2024-01-01", "2024-12-31", 52.48e9, filed="2026-03-01", accn="b"),  # restated (demerger)
                    f("2025-01-01", "2025-12-31", 50.50e9, filed="2026-03-01", accn="b"),
                    f("2025-01-01", "2025-06-30", 30.13e9, form="6-K"), f("2025-04-01", "2025-06-30", 15.36e9, form="6-K")],
        "ProfitLossFromOperatingActivities": [f("2024-01-01", "2024-12-31", 9.0e9), f("2025-01-01", "2025-12-31", 9.4e9)],
        "ProfitLossAttributableToOwnersOfParent": [f("2024-01-01", "2024-12-31", 5.7e9), f("2025-01-01", "2025-12-31", 6.0e9)],
        "CashFlowsFromUsedInOperatingActivities": [f("2025-01-01", "2025-12-31", 8.0e9)],
        "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities": [f("2025-01-01", "2025-12-31", 1.5e9)],
    }
    inst = {"CashAndCashEquivalents": [i("2025-12-31", 4.0e9), i("2025-06-30", 3.0e9, "6-K")],
            "NoncurrentPortionOfNoncurrentBorrowings": [i("2025-12-31", 20e9)],
            "CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings": [i("2025-12-31", 5e9)],
            "CurrentLeaseLiabilities": [i("2025-12-31", 0.5e9)], "NoncurrentLeaseLiabilities": [i("2025-12-31", 1.5e9)],
            "NoncontrollingInterests": [i("2025-12-31", 2e9)],
            "EquityAttributableToOwnersOfParent": [i("2025-12-31", 18e9)]}
    eps = {"DilutedEarningsLossPerShare": [f("2025-01-01", "2025-12-31", 2.40)]}
    ifrs = {**{k: {"units": {cur: v}} for k, v in {**flows, **inst}.items()},
            **{k: {"units": {f"{cur}/shares": v}} for k, v in eps.items()}}
    return {"entityName": "Unilever PLC", "facts": {"ifrs-full": ifrs, "dei": {}}}


def test_ifrs_eur_filer_converted_to_usd():
    fin = normalize.normalize(unilever_like(), fx=lambda c: {"EUR": 1.10}[c])
    assert fin["currency"] == {"reporting": "EUR", "usd_per_unit": 1.10, "standard": "ifrs"}
    L = fin["lines"]
    assert L["revenue"]["annual"]["FY2025"] == pytest.approx(50.50e9 * 1.10)
    assert L["revenue"]["annual"]["FY2024"] == pytest.approx(52.48e9 * 1.10)       # the restated figure wins
    assert L["eps_diluted"]["annual"]["FY2025"] == pytest.approx(2.40 * 1.10)
    T = fin["ttm"]
    assert T["_annual"] and T["_label"].startswith("FY2025")
    assert T["revenue"] == pytest.approx(50.50e9 * 1.10) and T["revenue_prev"] == pytest.approx(52.48e9 * 1.10)
    assert T["cash"] == pytest.approx(4.0e9 * 1.10)                                  # year-end beats the June 6-K
    assert T["total_debt"] == pytest.approx((20e9 + 5e9 + 2e9) * 1.10)               # IFRS 16 leases included
    assert T["minority_interest"] == pytest.approx(2e9 * 1.10)
    snap = valuation.company_snapshot("UL", "Unilever", fin, 60.0, 2.5e9)
    assert snap["period"].startswith("FY2025") and snap["ev_sales"] > 0


def test_usd_ifrs_filer_needs_no_fx():
    fin = normalize.normalize(unilever_like("USD"))
    assert fin["currency"]["reporting"] == "USD" and fin["ttm"]["revenue"] == pytest.approx(50.50e9)


def test_missing_fx_is_an_explicit_error():
    with pytest.raises(ValueError, match="EUR"):
        normalize.normalize(unilever_like())


def test_us_filer_unchanged():
    from pipeline import normalize as N
    us = {"facts": {"us-gaap": {"Revenues": {"units": {"USD": [f("2025-01-01", "2025-12-31", 10.0, "10-K")]}}}}}
    fin = N.normalize(us)
    assert fin["currency"] == {"reporting": "USD", "usd_per_unit": 1.0, "standard": "us-gaap"}
