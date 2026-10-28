"""Pipeline <-> members' database, end to end on a real PostgreSQL.

`PgSupa` speaks to PostgreSQL with the same three verbs the pipeline uses on Supabase's REST API
(select / upsert / rpc), as the service role. So this checks the real schema, constraints and
functions together with the Python resolution logic.
"""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from pipeline import community, normalize
from tests.test_db import ADMIN_URL, Client, _new_user, _su, psycopg  # noqa: F401  (fixtures below)
from tests.test_db import dburl  # noqa: F401  (module-scoped database fixture)

needs_db = pytest.mark.skipif(not ADMIN_URL, reason="TEST_DATABASE_URL non défini")
FIX = Path(__file__).parent / "fixtures"


class PgSupa:
    def __init__(self, url):
        self.c = Client(url, None, role="service_role")

    def select(self, table, params=None):
        params = dict(params or {})
        where, args, order = [], [], ""
        for k, v in params.items():
            if k == "order":
                col, _, d = v.partition(".")
                order = f" order by {col} {'desc' if d == 'desc' else 'asc'}"
            elif k != "select" and v.startswith("eq."):
                where.append(f"{k}::text = %s")
                args.append(v[3:])
        sql = f"select to_jsonb(x) from public.{table} x" + (" where " + " and ".join(where) if where else "") + order
        return [json.loads(json.dumps(r[0], default=str)) for r in self.c.q(sql, args)]

    def upsert(self, table, rows, on_conflict):
        for r in rows:
            cols = list(r)
            upd = ", ".join(f"{c} = excluded.{c}" for c in cols if c not in on_conflict.split(","))
            sql = (f"insert into public.{table} ({', '.join(cols)}) select * from jsonb_populate_record(null::public.{table}, %s) "
                   .replace("select *", "select " + ", ".join(cols))
                   + f" on conflict ({on_conflict}) do " + (f"update set {upd}" if upd else "nothing"))
            self.c.q(sql, (json.dumps(r, default=str),), fetch=False)

    def rpc(self, fn, args):
        cast = lambda v: "::bigint" if isinstance(v, int) else "::numeric" if isinstance(v, float) else ""  # noqa: E731
        names = ", ".join(f"{k} => %s{cast(v)}" for k, v in args.items())
        r = self.c.q(f"select to_jsonb(public.{fn}({names}))", list(args.values()))
        return r[0][0] if r else None


@pytest.fixture(scope="module")
def fin():
    return normalize.normalize(json.loads((FIX / "facts_NVDA.json").read_text()), max_years=20, max_quarters=100)


def _bars():
    d, out, p = datetime(2026, 8, 1).date(), [], 150.0
    while d <= datetime(2026, 10, 30).date():
        if d.weekday() < 5:
            p *= 1.003
            out.append({"t": d.isoformat(), "c": round(p, 2)})
        d += timedelta(days=1)
    return out


@needs_db
def test_sync_end_to_end(dburl, fin):  # noqa: F811
    url = dburl
    filings = {"NVDA": [{"form": "10-Q", "filed": "2026-08-27", "is_results": True, "items": ""}]}
    bars = {"NVDA": _bars(), "SPY": [{"t": "2026-10-29", "c": 650.0}]}
    # members
    ids = []
    for i, name in enumerate(("alice", "bob", "carol")):
        uid = _new_user(url, f"{name}@x.test")
        ids.append(uid)
        _su(url, "insert into public.profiles (id, username) values (%s, %s)", (uid, name))
    alice, bob, carol = (Client(url, u) for u in ids)
    sb = PgSupa(url)
    now0 = datetime(2026, 8, 20, 12, tzinfo=timezone.utc)

    # first sync creates the periods (Q2 FY2027 already published in the fixture: deadline in the past)
    ne = {"NVDA": {"period": "Q3 FY2027", "date": "2026-11-18", "estimated": True,
                   "deadline": "2026-11-18T05:00:00+00:00"}}
    community.sync(sb, fins={"NVDA": fin}, filings=filings, bars=bars, guidance={}, consensus={},
                   next_earnings=ne, names={"NVDA": "NVIDIA"}, now=now0)
    rows = {r["period"]: r for r in sb.select("periods")}
    assert rows["Q2 FY2027"]["release_date"] == "2026-08-27"
    assert rows["Q3 FY2027"]["expected_release"] == "2026-11-18"

    # members predict Q2 while still open (simulate: reopen the period, then close it)
    _su(url, "update public.periods set deadline = now() + interval '1 day' where period = 'Q2 FY2027'")
    pred = "insert into public.predictions (ticker, period, metrics, questions) values ('NVDA', 'Q2 FY2027', %s, %s) returning id"
    alice.q(pred, (json.dumps({"revenue": {"value": 97.0, "low": 93, "high": 100}, "gross_margin": {"value": 75.0}}),
                   json.dumps([{"id": "rev_above_crowd", "p": 70}, {"id": "price_up_after", "p": 55}])))
    bob.q(pred, (json.dumps({"revenue": {"value": 90.0}}), "[]"))
    carol.q(pred, (json.dumps({"revenue": {"value": 92.0}}), "[]"))
    # history timestamps: put the versions before the real deadline, and one late edit by bob after it
    _su(url, "update public.prediction_history set recorded_at = '2026-08-20T10:00:00+00:00'")
    _su(url, """insert into public.prediction_history (prediction_id, user_id, snapshot, recorded_at)
                select id, user_id, jsonb_build_object('metrics', '{"revenue": {"value": 96.2}}'::jsonb,
                       'questions', '[]'::jsonb, 'price_targets', '[]'::jsonb), '2026-08-28T10:00:00+00:00'
                from public.predictions where user_id = %s""", (ids[1],))
    # a paper portfolio with an order placed after the close of 2026-10-28 (New York)
    pf = alice.q("insert into public.portfolios (name) values ('test') returning id")[0][0]
    oid = alice.q("select (public.place_order(%s, 'NVDA', 'buy', 10)).id", (pf,))[0][0]
    _su(url, "update public.orders set created_at = '2026-10-28T21:30:00+00:00' where id = %s", (oid,))

    out = community.sync(sb, fins={"NVDA": fin}, filings=filings, bars=bars, guidance={"NVDA": {"Q2 FY2027": {"revenue": 94.0}}},
                         consensus={"NVDA": [{"date": "2026-08-25", "period": "Q2 FY2027", "revenue_avg": 94.5e9}]},
                         next_earnings=ne, names={"NVDA": "NVIDIA"}, now=datetime(2026, 10, 30, 22, tzinfo=timezone.utc))
    assert out["orders"]["filled"] == 1
    o = sb.select("orders", {"id": f"eq.{oid}"})[0]
    assert o["fill_date"] == "2026-10-29"           # 17:30 New York on the 28th -> next session's close
    nv = {b["t"]: b["c"] for b in bars["NVDA"]}
    assert float(o["fill_price"]) == pytest.approx(nv["2026-10-29"])

    res = {r["user_id"]: r for r in sb.select("prediction_results")}
    a = res[str(ids[0])]
    assert a["status"] == "resolved"
    rev = next(m for m in a["results"]["metrics"] if m["key"] == "revenue")
    assert rev["actual"] == pytest.approx(96.2e9) and rev["in_interval"] is True
    assert rev["benchmarks"]["crowd"] == pytest.approx(91e9)          # median of bob & carol (leave-one-out)
    assert rev["vs"]["crowd"]["you_win"] is True and rev["vs"]["analysts"]["you_win"] is True
    assert a["score"]["interval_hit"] == 1 and a["score"]["brier_n"] == 2
    q = {x["id"]: x for x in a["results"]["questions"]}
    assert q["rev_above_crowd"]["outcome"] is True                     # 96.2 > median(97, 90, 92) = 92
    assert q["price_up_after"]["outcome"] is True                      # synthetic bars always rise
    b = res[str(ids[1])]
    bev = next(m for m in b["results"]["metrics"] if m["key"] == "revenue")
    assert bev["value"] == pytest.approx(90e9)                         # the late edit (96.2) is ignored
    crowd = {r["metric"]: r for r in sb.select("crowd_consensus")}
    assert crowd["revenue"]["n"] == 3 and float(crowd["revenue"]["median"]) == pytest.approx(92e9)
    vals = sb.select("portfolio_values")
    assert len(vals) == 1 and float(vals[0]["value"]) == pytest.approx(
        100000 - 10 * nv["2026-10-29"] + 10 * bars["NVDA"][-1]["c"], abs=0.02)
    lb = alice.q("select username, rev_n, interval_hit, crowd_wins from public.leaderboard()")
    assert ("alice", 1, 1, 1) in lb
    # group can now see each other's predictions and results
    assert len(bob.q("select id from public.predictions")) == 3
    assert len(bob.q("select prediction_id from public.prediction_results")) == 3


def test_fill_bar_rules():
    bars = [{"t": "2026-10-28", "c": 1}, {"t": "2026-10-29", "c": 2}]
    ny_morning = datetime(2026, 10, 28, 14, tzinfo=timezone.utc)      # 10:00 New York
    ny_evening = datetime(2026, 10, 28, 21, tzinfo=timezone.utc)      # 17:00 New York
    assert community.fill_bar(bars, ny_morning)["t"] == "2026-10-28"
    assert community.fill_bar(bars, ny_evening)["t"] == "2026-10-29"
    assert community.fill_bar(bars, datetime(2026, 10, 29, 21, tzinfo=timezone.utc)) is None


def test_public_url_from_site_config(tmp_path, monkeypatch):
    f = tmp_path / "config.js"
    f.write_text('window.ARCHER_CONFIG = { supabaseUrl: "https://abc.supabase.co", supabaseKey: "sb_publishable_x" };')
    assert community.public_url(f) == "https://abc.supabase.co"
    assert community.public_url(tmp_path / "missing.js") == ""
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_KEY", raising=False)
    assert community.Supa.from_env() is None          # no service key -> members' sync is skipped
