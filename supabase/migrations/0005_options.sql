-- ============================================================================
-- Archer Terminal · options dans les portefeuilles fictifs
--
--  * Cotations : relevées par le pipeline à chaque mise à jour (Yahoo, différées). Le relevé du
--    soir (après 16:00 New York) sert à exécuter les ordres.
--  * Ordres exécutés à la CLÔTURE SUIVANTE, comme les actions : achat au prix demandé (ask), vente
--    au prix offert (bid). L'écart est un vrai coût.
--  * Positions ACHETEUSES uniquement : achat d'options, revente ou dénouement. Pas de vente à
--    découvert (elle demanderait des règles de marge).
--  * À l'échéance : dénouement en espèces à la valeur intrinsèque (cours de clôture du sous-jacent).
--  * 1 contrat = 100 actions.
-- ============================================================================

create table if not exists public.option_quotes (
  ticker text not null,
  expiry date not null,
  strike numeric not null,
  type text not null check (type in ('C', 'P')),
  bid numeric,
  ask numeric,
  mid numeric,
  iv numeric,
  underlying numeric,
  quote_date date not null,           -- séance de cotation (New York)
  quoted_at timestamptz not null default now(),
  evening boolean not null default false,
  primary key (ticker, expiry, strike, type)
);
alter table public.option_quotes enable row level security;

create table if not exists public.option_orders (
  id bigserial primary key,
  portfolio_id uuid not null references public.portfolios (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  ticker text not null,
  expiry date not null,
  strike numeric not null,
  type text not null check (type in ('C', 'P')),
  side text not null check (side in ('buy', 'sell')),
  qty int not null check (qty between 1 and 100),
  status text not null default 'pending' check (status in ('pending', 'filled', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  filled_at timestamptz,
  fill_price numeric,
  fill_date date,
  reason text
);
create index if not exists option_orders_pending on public.option_orders (status) where status = 'pending';
alter table public.option_orders enable row level security;

create table if not exists public.option_trades (
  id bigserial primary key,
  order_id bigint references public.option_orders (id) on delete set null,
  portfolio_id uuid not null references public.portfolios (id) on delete cascade,
  user_id uuid not null,
  ticker text not null,
  expiry date not null,
  strike numeric not null,
  type text not null check (type in ('C', 'P')),
  side text not null check (side in ('buy', 'sell', 'expire')),
  qty int not null,
  price numeric not null,             -- par action (prime) ; « expire » : valeur intrinsèque
  trade_date date not null,
  executed_at timestamptz not null default now()
);
alter table public.option_trades enable row level security;

-- contrats détenus dans un portefeuille
create or replace function public._option_position(p_portfolio uuid, p_ticker text, p_expiry date, p_strike numeric, p_type text)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when side = 'buy' then qty else -qty end), 0)::int from public.option_trades
  where portfolio_id = p_portfolio and ticker = p_ticker and expiry = p_expiry and strike = p_strike and type = p_type
$$;
revoke all on function public._option_position(uuid, text, date, numeric, text) from public, anon, authenticated;

create or replace function public.place_option_order(p_portfolio uuid, p_ticker text, p_expiry date, p_strike numeric,
                                                     p_type text, p_side text, p_qty int)
returns public.option_orders
language plpgsql security definer set search_path = public as $$
declare v public.option_orders; held int; pending int;
begin
  if not public.is_member() then raise exception 'Réservé aux membres.'; end if;
  if not exists (select 1 from public.portfolios where id = p_portfolio and user_id = auth.uid()) then
    raise exception 'Portefeuille introuvable.';
  end if;
  if p_type not in ('C', 'P') or p_side not in ('buy', 'sell') then raise exception 'Ordre invalide.'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 100 then raise exception 'Quantité : de 1 à 100 contrats.'; end if;
  if not exists (select 1 from public.option_quotes where ticker = upper(p_ticker) and expiry = p_expiry
                 and strike = p_strike and type = p_type) then
    raise exception 'Contrat non coté : % % % %', upper(p_ticker), p_expiry, p_strike, p_type;
  end if;
  if p_expiry <= (now() at time zone 'America/New_York')::date then
    raise exception 'Ce contrat arrive à échéance : choisis une échéance plus lointaine.';
  end if;
  if p_side = 'sell' then
    held := public._option_position(p_portfolio, upper(p_ticker), p_expiry, p_strike, p_type);
    select coalesce(sum(qty), 0) into pending from public.option_orders
     where portfolio_id = p_portfolio and status = 'pending' and side = 'sell' and ticker = upper(p_ticker)
       and expiry = p_expiry and strike = p_strike and type = p_type;
    if held - pending < p_qty then
      raise exception 'Vente impossible : seulement % contrat(s) détenu(s) (pas de vente à découvert).', held - pending;
    end if;
  end if;
  if (select count(*) from public.option_orders where user_id = auth.uid() and status = 'pending') >= 30 then
    raise exception 'Trop d''ordres d''options en attente.';
  end if;
  insert into public.option_orders (portfolio_id, user_id, ticker, expiry, strike, type, side, qty)
  values (p_portfolio, auth.uid(), upper(p_ticker), p_expiry, p_strike, p_type, p_side, p_qty)
  returning * into v;
  return v;
end $$;

create or replace function public.cancel_option_order(p_order bigint) returns public.option_orders
language plpgsql security definer set search_path = public as $$
declare v public.option_orders;
begin
  update public.option_orders set status = 'cancelled', reason = 'annulé par le membre'
  where id = p_order and user_id = auth.uid() and status = 'pending' returning * into v;
  if v.id is null then raise exception 'Ordre introuvable ou déjà exécuté.'; end if;
  return v;
end $$;

-- exécution par le pipeline (rôle service) : prix par action, déjà choisi (ask à l'achat, bid à la vente)
create or replace function public.fill_option_order(p_order bigint, p_price numeric, p_date date) returns public.option_orders
language plpgsql security definer set search_path = public as $$
declare o public.option_orders; pf public.portfolios; cost numeric; held int;
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
  if o.side = 'buy' then
    if pf.cash < cost then
      update public.option_orders set status = 'rejected', reason = 'liquidités insuffisantes', fill_price = p_price,
             fill_date = p_date, filled_at = now() where id = o.id returning * into o;
      return o;
    end if;
    update public.portfolios set cash = cash - cost where id = pf.id;
  else
    held := public._option_position(pf.id, o.ticker, o.expiry, o.strike, o.type);
    if held < o.qty then
      update public.option_orders set status = 'rejected', reason = 'position insuffisante', fill_price = p_price,
             fill_date = p_date, filled_at = now() where id = o.id returning * into o;
      return o;
    end if;
    update public.portfolios set cash = cash + cost where id = pf.id;
  end if;
  insert into public.option_trades (order_id, portfolio_id, user_id, ticker, expiry, strike, type, side, qty, price, trade_date)
  values (o.id, pf.id, o.user_id, o.ticker, o.expiry, o.strike, o.type, o.side, o.qty, p_price, p_date);
  update public.option_orders set status = 'filled', fill_price = p_price, fill_date = p_date, filled_at = now()
   where id = o.id returning * into o;
  return o;
end $$;

-- dénouement à l'échéance (rôle service) : valeur intrinsèque au cours de clôture du sous-jacent
create or replace function public.settle_expired_options(p_ticker text, p_expiry date, p_underlying numeric) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; intrinsic numeric;
begin
  for r in
    select portfolio_id, user_id, strike, type, sum(case when side = 'buy' then qty else -qty end)::int as q
    from public.option_trades where ticker = p_ticker and expiry = p_expiry
    group by portfolio_id, user_id, strike, type having sum(case when side = 'buy' then qty else -qty end) > 0
  loop
    intrinsic := greatest(0, case when r.type = 'C' then p_underlying - r.strike else r.strike - p_underlying end);
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

-- ---------------------------------------------------------------- succès liés aux options
insert into public.badges (id, name, description, kind, rank, image, icon, auto, sort, level, title) values
  ('premier_contrat', 'Premier contrat', 'Un premier contrat d''option exécuté dans un portefeuille fictif.', 'achievement', 0, null, 'option', true, 135, 1, null),
  ('levier_gagnant', 'Levier gagnant', 'Une position d''options soldée (revente ou échéance) avec un gain d''au moins 100 %.', 'achievement', 0, null, 'lever', true, 385, 3, 'Maître du levier')
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
    if open_q = 0 and cost > 0 and proceeds >= 2 * cost then
      perform public._award(new.user_id, 'levier_gagnant');
    end if;
  end if;
  return null;
end $$;
drop trigger if exists option_trades_badges on public.option_trades;
create trigger option_trades_badges after insert on public.option_trades
for each row execute function public.option_trades_badges();

-- ---------------------------------------------------------------- RLS et droits
drop policy if exists option_quotes_read on public.option_quotes;
create policy option_quotes_read on public.option_quotes for select to authenticated using (public.is_member());
drop policy if exists option_orders_read on public.option_orders;
create policy option_orders_read on public.option_orders for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists option_trades_read on public.option_trades;
create policy option_trades_read on public.option_trades for select to authenticated using (
  exists (select 1 from public.portfolios p where p.id = option_trades.portfolio_id));   -- hérite de portfolios_read

grant select, insert, update, delete on public.option_quotes, public.option_orders, public.option_trades to service_role;
grant usage, select on all sequences in schema public to service_role;
grant select on public.option_quotes, public.option_orders, public.option_trades to authenticated;
revoke all on public.option_quotes, public.option_orders, public.option_trades from anon;

revoke all on function public.place_option_order(uuid, text, date, numeric, text, text, int) from public, anon;
revoke all on function public.cancel_option_order(bigint) from public, anon;
revoke all on function public.fill_option_order(bigint, numeric, date) from public, anon, authenticated;
revoke all on function public.settle_expired_options(text, date, numeric) from public, anon, authenticated;
grant execute on function public.place_option_order(uuid, text, date, numeric, text, text, int) to authenticated;
grant execute on function public.cancel_option_order(bigint) to authenticated;
grant execute on function public.fill_option_order(bigint, numeric, date) to service_role;
grant execute on function public.settle_expired_options(text, date, numeric) to service_role;
