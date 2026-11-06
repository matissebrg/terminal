-- ============================================================================
-- Archer Terminal · exécution réaliste et vente d'options couverte
--
--  Actions
--   * ordres à cours limité (valables 30 jours) en plus des ordres au marché ;
--   * exécutions partielles : une séance n'absorbe qu'une part de son volume (le pipeline décide de la
--     quantité, du prix avec demi-écart acheteur-vendeur et impact de marché, et l'explique dans `detail`) ;
--   * données de microstructure publiées dans latest_prices (ouverture, plus haut, plus bas, volume,
--     volume moyen, volatilité, écart estimé) pour le ticket d'ordre.
--
--  Options : vente « couverte » uniquement, pas de marge
--   * call vendu : 100 actions détenues par contrat, bloquées tant que le call est ouvert ;
--   * put vendu : strike × 100 $ de liquidités par contrat, réservées tant que le put est ouvert ;
--   * rachat pour clôturer, ou dénouement à l'échéance au comptant (on paie la valeur intrinsèque :
--     même résultat qu'une assignation suivie d'une revente au cours).
-- ============================================================================

-- ---------------------------------------------------------------- microstructure publiée par le pipeline
alter table public.latest_prices add column if not exists open numeric;
alter table public.latest_prices add column if not exists high numeric;
alter table public.latest_prices add column if not exists low numeric;
alter table public.latest_prices add column if not exists prev_close numeric;
alter table public.latest_prices add column if not exists volume numeric;
alter table public.latest_prices add column if not exists adv_shares numeric;     -- volume moyen 20 séances
alter table public.latest_prices add column if not exists sigma_d numeric;        -- volatilité quotidienne 20 séances
alter table public.latest_prices add column if not exists spread_bps numeric;     -- écart acheteur-vendeur estimé

-- ---------------------------------------------------------------- ordres sur actions
alter table public.orders add column if not exists order_type text not null default 'market';
alter table public.orders add column if not exists limit_price numeric;
alter table public.orders add column if not exists filled_qty numeric not null default 0;
alter table public.orders add column if not exists expires_on date;
alter table public.orders add column if not exists detail jsonb;
alter table public.trades add column if not exists detail jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'orders_order_type_check') then
    alter table public.orders add constraint orders_order_type_check check (order_type in ('market', 'limit'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_limit_check') then
    alter table public.orders add constraint orders_limit_check
      check ((order_type = 'market' and limit_price is null) or (order_type = 'limit' and limit_price > 0));
  end if;
end $$;
update public.orders set filled_qty = qty where status = 'filled' and filled_qty = 0;

-- positions utiles aux contrôles de couverture
create or replace function public._shares(p_pf uuid, p_ticker text) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when side = 'buy' then qty else -qty end), 0) from public.trades
  where portfolio_id = p_pf and ticker = p_ticker
$$;

create or replace function public._short_calls(p_pf uuid, p_ticker text) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(greatest(0, -q)), 0)::int from (
    select sum(case when side = 'buy' then qty else -qty end) as q from public.option_trades
    where portfolio_id = p_pf and ticker = p_ticker and type = 'C' group by expiry, strike) s
$$;

create or replace function public._reserved_cash(p_pf uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(greatest(0, -q) * strike * 100), 0) from (
    select strike, sum(case when side = 'buy' then qty else -qty end) as q from public.option_trades
    where portfolio_id = p_pf and type = 'P' group by ticker, expiry, strike) s
$$;

drop function if exists public.place_order(uuid, text, text, numeric);
create or replace function public.place_order(p_portfolio uuid, p_ticker text, p_side text, p_qty numeric,
                                              p_type text default 'market', p_limit numeric default null)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare v public.orders; last numeric; avail numeric; tk text := upper(trim(p_ticker));
begin
  if not public.is_member() then raise exception 'Réservé aux membres.'; end if;
  if not exists (select 1 from public.portfolios where id = p_portfolio and user_id = auth.uid()) then
    raise exception 'Portefeuille introuvable.';
  end if;
  select close into last from public.latest_prices where ticker = tk;
  if last is null then raise exception 'Valeur non disponible : %', p_ticker; end if;
  if p_side not in ('buy', 'sell') then raise exception 'Sens invalide.'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Quantité invalide.'; end if;
  if coalesce(p_type, 'market') not in ('market', 'limit') then raise exception 'Type d''ordre invalide.'; end if;
  if p_type = 'limit' then
    if p_limit is null or p_limit <= 0 then raise exception 'Prix limite manquant.'; end if;
    if p_limit > last * 1.5 or p_limit < last * 0.5 then
      raise exception 'Prix limite trop éloigné du dernier cours (% $) : 50 %% au plus.', round(last, 2);
    end if;
  end if;
  if p_side = 'sell' then
    avail := public._shares(p_portfolio, tk) - 100 * public._short_calls(p_portfolio, tk)
             - coalesce((select sum(qty - filled_qty) from public.orders where portfolio_id = p_portfolio
                          and ticker = tk and side = 'sell' and status = 'pending'), 0)
             -- calls en cours de vente : leurs actions seront bloquées
             - 100 * coalesce((select sum(qty) from public.option_orders where portfolio_id = p_portfolio
                                and ticker = tk and type = 'C' and side = 'sell' and status = 'pending'), 0);
    if avail < p_qty then
      raise exception 'Vente impossible : % action(s) disponible(s) (hors ordres en attente et actions couvrant des calls vendus).',
        round(greatest(avail, 0), 2);
    end if;
  end if;
  if (select count(*) from public.orders where user_id = auth.uid() and status = 'pending') >= 50 then
    raise exception 'Trop d''ordres en attente.';
  end if;
  insert into public.orders (portfolio_id, user_id, ticker, side, qty, order_type, limit_price, expires_on)
  values (p_portfolio, auth.uid(), tk, p_side, round(p_qty, 4), coalesce(p_type, 'market'),
          case when p_type = 'limit' then round(p_limit, 4) end,
          case when p_type = 'limit' then (now() at time zone 'America/New_York')::date + 30 end)
  returning * into v;
  return v;
end $$;

-- Exécution (rôle service) : quantité et prix décidés par le pipeline (demi-écart, impact, participation)
drop function if exists public.fill_order(bigint, numeric, date);
create or replace function public.fill_order(p_order bigint, p_price numeric, p_date date,
                                             p_qty numeric default null, p_detail jsonb default null)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare o public.orders; pf public.portfolios; q numeric; cost numeric; why text;
begin
  select * into o from public.orders where id = p_order for update;
  if o.id is null or o.status <> 'pending' then return o; end if;
  q := least(coalesce(p_qty, o.qty - o.filled_qty), o.qty - o.filled_qty);
  if q is null or q <= 0 or p_price is null or p_price <= 0 then return o; end if;
  select * into pf from public.portfolios where id = o.portfolio_id for update;
  cost := round(q * p_price, 2);
  if o.side = 'buy' and pf.cash - cost < public._reserved_cash(pf.id) then
    why := case when public._reserved_cash(pf.id) > 0 then 'liquidités insuffisantes (une partie est réservée aux puts vendus)'
                else 'liquidités insuffisantes' end;
  elsif o.side = 'sell' and public._shares(pf.id, o.ticker) - 100 * public._short_calls(pf.id, o.ticker) < q then
    why := 'position insuffisante (pas de vente à découvert ; les actions couvrant des calls vendus sont bloquées)';
  end if;
  if why is not null then
    update public.orders set status = case when o.filled_qty > 0 then 'cancelled' else 'rejected' end,
           reason = case when o.filled_qty > 0 then 'reliquat annulé : ' || why else why end,
           filled_at = now(), fill_date = coalesce(o.fill_date, p_date)
     where id = o.id returning * into o;
    return o;
  end if;
  update public.portfolios set cash = cash + case when o.side = 'buy' then -cost else cost end where id = pf.id;
  insert into public.trades (order_id, portfolio_id, user_id, ticker, side, qty, price, price_date, detail)
  values (o.id, pf.id, o.user_id, o.ticker, o.side, q, p_price, p_date, p_detail);
  update public.orders
     set fill_price = round((coalesce(fill_price, 0) * filled_qty + p_price * q) / (filled_qty + q), 4),
         filled_qty = filled_qty + q,
         status = case when filled_qty + q >= qty then 'filled' else 'pending' end,
         fill_date = p_date, filled_at = now(), detail = p_detail
   where id = o.id returning * into o;
  return o;
end $$;

-- Fin de validité d'un ordre à cours limité (rôle service)
create or replace function public.expire_order(p_order bigint, p_reason text) returns public.orders
language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  update public.orders set status = 'cancelled', reason = p_reason, filled_at = now()
   where id = p_order and status = 'pending' returning * into o;
  return o;
end $$;

-- ---------------------------------------------------------------- options : vente couverte
create or replace function public.place_option_order(p_portfolio uuid, p_ticker text, p_expiry date, p_strike numeric,
                                                     p_type text, p_side text, p_qty int)
returns public.option_orders
language plpgsql security definer set search_path = public as $$
declare v public.option_orders; held int; pending_sell int; open_q int; tk text := upper(trim(p_ticker));
        avail numeric; pend_open numeric;
begin
  if not public.is_member() then raise exception 'Réservé aux membres.'; end if;
  if not exists (select 1 from public.portfolios where id = p_portfolio and user_id = auth.uid()) then
    raise exception 'Portefeuille introuvable.';
  end if;
  if p_type not in ('C', 'P') or p_side not in ('buy', 'sell') then raise exception 'Ordre invalide.'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 100 then raise exception 'Quantité : de 1 à 100 contrats.'; end if;
  if not exists (select 1 from public.option_quotes where ticker = tk and expiry = p_expiry
                 and strike = p_strike and type = p_type) then
    raise exception 'Contrat non coté : % % % %', tk, p_expiry, p_strike, p_type;
  end if;
  if p_expiry <= (now() at time zone 'America/New_York')::date then
    raise exception 'Ce contrat arrive à échéance : choisis une échéance plus lointaine.';
  end if;
  if p_side = 'sell' then
    held := public._option_position(p_portfolio, tk, p_expiry, p_strike, p_type);
    select coalesce(sum(qty), 0) into pending_sell from public.option_orders
     where portfolio_id = p_portfolio and status = 'pending' and side = 'sell' and ticker = tk
       and expiry = p_expiry and strike = p_strike and type = p_type;
    open_q := p_qty - greatest(0, held - pending_sell);           -- contrats vendus à découvert (ouverture)
    if open_q > 0 then
      if p_type = 'C' then
        select coalesce(sum(qty), 0) into pend_open from public.option_orders
         where portfolio_id = p_portfolio and status = 'pending' and side = 'sell' and ticker = tk and type = 'C';
        avail := public._shares(p_portfolio, tk) - 100 * (public._short_calls(p_portfolio, tk) + pend_open);
        if avail < 100 * open_q then
          raise exception 'Call vendu non couvert : il faut 100 actions % par contrat (% disponible(s)). Pas de vente à nu.',
            tk, round(greatest(avail, 0), 0);
        end if;
      else
        select coalesce(sum(strike * 100 * qty), 0) into pend_open from public.option_orders
         where portfolio_id = p_portfolio and status = 'pending' and side = 'sell' and type = 'P';
        avail := (select cash from public.portfolios where id = p_portfolio) - public._reserved_cash(p_portfolio) - pend_open;
        if avail < p_strike * 100 * open_q then
          raise exception 'Put vendu non garanti : il faut % $ de liquidités libres (strike × 100 par contrat), % disponibles.',
            round(p_strike * 100 * open_q, 0), round(greatest(avail, 0), 0);
        end if;
      end if;
    end if;
  end if;
  if (select count(*) from public.option_orders where user_id = auth.uid() and status = 'pending') >= 30 then
    raise exception 'Trop d''ordres d''options en attente.';
  end if;
  insert into public.option_orders (portfolio_id, user_id, ticker, expiry, strike, type, side, qty)
  values (p_portfolio, auth.uid(), tk, p_expiry, p_strike, p_type, p_side, p_qty)
  returning * into v;
  return v;
end $$;

create or replace function public.fill_option_order(p_order bigint, p_price numeric, p_date date) returns public.option_orders
language plpgsql security definer set search_path = public as $$
declare o public.option_orders; pf public.portfolios; cost numeric; pos int; open_q int; reserved numeric; why text;
begin
  select * into o from public.option_orders where id = p_order for update;
  if o.id is null or o.status <> 'pending' then return o; end if;
  select * into pf from public.portfolios where id = o.portfolio_id for update;
  if p_price is null or p_price <= 0 then
    update public.option_orders set status = 'rejected', reason = 'pas de cotation exploitable', filled_at = now(), fill_date = p_date
     where id = o.id returning * into o;
    return o;
  end if;
  cost := round(p_price * 100 * o.qty, 2);
  pos := public._option_position(pf.id, o.ticker, o.expiry, o.strike, o.type);
  reserved := public._reserved_cash(pf.id);
  if o.side = 'buy' then
    -- un rachat de put vendu libère sa garantie
    if o.type = 'P' and pos < 0 then reserved := reserved - o.strike * 100 * least(o.qty, -pos); end if;
    if pf.cash - cost < reserved then why := 'liquidités insuffisantes'; end if;
  else
    open_q := o.qty - greatest(pos, 0);
    if open_q > 0 then
      if o.type = 'C' and public._shares(pf.id, o.ticker) - 100 * public._short_calls(pf.id, o.ticker) < 100 * open_q then
        why := 'call non couvert (100 actions par contrat)';
      elsif o.type = 'P' and pf.cash - reserved < o.strike * 100 * open_q then
        why := 'put non garanti (strike × 100 $ de liquidités par contrat)';
      end if;
    end if;
  end if;
  if why is not null then
    update public.option_orders set status = 'rejected', reason = why, fill_price = p_price, fill_date = p_date, filled_at = now()
     where id = o.id returning * into o;
    return o;
  end if;
  update public.portfolios set cash = cash + case when o.side = 'buy' then -cost else cost end where id = pf.id;
  insert into public.option_trades (order_id, portfolio_id, user_id, ticker, expiry, strike, type, side, qty, price, trade_date)
  values (o.id, pf.id, o.user_id, o.ticker, o.expiry, o.strike, o.type, o.side, o.qty, p_price, p_date);
  update public.option_orders set status = 'filled', fill_price = p_price, fill_date = p_date, filled_at = now()
   where id = o.id returning * into o;
  return o;
end $$;

-- Échéance : positions acheteuses ET vendeuses dénouées au comptant à la valeur intrinsèque
create or replace function public.settle_expired_options(p_ticker text, p_expiry date, p_underlying numeric) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; intrinsic numeric;
begin
  for r in
    select portfolio_id, user_id, strike, type, sum(case when side = 'buy' then qty else -qty end)::int as q
    from public.option_trades where ticker = p_ticker and expiry = p_expiry
    group by portfolio_id, user_id, strike, type having sum(case when side = 'buy' then qty else -qty end) <> 0
  loop
    intrinsic := greatest(0, case when r.type = 'C' then p_underlying - r.strike else r.strike - p_underlying end);
    -- q < 0 (vendeur) : la ligne « expire » de quantité négative remet la position à zéro et le vendeur paie
    insert into public.option_trades (portfolio_id, user_id, ticker, expiry, strike, type, side, qty, price, trade_date)
    values (r.portfolio_id, r.user_id, p_ticker, p_expiry, r.strike, r.type, 'expire', r.q, round(intrinsic, 4), p_expiry);
    update public.portfolios set cash = cash + round(intrinsic * 100 * r.q, 2) where id = r.portfolio_id;
    update public.option_orders set status = 'cancelled', reason = 'contrat arrivé à échéance'
     where portfolio_id = r.portfolio_id and status = 'pending' and ticker = p_ticker and expiry = p_expiry
       and strike = r.strike and type = r.type;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- succès
insert into public.badges (id, name, description, kind, rank, image, icon, auto, sort, level, title) values
  ('vendeur_primes', 'Vendeur de primes', 'Un premier call couvert ou put garanti par des liquidités vendu dans un portefeuille fictif.', 'achievement', 0, null, 'option', true, 137, 1, null),
  ('ordre_limite', 'Patience récompensée', 'Un premier ordre à cours limité exécuté.', 'achievement', 0, null, 'compass', true, 138, 1, null)
on conflict (id) do update set name = excluded.name, description = excluded.description, icon = excluded.icon,
  sort = excluded.sort, level = excluded.level, title = excluded.title;

create or replace function public.option_trades_badges() returns trigger
language plpgsql security definer set search_path = public as $$
declare cost numeric; proceeds numeric; open_q int;
begin
  if new.side = 'buy' then
    perform public._award(new.user_id, 'premier_contrat');
  else
    select sum(case when side = 'buy' then qty * price else 0 end), sum(case when side <> 'buy' then qty * price else 0 end),
           sum(case when side = 'buy' then qty else -qty end)
      into cost, proceeds, open_q
      from public.option_trades where portfolio_id = new.portfolio_id and ticker = new.ticker and expiry = new.expiry
        and strike = new.strike and type = new.type;
    if new.side = 'sell' and open_q < 0 then
      perform public._award(new.user_id, 'vendeur_primes');
    end if;
    if open_q = 0 and cost > 0 and proceeds >= 2 * cost then
      perform public._award(new.user_id, 'levier_gagnant');
    end if;
  end if;
  return null;
end $$;

create or replace function public.trades_limit_badge() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.orders where id = new.order_id and order_type = 'limit') then
    perform public._award(new.user_id, 'ordre_limite');
  end if;
  return null;
end $$;
drop trigger if exists trades_limit_badge on public.trades;
create trigger trades_limit_badge after insert on public.trades
for each row execute function public.trades_limit_badge();

-- ---------------------------------------------------------------- droits
revoke all on function public._shares(uuid, text) from public, anon, authenticated;
revoke all on function public._short_calls(uuid, text) from public, anon, authenticated;
revoke all on function public._reserved_cash(uuid) from public, anon, authenticated;
revoke all on function public.place_order(uuid, text, text, numeric, text, numeric) from public, anon;
revoke all on function public.fill_order(bigint, numeric, date, numeric, jsonb) from public, anon, authenticated;
revoke all on function public.expire_order(bigint, text) from public, anon, authenticated;
revoke all on function public.trades_limit_badge() from public, anon, authenticated;
grant execute on function public.place_order(uuid, text, text, numeric, text, numeric) to authenticated;
grant execute on function public.fill_order(bigint, numeric, date, numeric, jsonb) to service_role;
grant execute on function public.expire_order(bigint, text) to service_role;
grant execute on function public.place_option_order(uuid, text, date, numeric, text, text, int) to authenticated;
grant execute on function public.fill_option_order(bigint, numeric, date) to service_role;
grant execute on function public.settle_expired_options(text, date, numeric) to service_role;
