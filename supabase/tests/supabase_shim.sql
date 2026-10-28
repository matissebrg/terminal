-- Minimal emulation of what Supabase provides, for local tests only (never applied in production):
-- roles, auth schema, auth.uid()/auth.role() reading the JWT claims GUC, default privileges.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select current_setting('request.jwt.claims', true)::jsonb ->> 'role'
$$;
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant select on auth.users to service_role;

-- Projects created since 30 May 2026 no longer grant anything on new public tables to the API roles
-- (https://supabase.com/changelog/45329). Emulate that strict default, and also withhold the implicit
-- EXECUTE on new functions, so the migration must grant every privilege it relies on explicitly.
alter default privileges in schema public revoke execute on functions from public;
