"""Catalyst predictions (supabase/migrations/0006_catalysts.sql) on a real PostgreSQL: published by the
pipeline, predicted by members before the deadline, hidden from others until then, scored with Brier
against the historical base rate."""
from datetime import datetime, timedelta, timezone

import pytest

from pipeline import community
from tests.test_community import PgSupa
from tests.test_db import ADMIN_URL, Client, _new_user, _su, psycopg  # noqa: F401
from tests.test_db import dburl  # noqa: F401

pytestmark = pytest.mark.skipif(not ADMIN_URL, reason="TEST_DATABASE_URL non défini")
EMPTY = dict(fins={}, filings={}, bars={}, guidance={}, consensus={}, next_earnings={}, names={})


def cat(id_, date, outcome=None, p_base=0.936):
    return {"ticker": "BBIO", "id": id_, "asset": "BBP-418", "kind": "pdufa", "title": "PDUFA", "date": date,
            "p_base": p_base, "p_model": p_base, "p_market": 1.2, "confirmed": True, "outcome": outcome}


@pytest.fixture(scope="module")
def club(dburl):  # noqa: F811
    f_id = _new_user(dburl, "founder@archer.test")
    f = Client(dburl, f_id)
    f.q("select public.join_with_code('', 'founder')")
    code = f.q("select (public.create_invite(10, 30, 'b')).code")[0][0]
    a_id, b_id = _new_user(dburl, "a@x.test"), _new_user(dburl, "b@x.test")
    a, b = Client(dburl, a_id), Client(dburl, b_id)
    a.q("select public.join_with_code(%s, 'alice')", (code,))
    b.q("select public.join_with_code(%s, 'bob')", (code,))
    future = (datetime.now(timezone.utc) + timedelta(days=20)).date().isoformat()
    community.sync(PgSupa(dburl), catalysts=[cat("open", future)], **EMPTY)
    return {"url": dburl, "a": a, "b": b, "a_id": a_id, "b_id": b_id, "future": future}


def test_predict_hidden_until_own_then_crowd(club):
    a, b = club["a"], club["b"]
    assert a.q("select id, deadline > now() from public.catalysts") == [("BBIO:open", True)]
    with pytest.raises(psycopg.errors.RaiseException, match="1 %"):
        a.q("select public.predict_catalyst('BBIO:open', 1.0)")
    a.q("select public.predict_catalyst('BBIO:open', 0.80, 'Données de phase 2 solides')")
    a.q("select public.predict_catalyst('BBIO:open', 0.85)")                 # update before the deadline
    assert float(a.q("select p from public.catalyst_predictions")[0][0]) == pytest.approx(0.85)
    # bob cannot see alice's number, nor the crowd mean, before giving his own
    assert b.q("select count(*) from public.catalyst_predictions")[0][0] == 0
    n, mean, med, vis = b.q("select * from public.catalyst_crowd('BBIO:open')")[0]
    assert (n, mean, vis) == (1, None, False)
    b.q("select public.predict_catalyst('BBIO:open', 0.55)")
    n, mean, med, vis = b.q("select * from public.catalyst_crowd('BBIO:open')")[0]
    assert n == 2 and vis and float(mean) == pytest.approx(0.70)
    assert b.q("select count(*) from public.catalyst_predictions")[0][0] == 1  # still only his own row
    assert "premier_pari_clinique" in {r[0] for r in a.q("select badge_id from public.user_badges")}
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        a.q("insert into public.catalyst_predictions (user_id, catalyst_id, p) values (%s, 'BBIO:open', 0.5)",
            (club["b_id"],), fetch=False)


def test_locked_after_deadline_and_scored(club):
    url, a, b = club["url"], club["a"], club["b"]
    _su(url, "update public.catalysts set deadline = now() - interval '1 minute' where id = 'BBIO:open'")
    with pytest.raises(psycopg.errors.RaiseException, match="closes"):
        a.q("select public.predict_catalyst('BBIO:open', 0.9)")
    assert b.q("select count(*) from public.catalyst_predictions")[0][0] == 2   # everyone's visible now
    # the pipeline publishes the outcome: a failure the base rate gave at 94 %
    community.sync(PgSupa(url), catalysts=[cat("open", club["future"], outcome="failure")], **EMPTY)
    rows = {r[0]: r for r in a.q("select * from public.catalyst_scores()")}
    assert float(rows["bob"][2]) == pytest.approx(0.55 ** 2)
    assert float(rows["alice"][2]) == pytest.approx(0.85 ** 2)
    assert float(rows["bob"][3]) == pytest.approx(0.936 ** 2, abs=1e-4) and float(rows["bob"][4]) > 0   # beat the base rate
    assert "contrarien_clinique" not in {r[0] for r in b.q("select badge_id from public.user_badges")}  # 55 % > 35 %


def test_contrarian_badge(club):
    url, a = club["url"], club["a"]
    future = (datetime.now(timezone.utc) + timedelta(days=5)).date().isoformat()
    community.sync(PgSupa(url), catalysts=[cat("p3", future, p_base=0.66)], **EMPTY)
    a.q("select public.predict_catalyst('BBIO:p3', 0.20)")
    community.sync(PgSupa(url), catalysts=[cat("p3", future, outcome="failure", p_base=0.66)], **EMPTY)
    assert "contrarien_clinique" in {r[0] for r in a.q("select badge_id from public.user_badges")}
    assert a.q("select title from public.notifications where title like '%%Contrarien%%'")
