-- ============================================================================
-- Archer Terminal · badges et notifications
--
--  * Statuts (images, rang = nombre de barres) : Supporter (1) < Members (2) < Founders (3) < VIP (4)
--      - Members   : automatique à l'adhésion
--      - Founders  : le fondateur et les 10 premiers membres de la bêta (automatique)
--      - Supporter : attribué par un administrateur (retours, bugs, idées, contributions)
--      - VIP       : top 3 du classement des prévisionnistes (au moins 3 prédictions vérifiées,
--                    au moins 6 membres classés), automatique, ou attribué par un administrateur
--  * Succès : débloqués automatiquement par l'activité (prédictions, résultats, portefeuilles).
--  * Chaque badge obtenu crée une notification pour son titulaire.
--  Personne ne peut s'attribuer un badge : seules les fonctions ci-dessous écrivent.
-- ============================================================================

create table if not exists public.badges (
  id text primary key,
  name text not null,
  description text not null,
  kind text not null check (kind in ('tier', 'achievement')),
  rank int not null default 0,          -- statuts : nombre de barres ; succès : 0
  image text,                           -- statuts : image dans docs/assets/badges/
  icon text,                            -- succès : nom de l'icône dessinée par le site
  auto boolean not null default true,   -- false = attribué à la main par un administrateur
  sort int not null default 0
);
alter table public.badges enable row level security;

insert into public.badges (id, name, description, kind, rank, image, icon, auto, sort) values
  ('supporter', 'Supporter', 'A aidé à construire Archer : retours, bugs, idées. Attribué par un administrateur.', 'tier', 1, 'supporter.png', null, false, 10),
  ('members', 'Members', 'Membre de la bêta Archer Terminal.', 'tier', 2, 'members.png', null, true, 20),
  ('founders', 'Founders', 'Fondateur ou l''un des 10 premiers membres de la bêta.', 'tier', 3, 'founders.png', null, true, 30),
  ('vip', 'VIP', 'Top 3 du classement des prévisionnistes (au moins 3 prédictions vérifiées, 6 membres classés), ou invité d''honneur.', 'tier', 4, 'vip.png', null, true, 40),
  ('premier_tir', 'Premier tir', 'Enregistrer sa première prédiction.', 'achievement', 0, null, 'target', true, 100),
  ('raisonnement', 'Raisonnement', 'Une prédiction accompagnée d''un raisonnement d''au moins 200 caractères.', 'achievement', 0, null, 'quill', true, 110),
  ('multi_valeurs', 'Multi-valeurs', 'Des prédictions sur au moins deux valeurs différentes.', 'achievement', 0, null, 'grid', true, 120),
  ('premier_ordre', 'Premier ordre', 'Un premier ordre exécuté dans un portefeuille fictif.', 'achievement', 0, null, 'bolt', true, 130),
  ('dans_le_mille', 'Dans le mille', 'Chiffre d''affaires prévu à moins de 1 % du chiffre publié.', 'achievement', 0, null, 'bullseye', true, 200),
  ('bat_la_foule', 'Mieux que la foule', 'Plus précis que la médiane des autres membres sur le chiffre d''affaires.', 'achievement', 0, null, 'crowd', true, 210),
  ('bat_wall_street', 'Mieux que Wall Street', 'Plus précis que le consensus des analystes sur le chiffre d''affaires.', 'achievement', 0, null, 'bank', true, 220),
  ('regulier', 'Régulier', 'Quatre prédictions vérifiées : une année complète de résultats.', 'achievement', 0, null, 'calendar', true, 230),
  ('bien_calibre', 'Bien calibré', 'Au moins 5 intervalles à 80 % notés, avec un taux de réussite entre 70 % et 90 %.', 'achievement', 0, null, 'scale', true, 240),
  ('oracle', 'Oracle', 'Score de Brier de 0,15 ou mieux sur au moins 5 questions oui / non.', 'achievement', 0, null, 'eye', true, 250),
  ('gerant_10', 'Gérant +10 %', 'Un portefeuille fictif en hausse d''au moins 10 %.', 'achievement', 0, null, 'chart', true, 260)
on conflict (id) do update set name = excluded.name, description = excluded.description, kind = excluded.kind,
  rank = excluded.rank, image = excluded.image, icon = excluded.icon, auto = excluded.auto, sort = excluded.sort;

create table if not exists public.user_badges (
  user_id uuid not null references public.profiles (id) on delete cascade,
  badge_id text not null references public.badges (id) on delete cascade,
  awarded_at timestamptz not null default now(),
  awarded_by uuid references public.profiles (id) on delete set null,   -- null = automatique
  note text check (note is null or char_length(note) <= 300),
  primary key (user_id, badge_id)
);
alter table public.user_badges enable row level security;

create table if not exists public.notifications (
  id bigserial primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;

-- ---------------------------------------------------------------- attribution (interne)
create or replace function public._award(p_user uuid, p_badge text, p_by uuid default null, p_note text default null)
returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.user_badges (user_id, badge_id, awarded_by, note)
  values (p_user, p_badge, p_by, p_note)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public._award(uuid, text, uuid, text) from public, anon, authenticated;

-- chaque badge obtenu -> une notification pour son titulaire
create or replace function public.user_badges_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare b public.badges;
begin
  select * into b from public.badges where id = new.badge_id;
  insert into public.notifications (user_id, kind, title, body, link, data)
  values (new.user_id, 'badge', 'Nouveau badge : ' || b.name, b.description, '#/compte',
          jsonb_build_object('badge_id', b.id, 'kind', b.kind, 'image', b.image, 'icon', b.icon, 'note', new.note));
  return null;
end $$;
drop trigger if exists user_badges_notify on public.user_badges;
create trigger user_badges_notify after insert on public.user_badges
for each row execute function public.user_badges_notify();

-- adhésion -> Members ; fondateur et 10 premiers membres -> Founders
create or replace function public.profiles_badges() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._award(new.id, 'members');
  if new.is_admin or (select count(*) from public.profiles where created_at <= new.created_at) <= 10 then
    perform public._award(new.id, 'founders');
  end if;
  return null;
end $$;
drop trigger if exists profiles_badges on public.profiles;
create trigger profiles_badges after insert on public.profiles
for each row execute function public.profiles_badges();

-- succès immédiats liés aux prédictions
create or replace function public.predictions_badges() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._award(new.user_id, 'premier_tir');
  if char_length(coalesce(new.note, '')) >= 200 then
    perform public._award(new.user_id, 'raisonnement');
  end if;
  if (select count(distinct ticker) from public.predictions where user_id = new.user_id) >= 2 then
    perform public._award(new.user_id, 'multi_valeurs');
  end if;
  return null;
end $$;
drop trigger if exists predictions_badges on public.predictions;
create trigger predictions_badges after insert or update on public.predictions
for each row execute function public.predictions_badges();

-- premier ordre exécuté (les exécutions sont faites par le pipeline)
create or replace function public.trades_badges() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._award(new.user_id, 'premier_ordre');
  return null;
end $$;
drop trigger if exists trades_badges on public.trades;
create trigger trades_badges after insert on public.trades
for each row execute function public.trades_badges();

-- succès calculés après la vérification des résultats (appelé par le pipeline, rôle service)
create or replace function public.grant_auto_badges() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  for r in
    select user_id, 'dans_le_mille' as b from public.prediction_results
      where status <> 'late' and (score ->> 'rev_abs_err')::numeric < 0.01
    union select user_id, 'bat_la_foule' from public.prediction_results
      where status <> 'late' and (score ->> 'beat_crowd')::boolean
    union select user_id, 'bat_wall_street' from public.prediction_results
      where status <> 'late' and (score ->> 'beat_analysts')::boolean
    union select user_id, 'regulier' from public.prediction_results
      where status <> 'late' group by user_id having count(*) >= 4
    union select user_id, 'bien_calibre' from public.prediction_results
      where status <> 'late' group by user_id
      having sum(coalesce((score ->> 'interval_n')::int, 0)) >= 5
         and sum(coalesce((score ->> 'interval_hit')::int, 0))::numeric
             / sum(coalesce((score ->> 'interval_n')::int, 0)) between 0.70 and 0.90
    union select user_id, 'oracle' from public.prediction_results
      where status <> 'late' group by user_id
      having sum(coalesce((score ->> 'brier_n')::int, 0)) >= 5
         and sum(coalesce((score ->> 'brier_sum')::numeric, 0)) / sum(coalesce((score ->> 'brier_n')::int, 0)) <= 0.15
    union select pf.user_id, 'gerant_10' from public.portfolio_values v
      join public.portfolios pf on pf.id = v.portfolio_id
      where v.value >= pf.initial_cash * 1.10
    union select user_id, 'vip' from (
      select r2.user_id, avg((r2.score ->> 'rev_abs_err')::numeric) as mae, count(*) over () as n_ranked
      from public.prediction_results r2 join public.profiles p on p.id = r2.user_id
      where r2.status <> 'late' and r2.score ? 'rev_abs_err' and p.show_on_leaderboard
      group by r2.user_id having count(*) >= 3
      order by mae limit 3) top
      where n_ranked >= 6          -- un podium n'a de sens qu'avec assez de concurrents
  loop
    if public._award(r.user_id, r.b) then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- fonctions appelables par le site
create or replace function public.award_badge(p_username text, p_badge text, p_note text default null)
returns public.user_badges
language plpgsql security definer set search_path = public as $$
declare v_user uuid; v public.user_badges;
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs.'; end if;
  select id into v_user from public.profiles where lower(username) = lower(trim(p_username));
  if v_user is null then raise exception 'Membre introuvable : %', p_username; end if;
  if not exists (select 1 from public.badges where id = p_badge) then raise exception 'Badge inconnu : %', p_badge; end if;
  if not public._award(v_user, p_badge, auth.uid(), nullif(trim(p_note), '')) then
    raise exception 'Ce membre a déjà ce badge.';
  end if;
  select * into v from public.user_badges where user_id = v_user and badge_id = p_badge;
  return v;
end $$;

create or replace function public.revoke_badge(p_username text, p_badge text) returns void
language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs.'; end if;
  select id into v_user from public.profiles where lower(username) = lower(trim(p_username));
  delete from public.user_badges where user_id = v_user and badge_id = p_badge;
  if not found then raise exception 'Ce membre n''a pas ce badge.'; end if;
end $$;

create or replace function public.mark_notifications_read(p_ids bigint[] default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- RLS
drop policy if exists badges_read on public.badges;
create policy badges_read on public.badges for select to authenticated using (true);
drop policy if exists user_badges_read on public.user_badges;
create policy user_badges_read on public.user_badges for select to authenticated
  using (user_id = (select auth.uid()) or public.is_member());
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- droits (explicites, cf. 0001)
grant select, insert, update, delete on public.badges, public.user_badges, public.notifications to service_role;
grant usage, select on all sequences in schema public to service_role;
grant select on public.badges, public.user_badges, public.notifications to authenticated;
revoke all on public.badges, public.user_badges, public.notifications from anon;

revoke all on function public.grant_auto_badges() from public, anon, authenticated;
grant execute on function public.grant_auto_badges() to service_role;
revoke all on function public.award_badge(text, text, text) from public, anon;
revoke all on function public.revoke_badge(text, text) from public, anon;
revoke all on function public.mark_notifications_read(bigint[]) from public, anon;
grant execute on function public.award_badge(text, text, text) to authenticated;
grant execute on function public.revoke_badge(text, text) to authenticated;
grant execute on function public.mark_notifications_read(bigint[]) to authenticated;

-- ---------------------------------------------------------------- membres déjà inscrits
select public._award(id, 'members') from public.profiles;
select public._award(id, 'founders') from public.profiles
 where is_admin or id in (select id from public.profiles order by created_at limit 10);
select public._award(user_id, 'premier_tir') from (select distinct user_id from public.predictions) x;
