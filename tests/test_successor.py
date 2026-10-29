from pipeline import sec


def _fact(start, end, val, accn, form="10-K"):
    return {"start": start, "end": end, "val": val, "accn": accn, "form": form, "filed": end}


def test_merge_facts_unions_history_and_drops_duplicates():
    new = {"cik": 2115436, "entityName": "Holdings", "facts": {"us-gaap": {"Revenues": {"label": "R", "units": {"USD": [
        _fact("2026-07-01", "2026-09-30", 80, "n1", "10-Q"), _fact("2025-07-01", "2025-09-30", 83, "n1", "10-Q")]}}}}}
    old = {"cik": 34088, "entityName": "Old", "facts": {
        "us-gaap": {"Revenues": {"units": {"USD": [_fact("2025-01-01", "2025-12-31", 330, "o1"),
                                                   _fact("2025-07-01", "2025-09-30", 83, "n1", "10-Q")]}},
                    "NetIncomeLoss": {"units": {"USD": [_fact("2025-01-01", "2025-12-31", 30, "o1")]}}}}}
    m = sec.merge_facts(new, old)
    assert m["entityName"] == "Holdings"
    rows = m["facts"]["us-gaap"]["Revenues"]["units"]["USD"]
    assert sorted(r["val"] for r in rows) == [80, 83, 330]
    assert m["facts"]["us-gaap"]["NetIncomeLoss"]["units"]["USD"][0]["val"] == 30


def test_merge_submissions_keeps_old_filings_under_their_cik():
    new = {"cik": "2115436", "name": "Holdings", "filings": {"recent": {
        "accessionNumber": ["0000-26-2"], "form": ["10-Q"], "filingDate": ["2026-10-29"],
        "primaryDocument": ["q.htm"], "reportDate": ["2026-09-30"], "items": [""]}}}
    old = {"cik": "34088", "name": "Old", "filings": {"recent": {
        "accessionNumber": ["0000-26-1"], "form": ["10-K"], "filingDate": ["2026-02-20"],
        "primaryDocument": ["k.htm"], "reportDate": ["2025-12-31"], "items": [""]}}}
    fl = sec.recent_filings(sec.merge_submissions(new, old))
    assert [f["form"] for f in fl] == ["10-Q", "10-K"]
    assert "/data/2115436/" in fl[0]["url"] and "/data/34088/" in fl[1]["url"]


def test_merged_facts_normalise():
    from pipeline import normalize
    new = {"facts": {"us-gaap": {"Revenues": {"units": {"USD": [_fact("2026-07-01", "2026-09-30", 80, "n1", "10-Q")]}}}}}
    old = {"facts": {"us-gaap": {"Revenues": {"units": {"USD": [_fact("2025-01-01", "2025-12-31", 330, "o1")]}}}}}
    assert not normalize.fiscal_years(new)
    assert normalize.fiscal_years(sec.merge_facts(new, old))


def test_ebit_rebuilt_when_never_tagged():
    from pipeline import normalize
    P = "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest"
    us = {"Revenues": [_fact("2024-01-01", "2024-12-31", 300, "a"), _fact("2025-01-01", "2025-12-31", 330, "b")],
          P: [_fact("2024-01-01", "2024-12-31", 40, "a"), _fact("2025-01-01", "2025-12-31", 50, "b")],
          "InterestExpense": [_fact("2025-01-01", "2025-12-31", 2, "b")]}
    fj = {"facts": {"us-gaap": {k: {"units": {"USD": v}} for k, v in us.items()}}}
    fin = normalize.normalize(fj)
    assert fin["lines"]["operating_income"]["annual"] == {"FY2024": 40, "FY2025": 52}
    assert fin["coverage"]["operating_income"]["rebuilt"]
    # a filer that tags EBIT keeps its own figure
    us["OperatingIncomeLoss"] = [_fact("2025-01-01", "2025-12-31", 45, "b")]
    fj = {"facts": {"us-gaap": {k: {"units": {"USD": v}} for k, v in us.items()}}}
    assert normalize.normalize(fj)["lines"]["operating_income"]["annual"] == {"FY2025": 45}
