"""Feed / history: events and the valuation bridge."""
from pipeline import feed


def snap(value, price=100.0, ahash="a", assumptions=None, market=None):
    return {"price": price, "value_base": value, "value_weighted": value, "assumptions": assumptions or {"x": 1},
            "assumptions_hash": ahash, "market": market or {"rf": [0.04, "t", None], "shares": 10},
            "latest_period": "Q1"}


def test_first_run_is_coverage_and_marks_filings_seen(tmp_path):
    h = tmp_path / "h.json"
    filings = [{"accession": "a1", "form": "10-Q", "filed": "2026-08-27", "is_results": True, "url": "u"}]
    ev = feed.update(ticker="T", today="2026-10-01", hist_path=h, snapshot=snap(120), filings=filings,
                     perf={}, recompute=lambda a, m: 120)
    assert [e["type"] for e in ev] == ["coverage"]
    ev2 = feed.update(ticker="T", today="2026-10-02", hist_path=h, snapshot=snap(120), filings=filings,
                      perf={}, recompute=lambda a, m: 120)
    assert ev2 == []  # nothing new


def test_new_filing_and_bridge_sums_to_total(tmp_path):
    h = tmp_path / "h.json"
    feed.update(ticker="T", today="2026-10-01", hist_path=h, snapshot=snap(100), filings=[], perf={},
                recompute=lambda a, m: 100)
    filings = [{"accession": "a2", "form": "10-Q", "filed": "2026-11-20", "is_results": True, "url": "u",
                "report_date": "2026-10-25"}]

    # new data alone -> 110, then the user also edited assumptions -> 115, market -> 116
    def recompute(a, m):
        return 110.0 if a == {"x": 1} else 115.0

    ev = feed.update(ticker="T", today="2026-11-21", hist_path=h,
                     snapshot=snap(116, ahash="b", assumptions={"x": 2}), filings=filings, perf={},
                     recompute=recompute)
    types = [e["type"] for e in ev]
    assert "filing" in types and "valuation" in types
    v = next(e for e in ev if e["type"] == "valuation")
    deltas = [b["delta"] for b in v["bridge"]]
    assert deltas == [10.0, 5.0, 1.0]
    assert sum(deltas) == v["values"]["to"] - v["values"]["from"]


def test_small_noise_does_not_create_events(tmp_path):
    h = tmp_path / "h.json"
    feed.update(ticker="T", today="2026-10-01", hist_path=h, snapshot=snap(100), filings=[], perf={},
                recompute=lambda a, m: 100)
    ev = feed.update(ticker="T", today="2026-10-02", hist_path=h, snapshot=snap(100.4), filings=[], perf={},
                     recompute=lambda a, m: 100.4)
    assert ev == []


def test_price_cross_and_big_move(tmp_path):
    h = tmp_path / "h.json"
    feed.update(ticker="T", today="2026-10-01", hist_path=h, snapshot=snap(100, price=95), filings=[], perf={},
                recompute=lambda a, m: 100)
    ev = feed.update(ticker="T", today="2026-10-02", hist_path=h, snapshot=snap(100, price=106), filings=[],
                     perf={"chg_1d": 0.116, "date": "2026-10-02", "last": 106}, recompute=lambda a, m: 100)
    assert {e["type"] for e in ev} == {"cross", "price"}


def test_same_day_rerun_replaces_snapshot(tmp_path):
    h = tmp_path / "h.json"
    for v in (100, 101):
        feed.update(ticker="T", today="2026-10-01", hist_path=h, snapshot=snap(v), filings=[], perf={},
                    recompute=lambda a, m: v)
    store = feed.load_json(h, {})
    assert len(store["snapshots"]) == 1 and store["snapshots"][0]["value_base"] == 101


def test_merge_feed_dedupes(tmp_path):
    p = tmp_path / "feed.json"
    e = {"id": "1", "date": "2026-10-01", "type": "price", "ticker": "T", "title": "x"}
    feed.merge_feed(p, [e])
    out = feed.merge_feed(p, [e, {**e, "id": "2", "date": "2026-10-02"}])
    assert [x["id"] for x in out] == ["2", "1"]
