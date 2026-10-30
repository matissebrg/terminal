"""Feed / history: events and the valuation bridge."""
import json
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


def test_feed_order_and_one_valuation_per_day(tmp_path):
    from pipeline import feed
    p = tmp_path / "feed.json"
    base = {"ticker": "AMZN", "type": "valuation", "date": "2026-10-30", "detail": ""}
    legacy = [{**base, "id": "a", "title": "x", "values": {"from": 44.05, "to": 14.08}},
              {**base, "id": "b", "title": "y", "values": {"from": 44.05, "to": 13.80}},
              {"id": "c", "ticker": "BBIO", "type": "valuation", "date": "2026-10-30", "title": "z", "detail": "",
               "values": {"from": -116.06, "to": -141.83, "change": 0.222}},
              {"id": "f", "ticker": "XOM", "type": "filing", "date": "2026-10-30", "ts": "2026-10-30T13:31:00Z", "title": "8-K"},
              {"id": "q", "ticker": "NVDA", "type": "price", "date": "2026-10-30", "ts": "2026-10-30T20:00:00Z", "title": "-5 %"},
              {"id": "old", "ticker": "NVDA", "type": "coverage", "date": "2026-10-28", "title": "cov"}]
    p.write_text(json.dumps({"events": legacy}))
    out = feed.merge_feed(p, [])
    amzn = [e for e in out if e["ticker"] == "AMZN"]
    assert len(amzn) == 1 and amzn[0]["values"]["to"] == 13.80
    bbio = next(e for e in out if e["ticker"] == "BBIO")
    assert bbio["values"]["change"] < 0 and "-22" in bbio["title"]
    assert [e["id"] for e in out][:2] == ["q", "f"] and out[-1]["id"] == "old"
    # a re-run the same day replaces the valuation event instead of adding one
    new = {**base, "id": feed._eid("AMZN", "valuation", "2026-10-30"), "ts": "2026-10-30T21:40:00Z", "title": "new",
           "values": {"from": 44.05, "to": 13.5}}
    out = feed.merge_feed(p, [new])
    out = feed.merge_feed(p, [{**new, "values": {"from": 44.05, "to": 13.4}}])
    amzn = [e for e in out if e["ticker"] == "AMZN"]
    assert len(amzn) == 1 and amzn[0]["values"]["to"] == 13.4 and out[0]["ticker"] == "AMZN"


def test_rel_change_signed_base():
    from pipeline import feed
    assert round(feed.rel_change(-100, -120), 3) == -0.2
    assert round(feed.rel_change(100, 120), 3) == 0.2
