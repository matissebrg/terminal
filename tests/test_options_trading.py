"""Paper trading of options, end to end on PostgreSQL: quotes -> order -> evening fill at the ask,
resale at the bid, cash settlement at expiry, portfolio value, no naked shorting."""
import json
from datetime import datetime, timezone

import pytest

from pipeline import community
from tests.test_community import PgSupa
from tests.test_db import ADMIN_URL, Client, _new_user, _su, psycopg  # noqa: F401
from tests.test_db import dburl  # noqa: F401

pytestmark = pytest.mark.skipif(not ADMIN_URL, reason="TEST_DATABASE_URL non défini")


def chain(spot, c_bid, c_ask, p_bid, p_ask, exp="2026-11-20"):
    return {"spot": spot, "chains": {exp: [
        {"strike": 200.0, "c_bid": c_bid, "c_ask": c_ask, "c_mid": (c_bid + c_ask) / 2, "c_iv": 0.4,
         "p_bid": p_bid, "p_ask": p_ask, "p_mid": (p_bid + p_ask) / 2, "p_iv": 0.42}]}}


def bars(*pts):
    return {"NVDA": [{"t": d, "c": c} for d, c in pts]}


def test_option_paper_trading(dburl):  # noqa: F811
    url = dburl
    uid = _new_user(url, "trader@x.test")
    _su(url, "insert into public.profiles (id, username) values (%s, 'trader')", (uid,))
    me = Client(url, uid)
    sb = PgSupa(url)
    common = dict(fins={}, filings={}, guidance={}, consensus={}, next_earnings={}, names={"NVDA": "NVIDIA"})
    morning = datetime(2026, 10, 28, 13, 7, tzinfo=timezone.utc)           # 09:07 New York
    evening = datetime(2026, 10, 28, 21, 37, tzinfo=timezone.utc)          # 17:37 New York
    # morning run: quotes published, no fill possible
    community.sync(sb, bars=bars(("2026-10-27", 210.0)), now=morning, option_chains={"NVDA": chain(210, 14.0, 14.6, 4.0, 4.4)}, **common)
    assert me.q("select count(*) from public.option_quotes")[0][0] == 2
    pf = me.q("insert into public.portfolios (name) values ('opt') returning id")[0][0]
    with pytest.raises(psycopg.errors.RaiseException, match="non couvert"):
        me.q("select public.place_option_order(%s, 'NVDA', '2026-11-20', 200, 'C', 'sell', 1)", (pf,))
    with pytest.raises(psycopg.errors.RaiseException, match="non coté"):
        me.q("select public.place_option_order(%s, 'NVDA', '2026-11-20', 205, 'C', 'buy', 1)", (pf,))
    oid = me.q("select (public.place_option_order(%s, 'nvda', '2026-11-20', 200, 'C', 'buy', 2)).id", (pf,))[0][0]
    _su(url, "update public.option_orders set created_at = %s where id = %s", (datetime(2026, 10, 28, 15, 0, tzinfo=timezone.utc), oid))
    # evening run, same session: filled at the ASK of the evening snapshot
    out = community.sync(sb, bars=bars(("2026-10-27", 210.0), ("2026-10-28", 215.0)), now=evening,
                         option_chains={"NVDA": chain(215, 17.0, 17.5, 3.0, 3.3)}, **common)
    assert out["options"]["filled"] == 1
    o = me.q("select status, fill_price from public.option_orders where id = %s", (oid,))[0]
    assert o[0] == "filled" and float(o[1]) == 17.5
    cash = float(me.q("select cash from public.portfolios where id = %s", (pf,))[0][0])
    assert cash == pytest.approx(100000 - 2 * 100 * 17.5)
    val = float(_su(url, "select value from public.portfolio_values where portfolio_id = %s", (pf,))[0][0])
    assert val == pytest.approx(cash + 2 * 100 * 17.25)                     # marked at mid
    assert "premier_contrat" in {r[0] for r in me.q("select badge_id from public.user_badges")}
    # resale of one contract next day at the BID
    sid = me.q("select (public.place_option_order(%s, 'NVDA', '2026-11-20', 200, 'C', 'sell', 1)).id", (pf,))[0][0]
    _su(url, "update public.option_orders set created_at = %s where id = %s", (datetime(2026, 10, 29, 14, 0, tzinfo=timezone.utc), sid))
    community.sync(sb, bars=bars(("2026-10-28", 215.0), ("2026-10-29", 240.0)), now=datetime(2026, 10, 29, 21, 37, tzinfo=timezone.utc),
                   option_chains={"NVDA": chain(240, 40.0, 41.0, 1.0, 1.2)}, **common)
    assert float(me.q("select fill_price from public.option_orders where id = %s", (sid,))[0][0]) == 40.0
    # the last contract expires in the money: settled at intrinsic value (close 230 - strike 200 = 30)
    community.sync(sb, bars=bars(("2026-11-19", 235.0), ("2026-11-20", 230.0)), now=datetime(2026, 11, 20, 21, 37, tzinfo=timezone.utc),
                   option_chains={}, **common)
    exp = me.q("select qty, price from public.option_trades where side = 'expire'")
    assert [(q, float(p)) for q, p in exp] == [(1, 30.0)]
    final = float(me.q("select cash from public.portfolios where id = %s", (pf,))[0][0])
    assert final == pytest.approx(100000 - 3500 + 4000 + 3000)
    # « Levier gagnant » : 17,5 -> 40 and 30 on the two contracts = +100 % or more once the position is closed
    assert "levier_gagnant" in {r[0] for r in me.q("select badge_id from public.user_badges")}


def test_order_after_close_waits_for_next_session(dburl):  # noqa: F811
    url = dburl
    uid = _new_user(url, "late@x.test")
    _su(url, "insert into public.profiles (id, username) values (%s, 'late')", (uid,))
    me = Client(url, uid)
    sb = PgSupa(url)
    common = dict(fins={}, filings={}, guidance={}, consensus={}, next_earnings={}, names={})
    community.sync(sb, bars=bars(("2026-10-27", 210.0)), now=datetime(2026, 10, 28, 13, 7, tzinfo=timezone.utc),
                   option_chains={"NVDA": chain(210, 14.0, 14.6, 4.0, 4.4)}, **common)
    pf = me.q("insert into public.portfolios (name) values ('late') returning id")[0][0]
    oid = me.q("select (public.place_option_order(%s, 'NVDA', '2026-11-20', 200, 'P', 'buy', 1)).id", (pf,))[0][0]
    _su(url, "update public.option_orders set created_at = %s where id = %s", (datetime(2026, 10, 28, 20, 45, tzinfo=timezone.utc), oid))
    community.sync(sb, bars=bars(("2026-10-28", 215.0)), now=datetime(2026, 10, 28, 21, 37, tzinfo=timezone.utc),
                   option_chains={"NVDA": chain(215, 17.0, 17.5, 3.0, 3.3)}, **common)
    assert me.q("select status from public.option_orders where id = %s", (oid,))[0][0] == "pending"   # 16:45 NY: after the close


def ohlc(pts):
    """bars with open/high/low/volume for the execution model: (date, open, high, low, close, volume)."""
    return {"NVDA": [{"t": d, "o": o, "h": h, "l": l, "c": c, "v": v} for d, o, h, l, c, v in pts]}


def test_covered_call_cash_secured_put_and_limit_orders(dburl):  # noqa: F811
    url = dburl
    uid = _new_user(url, "writer@x.test")
    _su(url, "insert into public.profiles (id, username) values (%s, 'writer')", (uid,))
    me = Client(url, uid)
    sb = PgSupa(url)
    common = dict(fins={}, filings={}, guidance={}, consensus={}, next_earnings={}, names={"NVDA": "NVIDIA"})
    hist = [(f"2026-10-{d:02d}", 200, 202, 198, 200, 1_000_000) for d in range(1, 27)]
    community.sync(sb, bars=ohlc(hist), now=datetime(2026, 10, 27, 13, 7, tzinfo=timezone.utc),
                   option_chains={"NVDA": chain(200, 6.0, 6.4, 5.0, 5.4)}, **common)
    lp = me.q("select adv_shares, spread_bps, sigma_d from public.latest_prices where ticker = 'NVDA'")[0]
    assert float(lp[0]) == 1_000_000 and float(lp[1]) == pytest.approx(10 * (2e8 / 1e7) ** -0.5)
    pf = me.q("insert into public.portfolios (name) values ('w') returning id")[0][0]
    # no shares yet: a call cannot be sold; a put can, if 200 x 100 $ of cash stays free
    with pytest.raises(psycopg.errors.RaiseException, match="non couvert"):
        me.q("select public.place_option_order(%s, 'NVDA', '2026-11-20', 200, 'C', 'sell', 1)", (pf,))
    with pytest.raises(psycopg.errors.RaiseException, match="non garanti"):
        me.q("select public.place_option_order(%s, 'NVDA', '2026-11-20', 200, 'P', 'sell', 6)", (pf,))
    # buy 100 shares (market, morning of the 27th) and a limit buy at 195 that never trades through
    mk = me.q("select (public.place_order(%s, 'NVDA', 'buy', 100)).id", (pf,))[0][0]
    lim = me.q("select (public.place_order(%s, 'NVDA', 'buy', 10, 'limit', 195)).id", (pf,))[0][0]
    for oid in (mk, lim):
        _su(url, "update public.orders set created_at = %s where id = %s", (datetime(2026, 10, 27, 15, 0, tzinfo=timezone.utc), oid))
    put = me.q("select (public.place_option_order(%s, 'NVDA', '2026-11-20', 200, 'P', 'sell', 2)).id", (pf,))[0][0]
    _su(url, "update public.option_orders set created_at = %s where id = %s", (datetime(2026, 10, 27, 15, 0, tzinfo=timezone.utc), put))
    day = hist + [("2026-10-27", 200, 203, 197, 202, 1_000_000)]
    out = community.sync(sb, bars=ohlc(day), now=datetime(2026, 10, 27, 21, 37, tzinfo=timezone.utc),
                         option_chains={"NVDA": chain(202, 7.0, 7.4, 4.0, 4.4)}, **common)
    assert out["orders"]["filled"] == 1 and out["orders"]["waiting"] == 1        # the limit waits for the 28th
    o = me.q("select fill_price, detail from public.orders where id = %s", (mk,))[0]
    assert float(o[0]) > 202 and o[1]["half_spread_bps"] > 0 and o[1]["impact_bps"] > 0
    assert me.q("select status from public.option_orders where id = %s", (put,))[0][0] == "filled"   # sold at the bid, 4.0
    cash = float(me.q("select cash from public.portfolios where id = %s", (pf,))[0][0])
    assert cash == pytest.approx(100000 - 100 * float(o[0]) + 2 * 100 * 4.0, abs=0.02)
    # the cash securing the puts (2 x 200 x 100 = 40 000) cannot be spent
    big = me.q("select (public.place_order(%s, 'NVDA', 'buy', 300)).id", (pf,))[0][0]
    _su(url, "update public.orders set created_at = %s where id = %s", (datetime(2026, 10, 28, 15, 0, tzinfo=timezone.utc), big))
    # now covered: one call can be sold against the 100 shares, and those shares are locked
    _su(url, "insert into public.option_quotes (ticker, expiry, strike, type, bid, ask, mid, quote_date, evening) values "
             "('NVDA', '2026-11-20', 210, 'C', 1.0, 1.2, 1.1, '2026-10-27', true) on conflict do nothing")
    cc = me.q("select (public.place_option_order(%s, 'NVDA', '2026-11-20', 210, 'C', 'sell', 1)).id", (pf,))
    with pytest.raises(psycopg.errors.RaiseException, match="non couvert"):
        me.q("select public.place_option_order(%s, 'NVDA', '2026-11-20', 200, 'C', 'sell', 1)", (pf,))   # pending one counts
    with pytest.raises(psycopg.errors.RaiseException, match="Vente impossible"):
        me.q("select public.place_order(%s, 'NVDA', 'sell', 1)", (pf,))
    assert cc
    # 28th: the session trades down to 194 -> the 195 limit fills at 195; the big buy is rejected (reserved cash)
    day2 = day + [("2026-10-28", 201, 201, 194, 196, 1_000_000)]
    chain2 = chain(196, 3.0, 3.4, 7.0, 7.4)
    chain2["chains"]["2026-11-20"].append({"strike": 210.0, "c_bid": 1.0, "c_ask": 1.2, "c_mid": 1.1, "c_iv": 0.4,
                                           "p_bid": 14.0, "p_ask": 14.4, "p_mid": 14.2, "p_iv": 0.4})
    _su(url, "update public.option_orders set created_at = %s where side = 'sell' and strike = 210", (datetime(2026, 10, 28, 15, 0, tzinfo=timezone.utc),))
    out = community.sync(sb, bars=ohlc(day2), now=datetime(2026, 10, 28, 21, 37, tzinfo=timezone.utc),
                         option_chains={"NVDA": chain2}, **common)
    lo = me.q("select status, fill_price from public.orders where id = %s", (lim,))[0]
    assert lo[0] == "filled" and float(lo[1]) == 195.0
    b = me.q("select status, reason from public.orders where id = %s", (big,))[0]
    assert b[0] == "rejected" and "puts vendus" in b[1]
    assert {"vendeur_primes", "ordre_limite"} <= {r[0] for r in me.q("select badge_id from public.user_badges")}
    # short positions count as liabilities in the portfolio value
    val = float(_su(url, "select value from public.portfolio_values where portfolio_id = %s and date = '2026-10-28'", (pf,))[0][0])
    cash = float(me.q("select cash from public.portfolios where id = %s", (pf,))[0][0])
    assert val == pytest.approx(cash + 110 * 196 - 2 * 100 * 7.2 - 1 * 100 * 1.1, abs=0.05)
    # expiry at 190: puts lose 10 each (paid by the seller), the 210 call expires worthless
    community.sync(sb, bars=ohlc(day2 + [("2026-11-20", 191, 192, 189, 190, 1_000_000)]),
                   now=datetime(2026, 11, 20, 21, 37, tzinfo=timezone.utc), option_chains={}, **common)
    pos = me.q("select type, strike, sum(case when side = 'buy' then qty else -qty end) from public.option_trades group by type, strike")
    assert all(q == 0 for _, _, q in pos)
    after = float(me.q("select cash from public.portfolios where id = %s", (pf,))[0][0])
    assert after == pytest.approx(cash - 2 * 100 * 10, abs=0.01)
    assert float(_su(url, "select public._reserved_cash(%s)", (pf,))[0][0]) == 0     # collateral released
