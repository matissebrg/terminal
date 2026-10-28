"""Security tests for the members' database (supabase/migrations), run on a real PostgreSQL.

Each test acts like a real API client: role `authenticated` + JWT claims, exactly as Supabase
does it, and tries to cheat. Skipped unless TEST_DATABASE_URL points to a PostgreSQL server
where we may create databases (CI starts one; locally see README).
"""
import json
import os
import uuid
from pathlib import Path

import pytest

psycopg = pytest.importorskip("psycopg")
ADMIN_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not ADMIN_URL, reason="TEST_DATABASE_URL non défini")

ROOT = Path(__file__).resolve().parent.parent
SHIM = (ROOT / "supabase" / "tests" / "supabase_shim.sql").read_text()
MIGRATIONS = sorted((ROOT / "supabase" / "migrations").glob("*.sql"))


@pytest.fixture(scope="module")
def dburl():
    name = "archer_test_" + uuid.uuid4().hex[:8]
    with psycopg.connect(ADMIN_URL, autocommit=True) as c:
        c.execute(f"create database {name} encoding 'UTF8' template template0")
    url = _with_db(ADMIN_URL, name)
    with psycopg.connect(url, autocommit=True) as c:
        c.execute(SHIM)
        for m in MIGRATIONS:
            c.execute(m.read_text())
        c.execute("insert into public.app_config (key, value) values ('admin_email', 'founder@archer.test')")
    yield url
    with psycopg.connect(ADMIN_URL, autocommit=True) as c:
        c.execute(f"drop database {name} with (force)")


def _with_db(url: str, name: str) -> str:
    if url.startswith("postgres"):
        base, _, rest = url.partition("://")
        hostpart, _, tail = rest.partition("/")
        q = ("?" + tail.split("?", 1)[1]) if "?" in tail else ""
        return f"{base}://{hostpart}/{name}{q}"
    return f"{url} dbname={name}"


class Client:
    """One API caller: role + JWT claims set for every statement, like PostgREST."""

    def __init__(self, url, user=None, role="authenticated"):
        self.conn = psycopg.connect(url, autocommit=True)
        self.user, self.role = user, role

    def q(self, sql, params=None, fetch=True):
        with self.conn.transaction():
            with self.conn.cursor() as cur:
                cur.execute(f"set local role {self.role}")
                claims = {"role": self.role, **({"sub": str(self.user)} if self.user else {})}
                cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps(claims),))
                cur.execute(sql, params)
                return cur.fetchall() if fetch and cur.description else None


def _new_user(url, email):
    uid = uuid.uuid4()
    with psycopg.connect(url, autocommit=True) as c:
        c.execute("insert into auth.users (id, email) values (%s, %s)", (uid, email))
    return uid


def _su(url, sql, params=None):
    with psycopg.connect(url, autocommit=True) as c:
        cur = c.execute(sql, params)
        return cur.fetchall() if cur.description else None


@pytest.fixture(scope="module")
def world(dburl):
    """Founder (admin) + one invited member + one outsider, a period open for predictions."""
    f_id = _new_user(dburl, "founder@archer.test")
    founder = Client(dburl, f_id)
    founder.q("select public.join_with_code('', 'matisse')")
    code = founder.q("select (public.create_invite(2, 30, 'amis')).code")[0][0]
    m_id = _new_user(dburl, "ami@archer.test")
    member = Client(dburl, m_id)
    member.q("select public.join_with_code(%s, 'ami')", (code.lower(),))
    o_id = _new_user(dburl, "intrus@archer.test")
    outsider = Client(dburl, o_id)
    _su(dburl, """insert into public.periods (ticker, period, period_end, expected_release, deadline)
                  values ('NVDA', 'Q3 FY2027', '2026-10-25', '2026-11-17', now() + interval '10 days')""")
    _su(dburl, """insert into public.latest_prices (ticker, name, close, price_date) values
                  ('NVDA', 'NVIDIA', 200, '2026-10-27'), ('SPY', 'S&P 500', 650, '2026-10-27')""")
    return {"url": dburl, "founder": founder, "member": member, "outsider": outsider, "code": code,
            "ids": {"founder": f_id, "member": m_id, "outsider": o_id}}


# ------------------------------------------------------------------------------ membership
def test_founder_is_admin_and_member_is_not(world):
    rows = world["founder"].q("select username, is_admin from public.profiles order by username")
    assert ("matisse", True) in rows and ("ami", False) in rows


def test_outsider_sees_nothing_and_needs_a_code(world):
    o = world["outsider"]
    assert o.q("select * from public.periods") == []
    assert o.q("select * from public.profiles") == []
    with pytest.raises(psycopg.errors.RaiseException, match="Code d'invitation requis"):
        o.q("select public.join_with_code('', 'intrus')")
    with pytest.raises(psycopg.errors.RaiseException, match="invalide"):
        o.q("select public.join_with_code('ARCHER-FAUX', 'intrus')")


def test_anonymous_has_no_access(world):
    anon = Client(world["url"], None, role="anon")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        anon.q("select public.join_with_code('x', 'y')")
    for table in ("predictions", "profiles", "portfolios", "latest_prices", "prediction_results"):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):   # no grant at all, not even an empty read
            anon.q(f"select * from public.{table}")


def test_invite_code_usage_limit(world):
    u = _new_user(world["url"], "deux@archer.test")
    Client(world["url"], u).q("select public.join_with_code(%s, 'deux')", (world["code"],))
    u3 = _new_user(world["url"], "trois@archer.test")
    with pytest.raises(psycopg.errors.RaiseException, match="entièrement utilisé"):
        Client(world["url"], u3).q("select public.join_with_code(%s, 'trois')", (world["code"],))


def test_member_cannot_make_himself_admin_nor_list_codes(world):
    m = world["member"]
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        m.q("update public.profiles set is_admin = true where id = %s", (world["ids"]["member"],), fetch=False)
    with pytest.raises(psycopg.errors.RaiseException, match="administrateurs"):
        m.q("select * from public.list_invites()")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        m.q("select * from public.invite_codes")
    m.q("update public.profiles set show_on_leaderboard = false where id = %s", (world["ids"]["member"],), fetch=False)


# ------------------------------------------------------------------------------ predictions
PRED = """insert into public.predictions (ticker, period, metrics, questions, note)
          values ('NVDA', 'Q3 FY2027', %s, %s, %s) returning id, user_id"""


def test_prediction_lifecycle_and_deadline(world):
    f, m, url = world["founder"], world["member"], world["url"]
    pid, uid = f.q(PRED, (json.dumps({"revenue": {"value": 110.5, "low": 106, "high": 115}}),
                          json.dumps([{"id": "rev_above_crowd", "p": 60}]), "test"))[0]
    assert uid == world["ids"]["founder"]
    # the other member cannot see it before the deadline, but sees the count
    assert m.q("select id from public.predictions where id = %s", (pid,)) == []
    assert m.q("select public.prediction_count('NVDA', 'Q3 FY2027')")[0][0] >= 1
    # update before the deadline -> new version archived
    f.q("update public.predictions set metrics = %s where id = %s",
        (json.dumps({"revenue": {"value": 112}}), pid), fetch=False)
    assert f.q("select count(*) from public.prediction_history where prediction_id = %s", (pid,))[0][0] == 2
    assert m.q("select count(*) from public.prediction_history where prediction_id = %s", (pid,))[0][0] == 0
    # deadline passes
    _su(url, "update public.periods set deadline = now() - interval '1 minute' where ticker = 'NVDA'")
    with pytest.raises(psycopg.errors.RaiseException, match="Date limite dépassée"):
        f.q("update public.predictions set metrics = %s where id = %s",
            (json.dumps({"revenue": {"value": 999}}), pid), fetch=False)
    assert f.q("delete from public.predictions where id = %s returning id", (pid,)) == []
    assert m.q("select id from public.predictions where id = %s", (pid,)) == [(pid,)]   # now visible to the group
    with pytest.raises(psycopg.errors.RaiseException, match="Date limite"):
        m.q(PRED, (json.dumps({"revenue": {"value": 100}}), "[]", None))
    _su(url, "update public.periods set deadline = now() + interval '10 days' where ticker = 'NVDA'")


def test_private_prediction_stays_private_and_spoofing_is_impossible(world):
    f, m, url = world["founder"], world["member"], world["url"]
    # tries to write a prediction in the founder's name
    pid, uid = m.q("""insert into public.predictions (user_id, ticker, period, metrics, visibility)
                      values (%s, 'NVDA', 'Q3 FY2027', %s, 'private') returning id, user_id""",
                   (world["ids"]["founder"], json.dumps({"revenue": {"value": 101}})))[0]
    assert uid == world["ids"]["member"]                       # forced to the caller
    _su(url, "update public.periods set deadline = now() - interval '1 minute' where ticker = 'NVDA'")
    assert f.q("select id from public.predictions where id = %s", (pid,)) == []
    _su(url, "update public.periods set deadline = now() + interval '10 days' where ticker = 'NVDA'")


def test_prediction_validation(world):
    m = world["member"]
    with pytest.raises(psycopg.errors.RaiseException, match="Indicateur inconnu"):
        m.q(PRED.replace("'Q3 FY2027'", "'Q3 FY2027'"), (json.dumps({"bitcoin": {"value": 1}}), "[]", None))
    with pytest.raises(psycopg.errors.RaiseException, match="Question invalide"):
        m.q("update public.predictions set questions = %s where user_id = %s",
            (json.dumps([{"id": "rev_above_crowd", "p": 140}]), world["ids"]["member"]), fetch=False)


# ------------------------------------------------------------------------------ portfolios
def test_portfolio_cash_cannot_be_forged(world):
    m = world["member"]
    pid, cash = m.q("insert into public.portfolios (name, cash, initial_cash) values ('test', 1e12, 1e12) returning id, cash")[0]
    assert cash == 100000
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        m.q("update public.portfolios set cash = 1e12 where id = %s", (pid,), fetch=False)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        m.q("insert into public.trades (portfolio_id, user_id, ticker, side, qty, price, price_date) "
            "values (%s, %s, 'NVDA', 'sell', 1, 1, '2026-01-01')", (pid, world["ids"]["member"]), fetch=False)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        m.q("select public.fill_order(1, 1, '2026-01-01')")


def test_orders_execute_only_through_fill(world):
    f, m, url = world["founder"], world["member"], world["url"]
    pf = f.q("insert into public.portfolios (name) values ('principal') returning id")[0][0]
    with pytest.raises(psycopg.errors.RaiseException, match="introuvable"):
        m.q("select public.place_order(%s, 'NVDA', 'buy', 1)", (pf,))          # not his portfolio
    with pytest.raises(psycopg.errors.RaiseException, match="non disponible"):
        f.q("select public.place_order(%s, 'FAKE', 'buy', 1)", (pf,))
    buy = f.q("select (public.place_order(%s, 'nvda', 'buy', 100)).id", (pf,))[0][0]
    too_big = f.q("select (public.place_order(%s, 'NVDA', 'buy', 1000)).id", (pf,))[0][0]
    short = f.q("select (public.place_order(%s, 'SPY', 'sell', 1)).id", (pf,))[0][0]
    svc = Client(url, None, role="service_role")
    assert svc.q("select (public.fill_order(%s, 201.5, '2026-10-28')).status", (buy,))[0][0] == "filled"
    assert svc.q("select (public.fill_order(%s, 201.5, '2026-10-28')).status", (too_big,))[0][0] == "rejected"
    assert svc.q("select (public.fill_order(%s, 650, '2026-10-28')).status", (short,))[0][0] == "rejected"
    assert float(f.q("select cash from public.portfolios where id = %s", (pf,))[0][0]) == pytest.approx(100000 - 20150)
    sell = f.q("select (public.place_order(%s, 'NVDA', 'sell', 40)).id", (pf,))[0][0]
    svc.q("select public.fill_order(%s, 210, '2026-10-29')", (sell,))
    assert float(f.q("select cash from public.portfolios where id = %s", (pf,))[0][0]) == pytest.approx(100000 - 20150 + 8400)
    # group visibility of portfolios and trades, orders stay private
    assert m.q("select count(*) from public.trades where portfolio_id = %s", (pf,))[0][0] == 2
    assert m.q("select count(*) from public.orders where portfolio_id = %s", (pf,))[0][0] == 0
    # cancel
    o = f.q("select (public.place_order(%s, 'NVDA', 'buy', 1)).id", (pf,))[0][0]
    assert f.q("select (public.cancel_order(%s)).status", (o,))[0][0] == "cancelled"
    with pytest.raises(psycopg.errors.RaiseException):
        m.q("select public.cancel_order(%s)", (o,))


def test_portfolio_limit(world):
    u = _new_user(world["url"], "limite@archer.test")
    c = Client(world["url"], u)
    code = world["founder"].q("select (public.create_invite(1, 1, null)).code")[0][0]
    c.q("select public.join_with_code(%s, 'limite')", (code,))
    for i in range(5):
        c.q("insert into public.portfolios (name) values (%s)", (f"p{i}",), fetch=False)
    with pytest.raises(psycopg.errors.RaiseException, match="Maximum 5"):
        c.q("insert into public.portfolios (name) values ('p6')", fetch=False)


def test_leaderboard_runs(world):
    assert world["member"].q("select * from public.leaderboard()") == []
    with pytest.raises(psycopg.errors.RaiseException):
        world["outsider"].q("select * from public.leaderboard()")


def test_delete_my_account_cascades(world):
    url = world["url"]
    u = _new_user(url, "partant@archer.test")
    c = Client(url, u)
    code = world["founder"].q("select (public.create_invite(1, 1, null)).code")[0][0]
    c.q("select public.join_with_code(%s, 'partant')", (code,))
    c.q("insert into public.portfolios (name) values ('x')", fetch=False)
    c.q("select public.delete_my_account()")
    assert _su(url, "select count(*) from public.profiles where id = %s", (u,))[0][0] == 0
    assert _su(url, "select count(*) from public.portfolios where user_id = %s", (u,))[0][0] == 0
    assert _su(url, "select count(*) from auth.users where id = %s", (u,))[0][0] == 0
