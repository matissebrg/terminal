"""Database administration for the members' space (Supabase), run by GitHub Actions.

    python -m pipeline.dbadmin migrate        # apply supabase/migrations/*.sql not yet applied
    python -m pipeline.dbadmin founder        # record ARCHER_ADMIN_EMAIL as the founder's e-mail

Connection: SUPABASE_DB_URL (use the *Session pooler* URI: GitHub runners have no IPv6).
Each migration runs in its own transaction and is recorded with its SHA-256; a migration file that
changes after being applied is refused (write a new file instead).
"""
from __future__ import annotations

import hashlib
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "supabase" / "migrations"


def _connect():
    import psycopg
    url = os.environ.get("SUPABASE_DB_URL", "").strip()
    if not url:
        print("SUPABASE_DB_URL absent : rien à faire.")
        sys.exit(0)
    return psycopg.connect(url, autocommit=True)


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
            with c.transaction():
                c.execute(f.read_text())
                c.execute("insert into public.archer_migrations (filename, sha256) values (%s, %s)", (f.name, sha))
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
    sys.exit({"migrate": migrate, "founder": founder}.get(cmd, lambda: (print(__doc__), 2)[1])())
