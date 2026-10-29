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
    with pytest.raises(psycopg.errors.RaiseException, match="découvert"):
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
