"""Database administration for the members' space (Supabase), run by GitHub Actions.

    python -m pipeline.dbadmin migrate        # apply supabase/migrations/*.sql not yet applied
    python -m pipeline.dbadmin founder        # record ARCHER_ADMIN_EMAIL as the founder's e-mail
    python -m pipeline.dbadmin check          # shape of the secrets + connection test (never prints them)

Connection: SUPABASE_DB_URL (use the *Session pooler* URI: GitHub runners have no IPv6).
Each migration runs in its own transaction and is recorded with its SHA-256; a migration file that
changes after being applied is refused (write a new file instead).
"""
from __future__ import annotations

import hashlib
import os
import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "supabase" / "migrations"


def _url() -> str:
    """SUPABASE_DB_URL without stray whitespace, quotes or backticks from copy-paste."""
    raw = os.environ.get("SUPABASE_DB_URL", "")
    return "".join(raw.split()).strip("\"'`")


def _secrets() -> list[str]:
    out = [os.environ.get("SUPABASE_DB_URL", ""), _url(), os.environ.get("SUPABASE_SERVICE_KEY", "")]
    try:
        pw = urlsplit(_url()).password
        if pw:
            out += [pw, unquote(pw)]
    except ValueError:
        pass
    return [x for x in out if x and len(x) >= 4]


def safe(msg) -> str:
    """Error text with every secret removed: this output is published with the site."""
    text = str(msg)
    for sec in sorted(_secrets(), key=len, reverse=True):
        text = text.replace(sec, "***")
    text = re.sub(r"://[^@\s/]*@", "://***@", text)
    return re.sub(r"password=\S+", "password=***", text)


def describe_url() -> str:
    raw, url = os.environ.get("SUPABASE_DB_URL", ""), _url()
    if not url:
        return "absent"
    if "[YOUR-PASSWORD]" in url.upper() or re.search(r":\[[^\]]*\]@", url):
        return "le texte [YOUR-PASSWORD] est encore là : remplace-le (crochets compris) par le mot de passe de la base"
    notes = []
    try:
        u = urlsplit(url)
        notes.append(f"schéma {u.scheme or '?'}")
        notes.append(f"hôte {u.hostname or '?'}:{u.port or '?'}")
        notes.append(f"utilisateur {u.username or '?'}")
        pw = u.password
    except ValueError as exc:
        return f"illisible ({safe(exc)})"
    if not pw:
        notes.append("PAS de mot de passe")
    else:
        if "[" in pw or "YOUR-PASSWORD" in pw.upper():
            notes.append("le texte [YOUR-PASSWORD] est encore là : remplace-le (crochets compris) par le mot de passe")
        special = sorted(set(c for c in unquote(pw) if not c.isalnum()))
        if special and "%" not in pw:
            notes.append(f"mot de passe avec {len(special)} caractère(s) spécial(aux) non encodé(s)")
    if url.count("@") > 1:
        notes.append("plusieurs @ (un @ dans le mot de passe doit s'écrire %40)")
    if raw != url:
        notes.append("espaces / guillemets parasites retirés")
    if "pooler.supabase.com" not in url:
        notes.append("ce n'est pas l'adresse du Session pooler (GitHub n'a pas d'IPv6)")
    return ", ".join(notes)


def _connect():
    import psycopg
    url = _url()
    if not url:
        print("SUPABASE_DB_URL absent : rien à faire.")
        sys.exit(0)
    try:
        return psycopg.connect(url, autocommit=True, connect_timeout=20)
    except Exception as exc:  # noqa: BLE001
        print(f"::error::connexion à la base impossible : {safe(exc)}")
        print(f"SUPABASE_DB_URL : {describe_url()}")
        sys.exit(1)


def check() -> int:
    from .community import describe_key
    print("SUPABASE_DB_URL      :", describe_url())
    print("SUPABASE_SERVICE_KEY :", describe_key(os.environ.get("SUPABASE_SERVICE_KEY", "")) if os.environ.get("SUPABASE_SERVICE_KEY") else "absent")
    print("ARCHER_ADMIN_EMAIL   :", "présent" if os.environ.get("ARCHER_ADMIN_EMAIL", "").strip() else "absent")
    if _url():
        with _connect() as c:
            v = c.execute("select current_user, version()").fetchone()
            print("connexion OK :", v[0], "·", v[1].split(",")[0])
    return 0


def migrate() -> int:
    with _connect() as c:
        c.execute("""create table if not exists public.archer_migrations (
                       filename text primary key, sha256 text not null, applied_at timestamptz not null default now())""")
        c.execute("alter table public.archer_migrations enable row level security")
        c.execute("revoke all on public.archer_migrations from anon, authenticated")
        done = {r[0]: r[1] for r in c.execute("select filename, sha256 from public.archer_migrations")}
        applied = 0
        for f in sorted(MIGRATIONS.glob("*.sql")):
            sha = hashlib.sha256(f.read_bytes()).hexdigest()
            if f.name in done:
                if done[f.name] != sha:
                    print(f"::error::{f.name} a été modifié après application : crée une nouvelle migration.")
                    return 1
                continue
            print(f"application de {f.name}")
            try:
                with c.transaction():
                    c.execute(f.read_text())
                    c.execute("insert into public.archer_migrations (filename, sha256) values (%s, %s)", (f.name, sha))
            except Exception as exc:  # noqa: BLE001
                diag = getattr(exc, "diag", None)
                where = f" (contexte : {safe(diag.context)})" if diag is not None and diag.context else ""
                print(f"::error::{f.name} : {safe(exc)}{where}")
                return 1
            applied += 1
        print(f"{applied} migration(s) appliquée(s), {len(done)} déjà en place.")
    return 0


def founder() -> int:
    email = os.environ.get("ARCHER_ADMIN_EMAIL", "").strip()
    if not email:
        print("ARCHER_ADMIN_EMAIL absent : le fondateur devra recevoir un code d'invitation.")
        return 0
    with _connect() as c:
        c.execute("""insert into public.app_config (key, value) values ('admin_email', %s)
                     on conflict (key) do update set value = excluded.value""", (email,))
    print("E-mail du fondateur enregistré.")   # never printed: public logs
    return 0


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    sys.exit({"migrate": migrate, "founder": founder, "check": check}.get(cmd, lambda: (print(__doc__), 2)[1])())
