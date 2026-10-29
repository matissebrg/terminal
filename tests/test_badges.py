"""Badges and notifications (supabase/migrations/0002_badges.sql), on a real PostgreSQL.

Nobody can give themselves a badge: only the database functions award them, and every award
notifies its holder (and only them)."""
import json
import uuid

import pytest

from tests.test_db import ADMIN_URL, Client, _new_user, _su, psycopg  # noqa: F401
from tests.test_db import dburl  # noqa: F401  (fresh database for this module)

pytestmark = pytest.mark.skipif(not ADMIN_URL, reason="TEST_DATABASE_URL non défini")


@pytest.fixture(scope="module")
def club(dburl):  # noqa: F811
    f_id = _new_user(dburl, "founder@archer.test")
    founder = Client(dburl, f_id)
    founder.q("select public.join_with_code('', 'matisse')")
    code = founder.q("select (public.create_invite(50, 30, 'beta')).code")[0][0]
    members = []
    for i in range(11):
        uid = _new_user(dburl, f"m{i}@archer.test")
        c = Client(dburl, uid)
        c.q("select public.join_with_code(%s, %s)", (code, f"membre{i}"))
        members.append((uid, c))
    _su(dburl, """insert into public.periods (ticker, period, deadline) values
                  ('NVDA', 'Q3 FY2027', now() + interval '10 days'), ('WMT', 'Q3 FY2027', now() + interval '10 days')""")
    return {"url": dburl, "founder": founder, "f_id": f_id, "members": members}


def badges_of(c, uid):
    return {r[0] for r in c.q("select badge_id from public.user_badges where user_id = %s", (uid,))}


def test_join_awards_members_founder_and_first_ten(club):
    f = club["founder"]
    assert badges_of(f, club["f_id"]) == {"members", "founders"}
    first9 = [uid for uid, _ in club["members"][:9]]         # founder + 9 = the first 10 members
    for uid in first9:
        assert badges_of(f, uid) == {"members", "founders"}
    assert badges_of(f, club["members"][10][0]) == {"members"}    # 12th member: not a founder
    assert badges_of(f, club["members"][9][0]) == {"members"}     # 11th member


def test_notifications_are_private_and_can_be_marked_read(club):
    uid, m = club["members"][0]
    mine = m.q("select title, kind, user_id from public.notifications")
    assert {r[0] for r in mine} == {"Nouveau badge : Members", "Nouveau badge : Founders"}
    assert all(r[2] == uid for r in mine)                       # nobody else's notifications
    assert m.q("select public.mark_notifications_read(null)")[0][0] == 2
    assert m.q("select count(*) from public.notifications where read_at is null")[0][0] == 0
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        m.q("update public.notifications set read_at = null", fetch=False)


def test_members_cannot_award_themselves(club):
    uid, m = club["members"][1]
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        m.q("insert into public.user_badges (user_id, badge_id) values (%s, 'vip')", (uid,), fetch=False)
    with pytest.raises(psycopg.errors.RaiseException, match="administrateurs"):
        m.q("select public.award_badge('membre1', 'vip')")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        m.q("select public.grant_auto_badges()")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        m.q("select public._award(%s, 'vip')", (uid,))


def test_admin_awards_and_revokes_supporter(club):
    f = club["founder"]
    uid, m = club["members"][2]
    f.q("select public.award_badge('MEMBRE2', 'supporter', 'premiers retours')")
    assert "supporter" in badges_of(m, uid)
    note = m.q("select data ->> 'note' from public.notifications where data ->> 'badge_id' = 'supporter'")
    assert note == [("premiers retours",)]
    with pytest.raises(psycopg.errors.RaiseException, match="déjà"):
        f.q("select public.award_badge('membre2', 'supporter')")
    f.q("select public.revoke_badge('membre2', 'supporter')")
    assert "supporter" not in badges_of(m, uid)


def test_prediction_achievements_are_immediate(club):
    uid, m = club["members"][3]
    m.q("insert into public.predictions (ticker, period, metrics) values ('NVDA', 'Q3 FY2027', %s)",
        (json.dumps({"revenue": {"value": 110}}),), fetch=False)
    assert "premier_tir" in badges_of(m, uid)
    assert "raisonnement" not in badges_of(m, uid) and "multi_valeurs" not in badges_of(m, uid)
    m.q("insert into public.predictions (ticker, period, metrics, note) values ('WMT', 'Q3 FY2027', %s, %s)",
        (json.dumps({"revenue": {"value": 186}}), "x" * 240), fetch=False)
    assert {"raisonnement", "multi_valeurs"} <= badges_of(m, uid)
    titles = {r[0] for r in m.q("select title from public.notifications")}
    assert "Nouveau badge : Premier tir" in titles


def test_results_achievements_and_vip_via_pipeline(club):
    url = club["url"]
    svc = Client(url, None, role="service_role")
    scores = {4: {"rev_abs_err": 0.004, "rev_err": -0.004, "beat_crowd": True, "beat_analysts": True,
                  "interval_n": 1, "interval_hit": 1, "brier_n": 2, "brier_sum": 0.1},
              5: {"rev_abs_err": 0.03, "rev_err": 0.03, "beat_crowd": False}}
    for i, sc in scores.items():
        uid, _ = club["members"][i]
        for k in range(3):
            per = f"Q{k + 1} FY2026"
            _su(url, "insert into public.periods (ticker, period, deadline) values ('NVDA', %s, now() + interval '1 day') "
                     "on conflict do nothing", (per,))
            pid = uuid.uuid4()
            _su(url, "insert into public.predictions (id, user_id, ticker, period, created_at, updated_at) "
                     "values (%s, %s, 'NVDA', %s, now(), now())", (pid, uid, per))
            svc.q("insert into public.prediction_results (prediction_id, user_id, ticker, period, status, score) "
                  "values (%s, %s, 'NVDA', %s, 'resolved', %s)", (pid, uid, per, json.dumps(sc)), fetch=False)
    _su(url, "update public.periods set deadline = now() - interval '1 day' where period like '%%FY2026'")
    n = svc.q("select public.grant_auto_badges()")[0][0]
    assert n >= 4
    good = badges_of(club["founder"], club["members"][4][0])
    assert {"dans_le_mille", "bat_la_foule", "bat_wall_street"} <= good
    other = badges_of(club["founder"], club["members"][5][0])
    assert "dans_le_mille" not in other
    assert "vip" not in good | other                                  # only 2 ranked: no podium yet
    assert svc.q("select public.grant_auto_badges()")[0][0] == 0     # idempotent: no duplicate notification


def test_vip_podium_needs_six_ranked_members(club):
    url = club["url"]
    svc = Client(url, None, role="service_role")
    for i, err in zip(range(6, 10), (0.002, 0.05, 0.06, 0.07)):     # 4 more ranked -> 6 in total
        uid, _ = club["members"][i]
        for k in range(3):
            pid = uuid.uuid4()
            per = f"Q{k + 1} FY2026"
            _su(url, "update public.periods set deadline = now() + interval '1 day' where period = %s", (per,))
            _su(url, "insert into public.predictions (id, user_id, ticker, period) values (%s, %s, 'NVDA', %s)", (pid, uid, per))
            _su(url, "update public.periods set deadline = now() - interval '1 day' where period = %s", (per,))
            svc.q("insert into public.prediction_results (prediction_id, user_id, ticker, period, status, score) "
                  "values (%s, %s, 'NVDA', %s, 'resolved', %s)", (pid, uid, per, json.dumps({"rev_abs_err": err})), fetch=False)
    svc.q("select public.grant_auto_badges()")
    vips = {r[0] for r in _su(url, "select p.username from public.user_badges b join public.profiles p on p.id = b.user_id "
                                   "where badge_id = 'vip'")}
    assert vips == {"membre6", "membre4", "membre5"}                 # errors 0.2 %, 0.4 %, 3 %
