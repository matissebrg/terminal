"""Options analytics: Black-Scholes inversion, ATM IV, term structure, earnings shock."""
import math
from datetime import date, datetime, timedelta, timezone

import pytest

from pipeline import options as O


@pytest.mark.parametrize("call", [True, False])
@pytest.mark.parametrize("K", [150.0, 200.0, 250.0])
def test_implied_vol_round_trip(call, K):
    p = O.bs_price(200.0, K, 0.25, 0.04, 0.45, call)
    assert O.implied_vol(p, 200.0, K, 0.25, 0.04, call) == pytest.approx(0.45, abs=1e-6)


def test_put_call_parity():
    S, K, T, r, s = 200.0, 210.0, 0.5, 0.05, 0.4
    c, p = O.bs_price(S, K, T, r, s, True), O.bs_price(S, K, T, r, s, False)
    assert c - p == pytest.approx(S - K * math.exp(-r * T))


def test_iv_none_below_intrinsic():
    assert O.implied_vol(1.0, 200.0, 150.0, 0.25, 0.04, True) is None


def test_synthetic_chain_recovers_earnings_shock():
    today = date(2026, 10, 28)
    ed = (today + timedelta(days=20)).isoformat()
    raw = O.synthetic_raw(200.0, 0.04, today, ed)
    now = datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc) + timedelta(hours=14)
    a = O.analyze(raw, 200.0, 0.04, now=now, earnings_date=ed)
    e = a["earnings"]
    assert e and e["expiry"] > ed
    # the generator injects a 7 % one-day shock on top of a smooth term structure
    assert e["shock_sd"] == pytest.approx(0.07, abs=0.015)
    assert e["shock_expected_abs"] == pytest.approx(e["shock_sd"] * math.sqrt(2 / math.pi))
    assert 0.3 < a["iv30"] < 0.8 and a["put_call_oi"] == pytest.approx(1.0)
    first = a["expiries"][0]
    assert first["implied_move"] == pytest.approx(first["straddle"] / 200.0)


def test_earnings_reactions_two_sessions():
    bars = [{"t": "2026-08-25", "c": 100.0}, {"t": "2026-08-26", "c": 101.0}, {"t": "2026-08-27", "c": 95.0}]
    f = [{"form": "8-K", "items": "2.02,9.01", "filed": "2026-08-26"}]
    r = O.earnings_reactions(f, bars)
    assert r == [{"date": "2026-08-26", "from": "2026-08-25", "to": "2026-08-27", "move": pytest.approx(-0.05)}]
