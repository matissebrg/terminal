-- ============================================================================
-- Archer Terminal · espace membres (bêta fermée)
--
-- Toutes les règles du jeu sont imposées ICI, par la base (sécurité au niveau
-- des lignes + fonctions), jamais par l'interface : un membre malin qui appelle
-- l'API directement ne peut pas tricher.
--
--  * Accès réservé aux membres (code d'invitation).
--  * Une prédiction ne peut plus être créée ni modifiée après sa date limite.
--  * Chaque version est archivée (prediction_history) : c'est la version
--    enregistrée avant la date limite FINALE qui est notée.
--  * Les prédictions des autres ne sont visibles qu'après la date limite.
--  * Portefeuilles fictifs : un ordre est exécuté à la PROCHAINE clôture
--    (impossible d'acheter au cours d'hier après avoir vu les résultats).
--  * L'argent fictif ne peut être modifié que par les fonctions d'exécution.
-- ============================================================================

-- ---------------------------------------------------------------- configuration
create table if not exists public.app_config (
  key text primary key,
  value text not null
);
alter table public.app_config enable row level security;   -- aucune politique : invisible aux clients

-- ---------------------------------------------------------------- membres
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_.-]{3,24}$'),
  is_admin boolean not null default false,
  show_on_leaderboard boolean not null default true,
  invited_with text,
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_username_ci on public.profiles (lower(username));
alter table public.profiles enable row level security;

create table if not exists public.invite_codes (
  code text primary key,
  max_uses int not null default 1 check (max_uses between 1 and 200),
  uses int not null default 0,
  expires_at timestamptz,
  note text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.invite_codes enable row level security;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid())
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

-- Rejoindre avec un code. Le fondateur (e-mail enregistré dans app_config.admin_email)
-- peut rejoindre sans code tant qu'aucun administrateur n'existe.
create or replace function public.join_with_code(p_code text, p_username text) returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  v_code public.invite_codes;
  v_prof public.profiles;
  v_email text;
  v_founder boolean := false;
begin
  if auth.uid() is null then raise exception 'Connecte-toi d''abord.'; end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Tu es déjà membre.';
  end if;
  if coalesce(trim(p_username), '') !~ '^[A-Za-z0-9_.-]{3,24}$' then
    raise exception 'Pseudo invalide : 3 à 24 caractères (lettres, chiffres, . _ -).';
  end if;
  if exists (select 1 from public.profiles where lower(username) = lower(trim(p_username))) then
    raise exception 'Ce pseudo est déjà pris.';
  end if;

  select email into v_email from auth.users where id = auth.uid();
  if coalesce(trim(p_code), '') = '' then
    if v_email is not null
       and lower(v_email) = lower(coalesce((select value from public.app_config where key = 'admin_email'), ''))
       and not exists (select 1 from public.profiles where is_admin) then
      v_founder := true;
    else
      raise exception 'Code d''invitation requis.';
    end if;
  else
    select * into v_code from public.invite_codes where code = upper(trim(p_code)) for update;
    if not found then raise exception 'Code d''invitation invalide.'; end if;
    if v_code.expires_at is not null and v_code.expires_at < now() then raise exception 'Code expiré.'; end if;
    if v_code.uses >= v_code.max_uses then raise exception 'Code déjà entièrement utilisé.'; end if;
    update public.invite_codes set uses = uses + 1 where code = v_code.code;
  end if;

  insert into public.profiles (id, username, is_admin, invited_with)
  values (auth.uid(), trim(p_username), v_founder, case when v_founder then 'FONDATEUR' else v_code.code end)
  returning * into v_prof;
  return v_prof;
end $$;

create or replace function public.create_invite(p_max_uses int default 1, p_days int default 30, p_note text default null)
returns public.invite_codes
language plpgsql security definer set search_path = public as $$
declare v public.invite_codes;
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs.'; end if;
  insert into public.invite_codes (code, max_uses, expires_at, note, created_by)
  values ('ARCHER-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
          greatest(1, least(coalesce(p_max_uses, 1), 200)),
          case when p_days is null or p_days <= 0 then null else now() + make_interval(days => p_days) end,
          p_note, auth.uid())
  returning * into v;
  return v;
end $$;

create or replace function public.list_invites() returns setof public.invite_codes
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs.'; end if;
  return query select * from public.invite_codes order by created_at desc;
end $$;

-- ---------------------------------------------------------------- périodes & cours (écrits par le pipeline)
create table if not exists public.periods (
  ticker text not null,
  period text not null,
  period_end date,
  expected_release date,
  release_date date,                  -- date réelle, une fois les chiffres publiés
  deadline timestamptz,               -- 00:00 New York le jour de publication (attendu puis réel)
  estimated boolean not null default true,
  status text not null default 'open' check (status in ('open', 'closed', 'resolved')),
  updated_at timestamptz not null default now(),
  primary key (ticker, period)
);
alter table public.periods enable row level security;

create table if not exists public.latest_prices (
  ticker text primary key,
  name text,
  close numeric not null check (close > 0),
  price_date date not null,
  updated_at timestamptz not null default now()
);
alter table public.latest_prices enable row level security;

-- ---------------------------------------------------------------- prédictions
create table if not exists public.predictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  ticker text not null,
  period text not null,
  metrics jsonb not null default '{}'::jsonb,        -- {"revenue": {"value": 110.5, "low": 106, "high": 115}, ...}
  questions jsonb not null default '[]'::jsonb,      -- [{"id": "rev_above_crowd", "p": 60}, ...]
  price_targets jsonb not null default '[]'::jsonb,  -- [{"date": "2026-12-31", "value": 240, "low": 200, "high": 280}]
  note text check (note is null or char_length(note) <= 4000),
  visibility text not null default 'group' check (visibility in ('group', 'private')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, ticker, period),
  foreign key (ticker, period) references public.periods (ticker, period)
);
alter table public.predictions enable row level security;

create table if not exists public.prediction_history (
  id bigserial primary key,
  prediction_id uuid not null references public.predictions (id) on delete cascade,
  user_id uuid not null,
  snapshot jsonb not null,
  recorded_at timestamptz not null default now()
);
create index if not exists prediction_history_pred on public.prediction_history (prediction_id, recorded_at);
alter table public.prediction_history enable row level security;

create or replace function public.predictions_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_deadline timestamptz;
  k text;
begin
  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id or new.ticker <> old.ticker or new.period <> old.period
       or new.created_at <> old.created_at then
      raise exception 'Seuls le contenu et la visibilité d''une prédiction peuvent changer.';
    end if;
  else
    if auth.uid() is not null then new.user_id := auth.uid(); end if;
    new.created_at := now();
  end if;
  select deadline into v_deadline from public.periods where ticker = new.ticker and period = new.period;
  if v_deadline is not null and now() >= v_deadline then
    raise exception 'Date limite dépassée pour % % (%).', new.ticker, new.period, v_deadline;
  end if;
  if jsonb_typeof(new.metrics) <> 'object' or jsonb_typeof(new.questions) <> 'array'
     or jsonb_typeof(new.price_targets) <> 'array' then
    raise exception 'Format de prédiction invalide.';
  end if;
  for k in select jsonb_object_keys(new.metrics) loop
    if k not in ('revenue', 'gross_margin', 'operating_income', 'operating_margin', 'net_income', 'eps_diluted', 'fcf') then
      raise exception 'Indicateur inconnu : %', k;
    end if;
    if jsonb_typeof(new.metrics -> k -> 'value') <> 'number' then
      raise exception 'Valeur manquante pour %', k;
    end if;
  end loop;
  if jsonb_array_length(new.questions) > 10 or jsonb_array_length(new.price_targets) > 5 then
    raise exception 'Trop de questions ou d''objectifs de cours.';
  end if;
  if exists (select 1 from jsonb_array_elements(new.questions) q
             where (q ->> 'id') not in ('rev_above_guidance_high', 'rev_above_analysts', 'rev_above_crowd',
                                        'gm_above_guidance', 'price_up_after')
                or jsonb_typeof(q -> 'p') <> 'number' or (q ->> 'p')::numeric not between 0 and 100) then
    raise exception 'Question invalide (identifiant inconnu ou probabilité hors de 0-100).';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists predictions_guard on public.predictions;
create trigger predictions_guard before insert or update on public.predictions
for each row execute function public.predictions_guard();

create or replace function public.predictions_archive() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.prediction_history (prediction_id, user_id, snapshot, recorded_at)
  values (new.id, new.user_id,
          jsonb_build_object('metrics', new.metrics, 'questions', new.questions,
                             'price_targets', new.price_targets, 'note', new.note),
          now());
  return null;
end $$;

drop trigger if exists predictions_archive on public.predictions;
create trigger predictions_archive after insert or update on public.predictions
for each row execute function public.predictions_archive();

-- Nombre de prédictions déjà déposées (sans révéler les valeurs avant la date limite)
create or replace function public.prediction_count(p_ticker text, p_period text) returns int
language sql stable security definer set search_path = public as $$
  select case when public.is_member()
    then (select count(*)::int from public.predictions where ticker = p_ticker and period = p_period)
    else 0 end
$$;

create table if not exists public.prediction_results (
  prediction_id uuid primary key references public.predictions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  ticker text not null,
  period text not null,
  status text not null check (status in ('resolved', 'partial', 'late')),
  scored_version_at timestamptz,
  results jsonb not null default '{}'::jsonb,
  score jsonb not null default '{}'::jsonb,
  resolved_at timestamptz not null default now()
);
alter table public.prediction_results enable row level security;

create table if not exists public.crowd_consensus (
  ticker text not null,
  period text not null,
  metric text not null,
  n int not null,
  median numeric,
  mean numeric,
  p25 numeric,
  p75 numeric,
  computed_at timestamptz not null default now(),
  primary key (ticker, period, metric)
);
alter table public.crowd_consensus enable row level security;

create or replace function public.leaderboard() returns table (
  username text, n int, rev_n int, rev_mae numeric, rev_bias numeric,
  interval_n int, interval_hit int, crowd_n int, crowd_wins int, brier_n int, brier numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member() then raise exception 'Réservé aux membres.'; end if;
  return query
  select p.username,
         count(r.*)::int,
         count(r.score -> 'rev_abs_err')::int,
         avg((r.score ->> 'rev_abs_err')::numeric),
         avg((r.score ->> 'rev_err')::numeric),
         coalesce(sum((r.score ->> 'interval_n')::int), 0)::int,
         coalesce(sum((r.score ->> 'interval_hit')::int), 0)::int,
         count(r.score -> 'beat_crowd')::int,
         count(*) filter (where (r.score ->> 'beat_crowd')::boolean)::int,
         coalesce(sum((r.score ->> 'brier_n')::int), 0)::int,
         case when sum((r.score ->> 'brier_n')::int) > 0
              then sum((r.score ->> 'brier_sum')::numeric) / sum((r.score ->> 'brier_n')::int) end
  from public.profiles p
  join public.prediction_results r on r.user_id = p.id and r.status <> 'late'
  where p.show_on_leaderboard
  group by p.username
  order by avg((r.score ->> 'rev_abs_err')::numeric) nulls last;
end $$;

-- ---------------------------------------------------------------- portefeuilles fictifs
create table if not exists public.portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  initial_cash numeric not null default 100000,
  cash numeric not null default 100000 check (cash >= 0),
  visibility text not null default 'group' check (visibility in ('group', 'private')),
  created_at timestamptz not null default now()
);
alter table public.portfolios enable row level security;

create or replace function public.portfolios_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then new.user_id := auth.uid(); end if;
  new.initial_cash := 100000;
  new.cash := 100000;
  new.created_at := now();
  if (select count(*) from public.portfolios where user_id = new.user_id) >= 5 then
    raise exception 'Maximum 5 portefeuilles par membre.';
  end if;
  return new;
end $$;

drop trigger if exists portfolios_guard on public.portfolios;
create trigger portfolios_guard before insert on public.portfolios
for each row execute function public.portfolios_guard();

create table if not exists public.orders (
  id bigserial primary key,
  portfolio_id uuid not null references public.portfolios (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  ticker text not null references public.latest_prices (ticker),
  side text not null check (side in ('buy', 'sell')),
  qty numeric not null check (qty > 0 and qty <= 1e9),
  status text not null default 'pending' check (status in ('pending', 'filled', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  filled_at timestamptz,
  fill_price numeric,
  fill_date date,
  reason text
);
create index if not exists orders_pending on public.orders (status) where status = 'pending';
alter table public.orders enable row level security;

create table if not exists public.trades (
  id bigserial primary key,
  order_id bigint references public.orders (id) on delete set null,
  portfolio_id uuid not null references public.portfolios (id) on delete cascade,
  user_id uuid not null,
  ticker text not null,
  side text not null check (side in ('buy', 'sell')),
  qty numeric not null,
  price numeric not null,
  price_date date not null,
  executed_at timestamptz not null default now()
);
alter table public.trades enable row level security;

create table if not exists public.portfolio_values (
  portfolio_id uuid not null references public.portfolios (id) on delete cascade,
  date date not null,
  value numeric not null,
  cash numeric not null,
  primary key (portfolio_id, date)
);
alter table public.portfolio_values enable row level security;

create or replace function public.place_order(p_portfolio uuid, p_ticker text, p_side text, p_qty numeric)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare v public.orders;
begin
  if not public.is_member() then raise exception 'Réservé aux membres.'; end if;
  if not exists (select 1 from public.portfolios where id = p_portfolio and user_id = auth.uid()) then
    raise exception 'Portefeuille introuvable.';
  end if;
  if not exists (select 1 from public.latest_prices where ticker = upper(p_ticker)) then
    raise exception 'Valeur non disponible : %', p_ticker;
  end if;
  if p_side not in ('buy', 'sell') then raise exception 'Sens invalide.'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Quantité invalide.'; end if;
  if (select count(*) from public.orders where user_id = auth.uid() and status = 'pending') >= 50 then
    raise exception 'Trop d''ordres en attente.';
  end if;
  insert into public.orders (portfolio_id, user_id, ticker, side, qty)
  values (p_portfolio, auth.uid(), upper(p_ticker), p_side, round(p_qty, 4))
  returning * into v;
  return v;
end $$;

create or replace function public.cancel_order(p_order bigint) returns public.orders
language plpgsql security definer set search_path = public as $$
declare v public.orders;
begin
  update public.orders set status = 'cancelled', reason = 'annulé par le membre'
  where id = p_order and user_id = auth.uid() and status = 'pending'
  returning * into v;
  if v.id is null then raise exception 'Ordre introuvable ou déjà exécuté.'; end if;
  return v;
end $$;

create or replace function public.rename_portfolio(p_portfolio uuid, p_name text, p_visibility text default null)
returns public.portfolios
language plpgsql security definer set search_path = public as $$
declare v public.portfolios;
begin
  update public.portfolios
     set name = coalesce(nullif(trim(p_name), ''), name),
         visibility = coalesce(p_visibility, visibility)
   where id = p_portfolio and user_id = auth.uid()
  returning * into v;
  if v.id is null then raise exception 'Portefeuille introuvable.'; end if;
  return v;
end $$;

-- Exécution d'un ordre au cours de clôture choisi par le pipeline (rôle service uniquement).
create or replace function public.fill_order(p_order bigint, p_price numeric, p_date date) returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
  pf public.portfolios;
  pos numeric;
  cost numeric;
begin
  select * into o from public.orders where id = p_order for update;
  if o.id is null or o.status <> 'pending' then return o; end if;
  select * into pf from public.portfolios where id = o.portfolio_id for update;
  cost := round(o.qty * p_price, 2);
  if o.side = 'buy' then
    if pf.cash < cost then
      update public.orders set status = 'rejected', reason = 'liquidités insuffisantes', fill_date = p_date,
             fill_price = p_price, filled_at = now() where id = o.id returning * into o;
      return o;
    end if;
    update public.portfolios set cash = cash - cost where id = pf.id;
  else
    select coalesce(sum(case when side = 'buy' then qty else -qty end), 0) into pos
      from public.trades where portfolio_id = pf.id and ticker = o.ticker;
    if pos < o.qty then
      update public.orders set status = 'rejected', reason = 'position insuffisante (pas de vente à découvert)',
             fill_date = p_date, fill_price = p_price, filled_at = now() where id = o.id returning * into o;
      return o;
    end if;
    update public.portfolios set cash = cash + cost where id = pf.id;
  end if;
  insert into public.trades (order_id, portfolio_id, user_id, ticker, side, qty, price, price_date)
  values (o.id, pf.id, o.user_id, o.ticker, o.side, o.qty, p_price, p_date);
  update public.orders set status = 'filled', fill_price = p_price, fill_date = p_date, filled_at = now()
   where id = o.id returning * into o;
  return o;
end $$;

-- Suppression du compte par son titulaire (RGPD) : profil, prédictions, portefeuilles en cascade.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Non connecté.'; end if;
  delete from auth.users where id = auth.uid();
end $$;

-- ---------------------------------------------------------------- politiques d'accès (RLS)
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_member());
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists periods_read on public.periods;
create policy periods_read on public.periods for select to authenticated using (public.is_member());
drop policy if exists prices_read on public.latest_prices;
create policy prices_read on public.latest_prices for select to authenticated using (public.is_member());

drop policy if exists predictions_read on public.predictions;
create policy predictions_read on public.predictions for select to authenticated using (
  user_id = (select auth.uid())
  or (visibility = 'group' and public.is_member() and exists (
        select 1 from public.periods p
        where p.ticker = predictions.ticker and p.period = predictions.period
          and p.deadline is not null and p.deadline <= now()))
);
drop policy if exists predictions_insert on public.predictions;
create policy predictions_insert on public.predictions for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_member());
drop policy if exists predictions_update on public.predictions;
create policy predictions_update on public.predictions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists predictions_delete on public.predictions;
create policy predictions_delete on public.predictions for delete to authenticated using (
  user_id = (select auth.uid()) and not exists (
    select 1 from public.periods p where p.ticker = predictions.ticker and p.period = predictions.period
      and p.deadline is not null and p.deadline <= now()));

drop policy if exists history_read on public.prediction_history;
create policy history_read on public.prediction_history for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists results_read on public.prediction_results;
create policy results_read on public.prediction_results for select to authenticated using (
  user_id = (select auth.uid())
  or exists (select 1 from public.predictions p where p.id = prediction_results.prediction_id)
);

drop policy if exists crowd_read on public.crowd_consensus;
create policy crowd_read on public.crowd_consensus for select to authenticated using (public.is_member());

drop policy if exists portfolios_read on public.portfolios;
create policy portfolios_read on public.portfolios for select to authenticated
  using (user_id = (select auth.uid()) or (visibility = 'group' and public.is_member()));
drop policy if exists portfolios_insert on public.portfolios;
create policy portfolios_insert on public.portfolios for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_member());
drop policy if exists portfolios_delete on public.portfolios;
create policy portfolios_delete on public.portfolios for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists trades_read on public.trades;
create policy trades_read on public.trades for select to authenticated using (
  exists (select 1 from public.portfolios p where p.id = trades.portfolio_id));   -- hérite de portfolios_read

drop policy if exists values_read on public.portfolio_values;
create policy values_read on public.portfolio_values for select to authenticated using (
  exists (select 1 from public.portfolios p where p.id = portfolio_values.portfolio_id));

-- ---------------------------------------------------------------- droits sur les tables
-- Explicites : les projets Supabase créés depuis le 30 mai 2026 n'accordent plus rien par défaut aux
-- rôles de l'API sur les nouvelles tables. Les restrictions fines suivent (révocations ci-dessous + RLS).
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.profiles, public.invite_codes, public.periods, public.latest_prices,
  public.predictions, public.prediction_history, public.prediction_results, public.crowd_consensus,
  public.portfolios, public.orders, public.trades, public.portfolio_values, public.app_config to service_role;
grant usage, select on all sequences in schema public to service_role;
grant select on public.profiles, public.periods, public.latest_prices, public.predictions, public.prediction_history,
  public.prediction_results, public.crowd_consensus, public.portfolios, public.orders, public.trades,
  public.portfolio_values to authenticated;
grant insert, update, delete on public.predictions to authenticated;
grant insert, delete on public.portfolios to authenticated;
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------- droits d'exécution des fonctions
-- utilisées par les politiques RLS : exécutées avec les droits de l'utilisateur connecté
revoke all on function public.is_member() from public, anon;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_member() to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;
revoke all on function public.join_with_code(text, text) from public, anon;
revoke all on function public.create_invite(int, int, text) from public, anon;
revoke all on function public.list_invites() from public, anon;
revoke all on function public.prediction_count(text, text) from public, anon;
revoke all on function public.leaderboard() from public, anon;
revoke all on function public.place_order(uuid, text, text, numeric) from public, anon;
revoke all on function public.cancel_order(bigint) from public, anon;
revoke all on function public.rename_portfolio(uuid, text, text) from public, anon;
revoke all on function public.fill_order(bigint, numeric, date) from public, anon, authenticated;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

grant execute on function public.join_with_code(text, text) to authenticated;
grant execute on function public.create_invite(int, int, text) to authenticated;
grant execute on function public.list_invites() to authenticated;
grant execute on function public.prediction_count(text, text) to authenticated;
grant execute on function public.leaderboard() to authenticated;
grant execute on function public.place_order(uuid, text, text, numeric) to authenticated;
grant execute on function public.cancel_order(bigint) to authenticated;
grant execute on function public.rename_portfolio(uuid, text, text) to authenticated;
grant execute on function public.fill_order(bigint, numeric, date) to service_role;

-- Les clients n'écrivent jamais directement dans ces tables (pipeline / fonctions uniquement)
revoke insert, update, delete on public.periods, public.latest_prices, public.prediction_results,
  public.crowd_consensus, public.orders, public.trades, public.portfolio_values, public.prediction_history,
  public.invite_codes, public.app_config from anon, authenticated;
revoke all on public.app_config, public.invite_codes from anon, authenticated;
revoke insert, update, delete on public.profiles from anon, authenticated;   -- adhésion via join_with_code uniquement
grant update (username, show_on_leaderboard) on public.profiles to authenticated;
revoke all on public.portfolios from anon;
revoke update on public.portfolios from authenticated;
