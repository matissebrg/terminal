"""Titles, admin member list, private messages and the harder achievements (0003_social.sql)."""
import json
import uuid
from datetime import date, timedelta

import pytest

from tests.test_db import ADMIN_URL, Client, _new_user, _su, psycopg  # noqa: F401
from tests.test_db import dburl  # noqa: F401  (fresh database for this module)

pytestmark = pytest.mark.skipif(not ADMIN_URL, reason="TEST_DATABASE_URL non défini")


@pytest.fixture(scope="module")
def town(dburl):  # noqa: F811
    f_id = _new_user(dburl, "founder@archer.test")
    admin = Client(dburl, f_id)
    admin.q("select public.join_with_code('', 'matisse')")
    code = admin.q("select (public.create_invite(20, 30, 'beta')).code")[0][0]
    people = {"matisse": (f_id, admin)}
    for name in ("alice", "bob", "carol"):
        uid = _new_user(dburl, f"{name}@archer.test")
        c = Client(dburl, uid)
        c.q("select public.join_with_code(%s, %s)", (code, name))
        people[name] = (uid, c)
    return {"url": dburl, "p": people}


def _badges(url, uid):
    return {r[0] for r in _su(url, "select badge_id from public.user_badges where user_id = %s", (uid,))}


# ------------------------------------------------------------------------------ titles
def test_title_only_from_unlocked_badges(town):
    uid, a = town["p"]["alice"]
    a.q("update public.profiles set title_badge = 'founders' where id = %s", (uid,), fetch=False)   # first 10: unlocked
    with pytest.raises(psycopg.errors.RaiseException, match="non débloqué"):
        a.q("update public.profiles set title_badge = 'oracle' where id = %s", (uid,), fetch=False)
    with pytest.raises(psycopg.errors.RaiseException, match="non débloqué"):
        a.q("update public.profiles set title_badge = 'members' where id = %s", (uid,), fetch=False)  # no title
    _, admin = town["p"]["matisse"]
    admin.q("select public.revoke_badge('alice', 'founders')")
    assert a.q("select title_badge from public.profiles where id = %s", (uid,)) == [(None,)]


def test_admin_member_list_is_admin_only(town):
    _, admin = town["p"]["matisse"]
    rows = admin.q("select username, email from public.admin_members()")
    assert ("bob", "bob@archer.test") in rows and len(rows) == 4
    _, b = town["p"]["bob"]
    with pytest.raises(psycopg.errors.RaiseException, match="administrateurs"):
        b.q("select * from public.admin_members()")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        b.q("select * from public.message_reports")


# ------------------------------------------------------------------------------ messages
def test_messages_are_private_and_notify_once_per_conversation(town):
    url = town["url"]
    a_id, a = town["p"]["alice"]
    b_id, b = town["p"]["bob"]
    _, c = town["p"]["carol"]
    _, admin = town["p"]["matisse"]
    a.q("select public.send_message('BOB', 'salut, ton avis sur WMT ?')")
    a.q("select public.send_message('bob', 'et sur la marge ?')")
    assert len(b.q("select body from public.messages")) == 2
    assert c.q("select body from public.messages") == []           # third party: nothing
    assert admin.q("select body from public.messages") == []       # admins cannot read conversations
    notes = b.q("select title, data ->> 'count' from public.notifications where kind = 'message'")
    assert notes == [("Nouveau message de alice", "2")]           # one notification, counter updated
    conv = b.q("select username, unread, last_from_me from public.conversations()")
    assert conv == [("alice", 2, False)]
    assert b.q("select public.mark_conversation_read('alice')")[0][0] == 2
    assert b.q("select unread from public.conversations()") == [(0,)]
    assert b.q("select count(*) from public.notifications where kind = 'message' and read_at is null")[0][0] == 0
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        a.q("insert into public.messages (sender, recipient, body) values (%s, %s, 'x')", (b_id, a_id), fetch=False)
    with pytest.raises(psycopg.errors.RaiseException, match="soi-même"):
        a.q("select public.send_message('alice', 'moi')")


def test_block_and_report(town):
    _, a = town["p"]["alice"]
    _, c = town["p"]["carol"]
    _, admin = town["p"]["matisse"]
    c.q("select public.send_message('alice', 'message déplacé')")
    mid = a.q("select id from public.messages where body = 'message déplacé'")[0][0]
    a.q("select public.report_message(%s, 'insultant')", (mid,))
    rep = admin.q("select reporter, reported, body_copy, reason from public.admin_reports()")
    assert rep == [("alice", "carol", "message déplacé", "insultant")]
    assert admin.q("select title from public.notifications where kind = 'report'") == [("Message signalé : carol",)]
    with pytest.raises(psycopg.errors.RaiseException, match="message reçu"):
        c.q("select public.report_message(%s)", (mid,))              # cannot report one's own message
    a.q("select public.block_user('carol')")
    with pytest.raises(psycopg.errors.RaiseException, match="ne reçoit pas"):
        c.q("select public.send_message('alice', 'encore')")
    with pytest.raises(psycopg.errors.RaiseException, match="bloqué"):
        a.q("select public.send_message('carol', 'hello')")
    a.q("select public.block_user('carol', false)")
    c.q("select public.send_message('alice', 'pardon')")


def test_rate_limit(town):
    _, b = town["p"]["bob"]
    for i in range(30):
        b.q("select public.send_message('carol', %s)", (f"m{i}",))
    with pytest.raises(psycopg.errors.RaiseException, match="Trop de messages"):
        b.q("select public.send_message('carol', 'un de trop')")


# ------------------------------------------------------------------------------ harder achievements
def _result(url, uid, ticker, period, release, score, rev=None):
    _su(url, "insert into public.periods (ticker, period, deadline, release_date) values (%s, %s, now() + interval '1 day', %s) "
             "on conflict (ticker, period) do update set deadline = now() + interval '1 day'", (ticker, period, release))
    pid = uuid.uuid4()
    _su(url, "insert into public.predictions (id, user_id, ticker, period) values (%s, %s, %s, %s)", (pid, uid, ticker, period))
    _su(url, "update public.periods set deadline = now() - interval '1 day' where ticker = %s and period = %s", (ticker, period))
    results = {"metrics": [{"key": "revenue", **rev}]} if rev else {}
    Client(url, None, role="service_role").q(
        "insert into public.prediction_results (prediction_id, user_id, ticker, period, status, score, results) "
        "values (%s, %s, %s, %s, 'resolved', %s, %s)", (pid, uid, ticker, period, json.dumps(score), json.dumps(results)),
        fetch=False)


def test_harder_achievements(town):
    url = town["url"]
    uid, _ = town["p"]["carol"]
    win = {"beat_naive": True, "beat_analysts": True, "beat_crowd": True}
    _result(url, uid, "NVDA", "Q1 FY2026", "2025-05-28", {"rev_abs_err": 0.002, **win},
            rev={"value": 104, "actual": 104.2, "benchmarks": {"analysts": 101}})          # contrarian, right
    _result(url, uid, "NVDA", "Q2 FY2026", "2025-08-27", {"rev_abs_err": 0.008, **win})
    _result(url, uid, "NVDA", "Q3 FY2026", "2025-11-19", {"rev_abs_err": 0.009, **win})
    svc = Client(url, None, role="service_role")
    svc.q("select public.grant_auto_badges()")
    got = _badges(url, uid)
    assert {"chirurgien", "tireur_elite", "triple_couronne", "contrarian", "fleau_wall_street"} <= got
    assert "marathonien" not in got and "numero_un" not in got        # 3 results, not 8; fewer than 6 ranked


def test_streak_must_be_consecutive(town):
    url = town["url"]
    uid, _ = town["p"]["bob"]
    for k, (rel, w) in enumerate([("2025-05-28", True), ("2025-08-27", False), ("2025-11-19", True), ("2026-02-25", True)]):
        _result(url, uid, "WMT", f"Q{k + 1} FY2026", rel, {"rev_abs_err": 0.05, "beat_analysts": w})
    Client(url, None, role="service_role").q("select public.grant_auto_badges()")
    assert "fleau_wall_street" not in _badges(url, uid)              # won, lost, won, won: no 3 in a row


def test_portfolio_achievements_and_complete_analyst(town):
    url = town["url"]
    uid, a = town["p"]["alice"]
    pf = a.q("insert into public.portfolios (name) values ('test') returning id")[0][0]
    d0 = date(2026, 1, 2)
    svc = Client(url, None, role="service_role")
    for i, (val, spy) in enumerate([(100000, 600), (118000, 640), (130000, 650)]):
        svc.q("insert into public.portfolio_values (portfolio_id, date, value, cash, spy_close) values (%s, %s, %s, 0, %s)",
              (pf, d0 + timedelta(days=60 * i), val, spy), fetch=False)
    for t in ("AAA", "BBB", "CCC", "DDD", "EEE"):
        svc.q("insert into public.trades (portfolio_id, user_id, ticker, side, qty, price, price_date) "
              "values (%s, %s, %s, 'buy', 1, 10, '2026-01-02')", (pf, uid, t), fetch=False)
    svc.q("select public.grant_auto_badges()")
    got = _badges(url, uid)
    assert {"gerant_10", "gerant_25", "alpha", "diversifie", "premier_ordre"} <= got and "gerant_50" not in got
    _su(url, "insert into public.periods (ticker, period, deadline) values ('AMD', 'Q4 FY2026', now() + interval '5 days')")
    full = {k: {"value": 1, "low": 0.5, "high": 2} for k in
            ("revenue", "gross_margin", "operating_income", "operating_margin", "net_income", "eps_diluted", "fcf")}
    a.q("insert into public.predictions (ticker, period, metrics) values ('AMD', 'Q4 FY2026', %s)", (json.dumps(full),), fetch=False)
    assert "analyste_complet" in _badges(url, uid)
