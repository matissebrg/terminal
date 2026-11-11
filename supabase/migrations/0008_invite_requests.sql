-- Demandes d'invitation déposées depuis la page d'accueil publique (visiteurs sans compte).
-- L'adresse e-mail est une donnée personnelle : la table n'est lisible par personne directement,
-- seuls les administrateurs passent par les fonctions ci-dessous, et une demande peut être supprimée.

create table if not exists public.invite_requests (
  id bigint generated always as identity primary key,
  email text not null,
  note text,
  lang text,
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  invite_code text,
  constraint invite_requests_email_len check (char_length(email) between 6 and 254),
  constraint invite_requests_note_len check (note is null or char_length(note) <= 500)
);
create unique index if not exists invite_requests_email_key on public.invite_requests (lower(email));
alter table public.invite_requests enable row level security;   -- aucune politique : accès direct impossible
revoke all on public.invite_requests from anon, authenticated;

-- Déposer une demande. Appelable sans compte, donc : validation, longueurs bornées, plafond quotidien global,
-- et la même réponse que l'adresse soit nouvelle ou déjà connue (rien à apprendre sur qui a demandé).
create or replace function public.request_invite(p_email text, p_note text default null, p_lang text default null)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(coalesce(p_email, '')));
begin
  if char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' then
    raise exception 'Adresse e-mail invalide.';
  end if;
  if (select count(*) from public.invite_requests where created_at > now() - interval '1 day') >= 50 then
    raise exception 'Trop de demandes aujourd''hui. Réessaie demain.';
  end if;
  insert into public.invite_requests (email, note, lang)
  values (v_email, nullif(left(trim(coalesce(p_note, '')), 500), ''), nullif(left(coalesce(p_lang, ''), 5), ''))
  on conflict (lower(email)) do nothing;
  return true;
end $$;
revoke all on function public.request_invite(text, text, text) from public;
grant execute on function public.request_invite(text, text, text) to anon, authenticated;

create or replace function public.admin_invite_requests()
returns table (id bigint, email text, note text, lang text, created_at timestamptz, handled_at timestamptz, invite_code text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs.'; end if;
  return query select r.id, r.email, r.note, r.lang, r.created_at, r.handled_at, r.invite_code
               from public.invite_requests r order by r.handled_at is not null, r.created_at desc;
end $$;
revoke all on function public.admin_invite_requests() from public, anon;
grant execute on function public.admin_invite_requests() to authenticated;

-- Traiter une demande : crée un code d'invitation à usage unique (30 jours) et le rattache à la demande.
-- L'envoi du code reste manuel (pas de SMTP) : l'administrateur l'écrit lui-même au demandeur.
create or replace function public.accept_invite_request(p_id bigint) returns text
language plpgsql security definer set search_path = public as $$
declare v public.invite_requests; v_code text;
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs.'; end if;
  select * into v from public.invite_requests where id = p_id for update;
  if not found then raise exception 'Demande introuvable.'; end if;
  if v.invite_code is not null then return v.invite_code; end if;
  v_code := (public.create_invite(1, 30, 'demande ' || v.email)).code;
  update public.invite_requests set handled_at = now(), invite_code = v_code where id = p_id;
  return v_code;
end $$;
revoke all on function public.accept_invite_request(bigint) from public, anon;
grant execute on function public.accept_invite_request(bigint) to authenticated;

create or replace function public.delete_invite_request(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs.'; end if;
  delete from public.invite_requests where id = p_id;
end $$;
revoke all on function public.delete_invite_request(bigint) from public, anon;
grant execute on function public.delete_invite_request(bigint) to authenticated;
