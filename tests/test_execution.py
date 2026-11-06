"""Paper-trading execution model (pipeline/execution.py)."""
from datetime import date, datetime, timezone

import pytest

from pipeline import execution as X


def bar(t, o, h, l, c, v):
    return {"t": t, "o": o, "h": h, "l": l, "c": c, "v": v}


BARS = [bar(f"2026-10-{d:02d}", 100, 102, 98, 100 + (d % 3) - 1, 1_000_000) for d in range(1, 29)]
BARS += [bar("2026-10-29", 101, 104, 99.5, 103, 2_000_000), bar("2026-10-30", 103, 103.5, 96, 97, 3_000_000)]


def test_spread_rule():
    assert X.spread_bps(1e7, 50) == pytest.approx(10)
    assert X.spread_bps(1e9, 500) == pytest.approx(1)
    assert X.spread_bps(1e5, 50) == pytest.approx(100)
    assert X.spread_bps(1e12, 500) == 1.0 and X.spread_bps(10, 50) == 150.0
    assert X.spread_bps(1e9, 2.0) == pytest.approx(50)            # one cent on a 2 $ stock


def test_market_order_costs_and_timing():
    st = X.stats(BARS[:-2])
    assert st["adv_shares"] == pytest.approx(1_000_000) and st["sigma_d"] > 0
    # placed at 10:00 New York on the 29th: fills at that day's close, buy pays half-spread + impact
    o = {"id": 1, "side": "buy", "qty": 1000, "order_type": "market", "filled_qty": 0,
         "created_at": datetime(2026, 10, 29, 14, 0, tzinfo=timezone.utc)}
    p = X.plan(o, BARS, st, date(2026, 10, 30))
    f = p["fills"][0]
    assert f["session"] == "2026-10-29" and f["qty"] == 1000 and not f["partial"]
    half = st["spread_bps"] / 2 / 1e4
    imp = 0.5 * st["sigma_d"] * (1000 / 2_000_000) ** 0.5
    assert f["price"] == pytest.approx(103 * (1 + half + imp), abs=1e-4)
    # same order placed after the close: next session
    o2 = {**o, "created_at": datetime(2026, 10, 29, 21, 0, tzinfo=timezone.utc), "side": "sell"}
    f2 = X.plan(o2, BARS, st, date(2026, 10, 30))["fills"][0]
    assert f2["session"] == "2026-10-30" and f2["price"] < 97


def test_participation_cap_splits_large_orders():
    st = X.stats(BARS[:-2])
    o = {"id": 2, "side": "buy", "qty": 450_000, "order_type": "market", "filled_qty": 0,
         "created_at": datetime(2026, 10, 29, 14, 0, tzinfo=timezone.utc)}
    p = X.plan(o, BARS, st, date(2026, 10, 30))
    assert [x["qty"] for x in p["fills"]] == [200_000, 250_000]       # 10 % of 2 M, then the rest of 3 M
    assert p["fills"][0]["partial"] and p["fills"][0]["impact_bps"] > p["fills"][1]["impact_bps"] * 0.5
    # a later run skips the sessions already used
    o["filled_qty"], o["fill_date"] = 200_000, "2026-10-29"
    assert [x["session"] for x in X.plan(o, BARS, st, date(2026, 10, 30))["fills"]] == ["2026-10-30"]


def test_limit_orders():
    st = X.stats(BARS)
    base = {"id": 3, "qty": 100, "order_type": "limit", "filled_qty": 0, "expires_on": "2026-11-28",
            "created_at": datetime(2026, 10, 29, 14, 0, tzinfo=timezone.utc)}
    # buy limit 99.5: the 29th (placement day) is not eligible even though its low is 99.5; the 30th trades through
    f = X.plan({**base, "side": "buy", "limit_price": 99.5}, BARS, st, date(2026, 10, 30))["fills"][0]
    assert f["session"] == "2026-10-30" and f["price"] == 99.5 and f["half_spread_bps"] == 0
    # touching the limit is not enough
    assert X.limit_fill(bar("x", 100, 101, 96, 97, 1e6), "buy", 10, 96) is None
    # gap: the session opens below the buy limit -> filled at the open
    assert X.limit_fill(bar("x", 95, 96, 94, 95.5, 1e6), "buy", 10, 98)["price"] == 95
    # sell limit above the high: nothing, then expiry once the 30 days are over
    p = X.plan({**base, "side": "sell", "limit_price": 120}, BARS, st, date(2026, 11, 30))
    assert p["fills"] == [] and "expiré" in p["expire"]
    # placed before the open: the same session counts
    pre = {**base, "side": "buy", "limit_price": 99.9, "created_at": datetime(2026, 10, 29, 12, 0, tzinfo=timezone.utc)}
    assert X.plan(pre, BARS, st, date(2026, 10, 30))["fills"][0]["session"] == "2026-10-29"
