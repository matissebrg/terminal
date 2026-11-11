"""Invitation requests from the public landing page (supabase/migrations/0008_invite_requests.sql) on a real
PostgreSQL: anyone can ask, nobody can read the list except administrators, duplicates and junk are refused."""
import pytest

from tests.test_db import ADMIN_URL, Client, _new_user, _su, psycopg  # noqa: F401
from tests.test_db import dburl  # noqa: F401

pytestmark = pytest.mark.skipif(not ADMIN_URL, reason="TEST_DATABASE_URL non défini")


@pytest.fixture(scope="module")
def world(dburl):  # noqa: F811
    f = Client(dburl, _new_user(dburl, "founder@archer.test"))
    f.q("select public.join_with_code('', 'founder')")
    code = f.q("select (public.create_invite(5, 30, 'x')).code")[0][0]
    m = Client(dburl, _new_user(dburl, "member@x.test"))
    m.q("select public.join_with_code(%s, 'member')", (code,))
    return {"url": dburl, "admin": f, "member": m, "anon": Client(dburl, None, role="anon")}


def test_anyone_can_ask_nobody_can_read(world):
    anon, member, admin = world["anon"], world["member"], world["admin"]
    assert anon.q("select public.request_invite('  New.Person@Example.com ', 'je suis les biotechs', 'fr')") == [(True,)]
    assert anon.q("select public.request_invite('new.person@example.com')") == [(True,)]      # duplicate: same answer, no new row
    for bad in ("", "pas-une-adresse", "a@b", "deux mots@x.fr", "x" * 250 + "@a.fr"):
        with pytest.raises(psycopg.errors.RaiseException, match="invalide"):
            anon.q("select public.request_invite(%s)", (bad,))
    assert anon.q("select public.request_invite('long@x.fr', %s)", ("n" * 900,)) == [(True,)]
    for c in (anon, member):                                    # the table and the admin functions are closed
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            c.q("select * from public.invite_requests")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        anon.q("select * from public.admin_invite_requests()")
    with pytest.raises(psycopg.errors.RaiseException, match="administrateurs"):
        member.q("select * from public.admin_invite_requests()")
    rows = admin.q("select email, note, lang, handled_at, invite_code from public.admin_invite_requests() order by email")
    assert [r[0] for r in rows] == ["long@x.fr", "new.person@example.com"]
    assert rows[1][1:] == ("je suis les biotechs", "fr", None, None) and len(rows[0][1]) == 500


def test_accept_creates_one_code_and_delete_removes_the_address(world):
    admin, member, url = world["admin"], world["member"], world["url"]
    rid = admin.q("select id from public.admin_invite_requests() where email = 'new.person@example.com'")[0][0]
    with pytest.raises(psycopg.errors.RaiseException, match="administrateurs"):
        member.q("select public.accept_invite_request(%s)", (rid,))
    code = admin.q("select public.accept_invite_request(%s)", (rid,))[0][0]
    assert code.startswith("ARCHER-") and admin.q("select public.accept_invite_request(%s)", (rid,))[0][0] == code
    assert _su(url, "select max_uses, note from public.invite_codes where code = %s", (code,)) == [(1, "demande new.person@example.com")]
    newcomer = Client(url, _new_user(url, "new.person@example.com"))          # the code works
    newcomer.q("select public.join_with_code(%s, 'newcomer')", (code,))
    with pytest.raises(psycopg.errors.RaiseException, match="administrateurs"):
        member.q("select public.delete_invite_request(%s)", (rid,))
    admin.q("select public.delete_invite_request(%s)", (rid,))
    assert _su(url, "select count(*) from public.invite_requests where email = 'new.person@example.com'") == [(0,)]


def test_daily_cap(world):
    url, anon = world["url"], world["anon"]
    _su(url, "insert into public.invite_requests (email) select 'bulk' || g || '@x.fr' from generate_series(1, 50) g")
    with pytest.raises(psycopg.errors.RaiseException, match="Trop de demandes"):
        anon.q("select public.request_invite('one.more@x.fr')")
