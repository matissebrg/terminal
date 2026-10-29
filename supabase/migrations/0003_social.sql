-- ============================================================================
-- Archer Terminal · succès difficiles, titres, profils, liste des membres, messagerie
--
--  * Succès à 4 niveaux (1 bronze, 2 argent, 3 or, 4 platine). Les plus durs récompensent la
--    PRÉCISION et la CALIBRATION, jamais le volume, et exigent un nombre minimum de résultats
--    pour que la chance ne suffise pas.
--  * Titres : la plupart des badges donnent un titre ; chaque membre affiche celui qu'il veut,
--    parmi ceux qu'il a débloqués (vérifié par la base).
--  * Liste des membres avec e-mail et dernière connexion : administrateurs seulement.
--  * Messagerie privée entre membres : lisible par l'expéditeur et le destinataire uniquement
--    (pas de lecture par les administrateurs) ; blocage, limite d'envoi, signalement (seul le
--    message signalé est transmis aux administrateurs). Pas de chiffrement de bout en bout.
-- ============================================================================

-- ---------------------------------------------------------------- niveaux et titres
alter table public.badges add column if not exists level int not null default 1 check (level between 1 and 4);
alter table public.badges add column if not exists title text;

insert into public.badges (id, name, description, kind, rank, image, icon, auto, sort, level, title) values
  ('analyste_complet', 'Analyste complet', 'Une prédiction sur les 7 indicateurs, chacun avec son intervalle à 80 %.', 'achievement', 0, null, 'layers', true, 140, 1, null),
  ('diversifie', 'Diversifié', 'Un portefeuille fictif avec au moins 5 lignes en même temps.', 'achievement', 0, null, 'pie', true, 270, 2, 'Diversifié'),
  ('tireur_elite', 'Tireur d''élite', 'Trois prédictions vérifiées avec un CA à moins de 1 % du réel.', 'achievement', 0, null, 'crosshair', true, 300, 3, 'Tireur d''élite'),
  ('triple_couronne', 'Triple couronne', 'Sur une même publication, plus précis que le modèle naïf, les analystes et la communauté.', 'achievement', 0, null, 'crown', true, 310, 3, 'Triple couronne'),
  ('contrarian', 'Contrarian', 'Avoir parié contre le consensus (écart d''au moins 1 %) et eu raison sur une surprise d''au moins 2 %.', 'achievement', 0, null, 'swap', true, 320, 3, 'Contrarian'),
  ('marathonien', 'Marathonien', 'Huit prédictions vérifiées : deux années complètes de résultats.', 'achievement', 0, null, 'road', true, 330, 3, 'Marathonien'),
  ('generaliste', 'Généraliste', 'Des prédictions vérifiées sur au moins 5 valeurs différentes.', 'achievement', 0, null, 'globe', true, 340, 3, 'Généraliste'),
  ('gerant_25', 'Gérant +25 %', 'Un portefeuille fictif en hausse d''au moins 25 %.', 'achievement', 0, null, 'chart', true, 350, 3, 'Gérant confirmé'),
  ('alpha', 'Alpha', 'Un portefeuille qui bat le S&P 500 sur au moins 90 jours.', 'achievement', 0, null, 'alpha', true, 360, 3, 'Alpha'),
  ('chirurgien', 'Chirurgien', 'Chiffre d''affaires prévu à moins de 0,25 % du chiffre publié.', 'achievement', 0, null, 'scalpel', true, 400, 4, 'Chirurgien du chiffre'),
  ('fleau_wall_street', 'Fléau de Wall Street', 'Plus précis que le consensus des analystes sur 3 publications consécutives.', 'achievement', 0, null, 'flame', true, 410, 4, 'Fléau de Wall Street'),
  ('grand_oracle', 'Grand oracle', 'Score de Brier de 0,10 ou mieux sur au moins 20 questions oui / non.', 'achievement', 0, null, 'eye', true, 420, 4, 'Grand oracle'),
  ('maitre_calibration', 'Maître de la calibration', 'Au moins 20 intervalles à 80 % notés, avec un taux de réussite entre 75 % et 85 %.', 'achievement', 0, null, 'scale', true, 430, 4, 'Maître de la calibration'),
  ('gerant_50', 'Gérant +50 %', 'Un portefeuille fictif en hausse d''au moins 50 %.', 'achievement', 0, null, 'rocket', true, 440, 4, 'Gérant étoile'),
  ('numero_un', 'Numéro un', 'Première place du classement des prévisionnistes (au moins 3 prédictions vérifiées, 6 membres classés).', 'achievement', 0, null, 'trophy', true, 450, 4, 'Numéro un')
on conflict (id) do update set name = excluded.name, description = excluded.description, icon = excluded.icon,
  sort = excluded.sort, level = excluded.level, title = excluded.title;

update public.badges set level = v.level, title = v.title
from (values ('supporter', 1, 'Soutien'), ('members', 1, null), ('founders', 3, 'Fondateur'), ('vip', 4, 'VIP'),
             ('premier_tir', 1, null), ('raisonnement', 1, null), ('multi_valeurs', 1, null), ('premier_ordre', 1, null),
             ('dans_le_mille', 2, 'Dans le mille'), ('bat_la_foule', 2, 'Plus fin que la foule'),
             ('bat_wall_street', 2, 'Plus fort que Wall Street'), ('regulier', 2, 'Régulier'),
             ('gerant_10', 2, 'Gérant'), ('bien_calibre', 3, 'Bien calibré'), ('oracle', 3, 'Oracle')) as v(id, level, title)
where public.badges.id = v.id;

-- ---------------------------------------------------------------- titre affiché sur le profil
alter table public.profiles add column if not exists title_badge text references public.badges (id) on delete set null;

create or replace function public.profiles_title_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.title_badge is distinct from old.title_badge and new.title_badge is not null then
    if not exists (select 1 from public.user_badges ub join public.badges b on b.id = ub.badge_id
                   where ub.user_id = new.id and ub.badge_id = new.title_badge and b.title is not null) then
      raise exception 'Titre non débloqué.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists profiles_title_guard on public.profiles;
create trigger profiles_title_guard before update on public.profiles
for each row execute function public.profiles_title_guard();

-- badge retiré -> le titre correspondant disparaît du profil
create or replace function public.user_badges_untitle() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set title_badge = null where id = old.user_id and title_badge = old.badge_id;
  return null;
end $$;
drop trigger if exists user_badges_untitle on public.user_badges;
create trigger user_badges_untitle after delete on public.user_badges
for each row execute function public.user_badges_untitle();

grant update (username, show_on_leaderboard, title_badge) on public.profiles to authenticated;

-- ---------------------------------------------------------------- données pour « Alpha »
alter table public.portfolio_values add column if not exists spy_close numeric;

-- ---------------------------------------------------------------- succès immédiats (prédictions)
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
  if (select count(*) from jsonb_each(new.metrics) m
      where m.key in ('revenue', 'gross_margin', 'operating_income', 'operating_margin', 'net_income', 'eps_diluted', 'fcf')
        and jsonb_typeof(m.value -> 'low') = 'number' and jsonb_typeof(m.value -> 'high') = 'number') = 7 then
    perform public._award(new.user_id, 'analyste_complet');
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------- succès calculés par le pipeline
create or replace function public.grant_auto_badges() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  for r in
    with res as (
      select pr.*, (pr.score ->> 'rev_abs_err')::numeric as err, p.release_date
      from public.prediction_results pr
      left join public.periods p on p.ticker = pr.ticker and p.period = pr.period
      where pr.status <> 'late'),
    rev as (   -- the revenue line of each verified result
      select res.user_id, (m ->> 'value')::numeric as v, (m ->> 'actual')::numeric as a,
             (m -> 'benchmarks' ->> 'analysts')::numeric as c
      from res, jsonb_array_elements(coalesce(res.results -> 'metrics', '[]'::jsonb)) m
      where m ->> 'key' = 'revenue' and m ->> 'actual' is not null),
    streak as (
      select user_id, (score ->> 'beat_analysts')::boolean as w,
             lag((score ->> 'beat_analysts')::boolean, 1) over (partition by user_id order by release_date, ticker) as w1,
             lag((score ->> 'beat_analysts')::boolean, 2) over (partition by user_id order by release_date, ticker) as w2
      from res where score ? 'beat_analysts'),
    ranked as (
      select r2.user_id, avg((r2.score ->> 'rev_abs_err')::numeric) as mae, count(*) over () as n_ranked
      from res r2 join public.profiles p on p.id = r2.user_id
      where r2.score ? 'rev_abs_err' and p.show_on_leaderboard
      group by r2.user_id having count(*) >= 3),
    pos as (   -- open positions per portfolio
      select portfolio_id, ticker, sum(case when side = 'buy' then qty else -qty end) as q
      from public.trades group by portfolio_id, ticker),
    pv as (
      select v.portfolio_id, pf.user_id, pf.initial_cash, v.value, v.spy_close, v.date,
             first_value(v.value) over w as v0, first_value(v.spy_close) over w as s0,
             first_value(v.date) over w as d0
      from public.portfolio_values v join public.portfolios pf on pf.id = v.portfolio_id
      window w as (partition by v.portfolio_id order by v.date))
    -- niveau 2 et 3 (0002)
    select user_id, 'dans_le_mille' as b from res where err < 0.01
    union select user_id, 'bat_la_foule' from res where (score ->> 'beat_crowd')::boolean
    union select user_id, 'bat_wall_street' from res where (score ->> 'beat_analysts')::boolean
    union select user_id, 'regulier' from res group by user_id having count(*) >= 4
    union select user_id, 'bien_calibre' from res group by user_id
      having sum(coalesce((score ->> 'interval_n')::int, 0)) >= 5
         and sum(coalesce((score ->> 'interval_hit')::int, 0))::numeric
             / sum(coalesce((score ->> 'interval_n')::int, 0)) between 0.70 and 0.90
    union select user_id, 'oracle' from res group by user_id
      having sum(coalesce((score ->> 'brier_n')::int, 0)) >= 5
         and sum(coalesce((score ->> 'brier_sum')::numeric, 0)) / sum(coalesce((score ->> 'brier_n')::int, 0)) <= 0.15
    union select user_id, 'gerant_10' from pv where value >= initial_cash * 1.10
    union select user_id, 'vip' from (select * from ranked order by mae limit 3) t where n_ranked >= 6
    -- nouveaux succès
    union select user_id, 'tireur_elite' from res where err < 0.01 group by user_id having count(*) >= 3
    union select user_id, 'chirurgien' from res where err < 0.0025
    union select user_id, 'triple_couronne' from res
      where (score ->> 'beat_naive')::boolean and (score ->> 'beat_analysts')::boolean and (score ->> 'beat_crowd')::boolean
    union select user_id, 'contrarian' from rev
      where c > 0 and (v - c) * (a - c) > 0 and abs(v / c - 1) >= 0.01 and abs(a / c - 1) >= 0.02
    union select user_id, 'marathonien' from res group by user_id having count(*) >= 8
    union select user_id, 'generaliste' from res group by user_id having count(distinct ticker) >= 5
    union select user_id, 'fleau_wall_street' from streak where w and w1 and w2
    union select user_id, 'grand_oracle' from res group by user_id
      having sum(coalesce((score ->> 'brier_n')::int, 0)) >= 20
         and sum(coalesce((score ->> 'brier_sum')::numeric, 0)) / sum(coalesce((score ->> 'brier_n')::int, 0)) <= 0.10
    union select user_id, 'maitre_calibration' from res group by user_id
      having sum(coalesce((score ->> 'interval_n')::int, 0)) >= 20
         and sum(coalesce((score ->> 'interval_hit')::int, 0))::numeric
             / sum(coalesce((score ->> 'interval_n')::int, 0)) between 0.75 and 0.85
    union select user_id, 'gerant_25' from pv where value >= initial_cash * 1.25
    union select user_id, 'gerant_50' from pv where value >= initial_cash * 1.50
    union select user_id, 'alpha' from pv
      where date - d0 >= 90 and v0 > 0 and s0 > 0 and spy_close > 0 and value / v0 > spy_close / s0
    union select pf.user_id, 'diversifie' from pos join public.portfolios pf on pf.id = pos.portfolio_id
      where pos.q > 0 group by pf.user_id, pos.portfolio_id having count(*) >= 5
    union select user_id, 'numero_un' from (select * from ranked order by mae limit 1) t where n_ranked >= 6
  loop
    if public._award(r.user_id, r.b) then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function public.grant_auto_badges() from public, anon, authenticated;
grant execute on function public.grant_auto_badges() to service_role;

-- ---------------------------------------------------------------- liste des membres (admin)
create or replace function public.admin_members() returns table (
  username text, email text, is_admin boolean, created_at timestamptz, last_sign_in_at timestamptz,
  invited_with text, title_badge text, badges int, predictions int, portfolios int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs.'; end if;
  return query
  select p.username, u.email::text, p.is_admin, p.created_at, u.last_sign_in_at, p.invited_with, p.title_badge,
         (select count(*) from public.user_badges b where b.user_id = p.id)::int,
         (select count(*) from public.predictions x where x.user_id = p.id)::int,
         (select count(*) from public.portfolios x where x.user_id = p.id)::int
  from public.profiles p join auth.users u on u.id = p.id
  order by p.created_at;
end $$;
revoke all on function public.admin_members() from public, anon;
grant execute on function public.admin_members() to authenticated;

-- ---------------------------------------------------------------- messagerie
create table if not exists public.messages (
  id bigserial primary key,
  sender uuid not null references public.profiles (id) on delete cascade,
  recipient uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (sender <> recipient)
);
create index if not exists messages_pair on public.messages (least(sender, recipient), greatest(sender, recipient), created_at);
create index if not exists messages_recipient on public.messages (recipient, read_at);
alter table public.messages enable row level security;

create table if not exists public.blocks (
  blocker uuid not null references public.profiles (id) on delete cascade,
  blocked uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked)
);
alter table public.blocks enable row level security;

create table if not exists public.message_reports (
  id bigserial primary key,
  message_id bigint references public.messages (id) on delete set null,
  reporter uuid references public.profiles (id) on delete set null,
  reported uuid references public.profiles (id) on delete set null,
  body_copy text not null,                 -- seul le message signalé est transmis
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now()
);
alter table public.message_reports enable row level security;

create or replace function public._uid_of(p_username text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.profiles where lower(username) = lower(trim(p_username))
$$;
revoke all on function public._uid_of(text) from public, anon, authenticated;

create or replace function public.send_message(p_username text, p_body text) returns public.messages
language plpgsql security definer set search_path = public as $$
declare v_to uuid; v public.messages; v_from text; v_body text := trim(coalesce(p_body, ''));
begin
  if not public.is_member() then raise exception 'Réservé aux membres.'; end if;
  v_to := public._uid_of(p_username);
  if v_to is null then raise exception 'Membre introuvable : %', p_username; end if;
  if v_to = auth.uid() then raise exception 'Impossible de s''écrire à soi-même.'; end if;
  if char_length(v_body) = 0 or char_length(v_body) > 2000 then raise exception 'Message vide ou trop long (2 000 caractères maximum).'; end if;
  if exists (select 1 from public.blocks where blocker = v_to and blocked = auth.uid()) then
    raise exception 'Ce membre ne reçoit pas tes messages.';
  end if;
  if exists (select 1 from public.blocks where blocker = auth.uid() and blocked = v_to) then
    raise exception 'Tu as bloqué ce membre : débloque-le pour lui écrire.';
  end if;
  if (select count(*) from public.messages where sender = auth.uid() and created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'Trop de messages envoyés en peu de temps : réessaie dans quelques minutes.';
  end if;
  insert into public.messages (sender, recipient, body) values (auth.uid(), v_to, v_body) returning * into v;
  select username into v_from from public.profiles where id = auth.uid();
  -- une seule notification non lue par conversation (mise à jour au lieu de s'empiler)
  update public.notifications set body = left(v_body, 140), created_at = now(),
         data = jsonb_build_object('from', v_from, 'count', coalesce((data ->> 'count')::int, 1) + 1)
   where user_id = v_to and kind = 'message' and read_at is null and data ->> 'from' = v_from;
  if not found then
    insert into public.notifications (user_id, kind, title, body, link, data)
    values (v_to, 'message', 'Nouveau message de ' || v_from, left(v_body, 140), '#/messages/' || v_from,
            jsonb_build_object('from', v_from, 'count', 1));
  end if;
  return v;
end $$;

create or replace function public.mark_conversation_read(p_username text) returns int
language plpgsql security definer set search_path = public as $$
declare v_other uuid := public._uid_of(p_username); n int; v_from text;
begin
  update public.messages set read_at = now() where recipient = auth.uid() and sender = v_other and read_at is null;
  get diagnostics n = row_count;
  select username into v_from from public.profiles where id = v_other;
  update public.notifications set read_at = now()
   where user_id = auth.uid() and kind = 'message' and read_at is null and data ->> 'from' = v_from;
  return n;
end $$;

create or replace function public.conversations() returns table (
  username text, title_badge text, last_body text, last_at timestamptz, last_from_me boolean, unread int, blocked boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member() then raise exception 'Réservé aux membres.'; end if;
  return query
  with mine as (
    select m.*, case when m.sender = auth.uid() then m.recipient else m.sender end as other
    from public.messages m where auth.uid() in (m.sender, m.recipient)),
  last as (select distinct on (other) other, body, created_at, sender = auth.uid() as from_me
           from mine order by other, created_at desc)
  select p.username, p.title_badge, l.body, l.created_at, l.from_me,
         (select count(*) from mine x where x.other = l.other and x.recipient = auth.uid() and x.read_at is null)::int,
         exists (select 1 from public.blocks b where b.blocker = auth.uid() and b.blocked = l.other)
  from last l join public.profiles p on p.id = l.other
  order by l.created_at desc;
end $$;

create or replace function public.block_user(p_username text, p_block boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare v uuid := public._uid_of(p_username);
begin
  if not public.is_member() then raise exception 'Réservé aux membres.'; end if;
  if v is null or v = auth.uid() then raise exception 'Membre introuvable.'; end if;
  if p_block then
    insert into public.blocks (blocker, blocked) values (auth.uid(), v) on conflict do nothing;
  else
    delete from public.blocks where blocker = auth.uid() and blocked = v;
  end if;
end $$;

create or replace function public.report_message(p_message bigint, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare m public.messages; v_rep text;
begin
  select * into m from public.messages where id = p_message and recipient = auth.uid();
  if m.id is null then raise exception 'Message introuvable (on ne peut signaler qu''un message reçu).'; end if;
  insert into public.message_reports (message_id, reporter, reported, body_copy, reason)
  values (m.id, auth.uid(), m.sender, m.body, nullif(trim(p_reason), ''));
  select username into v_rep from public.profiles where id = m.sender;
  insert into public.notifications (user_id, kind, title, body, link, data)
  select p.id, 'report', 'Message signalé : ' || v_rep, left(m.body, 140), '#/admin/membres',
         jsonb_build_object('from', v_rep, 'reason', p_reason)
  from public.profiles p where p.is_admin;
end $$;

create or replace function public.admin_reports() returns table (
  id bigint, created_at timestamptz, reporter text, reported text, body_copy text, reason text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs.'; end if;
  return query
  select r.id, r.created_at, a.username, b.username, r.body_copy, r.reason
  from public.message_reports r left join public.profiles a on a.id = r.reporter
  left join public.profiles b on b.id = r.reported order by r.created_at desc;
end $$;

drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages for select to authenticated
  using (sender = (select auth.uid()) or recipient = (select auth.uid()));
drop policy if exists blocks_read on public.blocks;
create policy blocks_read on public.blocks for select to authenticated using (blocker = (select auth.uid()));

grant select, insert, update, delete on public.messages, public.blocks, public.message_reports to service_role;
grant usage, select on all sequences in schema public to service_role;
grant select on public.messages, public.blocks to authenticated;
revoke all on public.messages, public.blocks, public.message_reports from anon;
revoke all on public.message_reports from authenticated;

revoke all on function public.send_message(text, text) from public, anon;
revoke all on function public.mark_conversation_read(text) from public, anon;
revoke all on function public.conversations() from public, anon;
revoke all on function public.block_user(text, boolean) from public, anon;
revoke all on function public.report_message(bigint, text) from public, anon;
revoke all on function public.admin_reports() from public, anon;
grant execute on function public.send_message(text, text) to authenticated;
grant execute on function public.mark_conversation_read(text) to authenticated;
grant execute on function public.conversations() to authenticated;
grant execute on function public.block_user(text, boolean) to authenticated;
grant execute on function public.report_message(bigint, text) to authenticated;
grant execute on function public.admin_reports() to authenticated;
