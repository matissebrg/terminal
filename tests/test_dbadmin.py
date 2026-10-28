"""Secrets pasted into GitHub: cleaned up, described without ever being printed."""
from pipeline import community, dbadmin

KEY = "sb_secret_AbCdEf123456_-xyz"
URL = "postgresql://postgres.abcdefghij:S3cretPass99@aws-0-eu-west-1.pooler.supabase.com:5432/postgres"


def test_clean_key_removes_whitespace_and_labels():
    assert community.clean_key(f"  {KEY}\n") == KEY
    assert community.clean_key(f"sb_secret_AbCdEf\n123456_-xyz") == KEY          # line break inside
    assert community.clean_key(f"backend_api\t{KEY}") == KEY                     # label copied with it
    assert community.clean_key(f'"{KEY}"') == KEY


def test_describe_key_never_prints_the_value():
    d = community.describe_key(f"backend_api {KEY}\n")
    assert KEY not in d and "AbCdEf" not in d
    assert d.startswith(f"sb_secret_, {len(KEY)} caractères")
    assert "retirés" in d
    assert "PUBLIQUE" in community.describe_key("sb_publishable_abc")
    assert "masqués" in community.describe_key("sb_secret_8I4Se••••••")


def test_describe_url_and_safe(monkeypatch):
    monkeypatch.setenv("SUPABASE_DB_URL", URL + "\n")
    d = dbadmin.describe_url()
    assert "S3cretPass99" not in d and "pooler" in d and "espaces" in d
    assert dbadmin.safe(f'connection failed for {URL} password=S3cretPass99 "S3cretPass99"').count("S3cretPass99") == 0
    monkeypatch.setenv("SUPABASE_DB_URL", URL.replace("S3cretPass99", "[YOUR-PASSWORD]"))
    assert "[YOUR-PASSWORD]" in dbadmin.describe_url() and "crochets" in dbadmin.describe_url()
    monkeypatch.setenv("SUPABASE_DB_URL", URL.replace("S3cretPass99", "a@b#c"))
    d = dbadmin.describe_url()
    assert "a@b#c" not in d and ("plusieurs @" in d or "illisible" in d)


def test_direct_url_switched_to_session_pooler(monkeypatch):
    monkeypatch.setenv("SUPABASE_DB_URL", "postgresql://postgres:S3cretPass99@db.abcdefghij.supabase.co:5432/postgres")
    assert dbadmin._url() == "postgresql://postgres.abcdefghij:S3cretPass99@aws-0-eu-west-1.pooler.supabase.com:5432/postgres"
    d = dbadmin.describe_url()
    assert "convertie" in d and "S3cretPass99" not in d and "Session pooler (GitHub" not in d
    monkeypatch.setenv("SUPABASE_DB_URL", URL)                       # pooler URL left untouched
    assert dbadmin._url() == URL
