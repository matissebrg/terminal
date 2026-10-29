-- ============================================================================
-- Archer Terminal · succès : Archer, Visionnaire, renommages, Sharpe, secteurs, ancienneté
--
--  * Archer (bronze)       : inscrit sur la plateforme.
--  * Visionnaire (or)      : l'un des 10 premiers inscrits.
--  * Maître du Sharpe (or) : ratio de Sharpe annualisé >= 2 sur 90 jours (au moins 55 séances),
--                            portefeuille investi à au moins 50 % en moyenne. Sur 30 jours (~21 séances)
--                            l'erreur type d'un Sharpe annualisé est d'environ 3,5 : pure chance.
--  * Secteurs (bronze)     : une prédiction ou une position sur une valeur du secteur ;
--                            Touche-à-tout (argent) : 3 secteurs différents.
--  * Ancienneté            : 1 mois, 6 mois (bronze), 1 an (argent), 2 ans (or), 5 et 10 ans (platine).
-- ============================================================================

-- ---------------------------------------------------------------- secteur de chaque valeur
alter table public.latest_prices add column if not exists family text;   -- rempli par le pipeline (universe.yaml)

-- ---------------------------------------------------------------- catalogue
insert into public.badges (id, name, description, kind, rank, image, icon, auto, sort, level, title) values
  ('archer', 'Archer', 'Inscrit sur la plateforme Archer.', 'achievement', 0, null, 'archer', true, 90, 1, null),
  ('visionnaire', 'Visionnaire', 'L''un des 10 premiers inscrits sur la plateforme Archer.', 'achievement', 0, null, 'telescope', true, 370, 3, 'Visionnaire'),
  ('maitre_sharpe', 'Maître du Sharpe', 'Un portefeuille avec un ratio de Sharpe annualisé d''au moins 2 sur 90 jours (au moins 55 séances, investi à 50 % ou plus).', 'achievement', 0, null, 'sigma', true, 365, 3, 'Maître du Sharpe'),
  ('secteur_tech', 'Adepte de la tech', 'Une prédiction ou une position sur une valeur technologique.', 'achievement', 0, null, 'chip', true, 150, 1, null),
  ('secteur_conso', 'Adepte de la consommation', 'Une prédiction ou une position sur une valeur de la consommation ou de la distribution.', 'achievement', 0, null, 'cart', true, 151, 1, null),
  ('secteur_sante', 'Adepte de la santé', 'Une prédiction ou une position sur une valeur de la santé.', 'achievement', 0, null, 'health', true, 152, 1, null),
  ('secteur_finance', 'Adepte de la finance', 'Une prédiction ou une position sur une valeur financière.', 'achievement', 0, null, 'coin', true, 153, 1, null),
  ('secteur_energie', 'Adepte de l''énergie', 'Une prédiction ou une position sur une valeur de l''énergie ou des services aux collectivités.', 'achievement', 0, null, 'drop', true, 154, 1, null),
  ('secteur_industrie', 'Adepte de l''industrie', 'Une prédiction ou une position sur une valeur industrielle.', 'achievement', 0, null, 'factory', true, 155, 1, null),
  ('touche_a_tout', 'Touche-à-tout', 'Des prédictions ou des positions dans au moins 3 secteurs différents.', 'achievement', 0, null, 'compass', true, 280, 2, 'Touche-à-tout'),
  ('anciennete_1m', 'Un mois', 'Membre depuis un mois.', 'achievement', 0, null, 'hourglass', true, 160, 1, null),
  ('anciennete_6m', 'Six mois', 'Membre depuis six mois.', 'achievement', 0, null, 'hourglass', true, 161, 1, null),
  ('anciennete_1a', 'Un an', 'Membre depuis un an.', 'achievement', 0, null, 'hourglass', true, 290, 2, 'Habitué'),
  ('anciennete_2a', 'Deux ans', 'Membre depuis deux ans.', 'achievement', 0, null, 'hourglass', true, 380, 3, 'Vétéran'),
  ('anciennete_5a', 'Cinq ans', 'Membre depuis cinq ans.', 'achievement', 0, null, 'hourglass', true, 460, 4, 'Pilier'),
  ('anciennete_10a', 'Dix ans', 'Membre depuis dix ans.', 'achievement', 0, null, 'hourglass', true, 470, 4, 'Légende')
on conflict (id) do update set name = excluded.name, description = excluded.description, icon = excluded.icon,
  sort = excluded.sort, level = excluded.level, title = excluded.title;

update public.badges set name = 'Premiers pas' where id = 'premier_ordre';
update public.badges set name = 'Écrivain' where id = 'raisonnement';
update public.badges set name = 'Analyste polyvalent' where id = 'analyste_complet';
update public.badges set name = 'Multi-casquettes', description = 'Des prédictions sur au moins trois valeurs différentes.'
 where id = 'multi_valeurs';
update public.badges set name = 'TOP prédicteur', title = 'TOP prédicteur' where id = 'bat_la_foule';
update public.badges set title = 'Générateur d''alpha' where id = 'alpha';
update public.badges set title = 'Chirurgien du CA' where id = 'chirurgien';

-- ---------------------------------------------------------------- adhésion : Archer, Visionnaire
create or replace function public.profiles_badges() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._award(new.id, 'members');
  perform public._award(new.id, 'archer');
  if (select count(*) from public.profiles where created_at <= new.created_at) <= 10 then
    perform public._award(new.id, 'visionnaire');
  end if;
  if new.is_admin or (select count(*) from public.profiles where created_at <= new.created_at) <= 10 then
    perform public._award(new.id, 'founders');
  end if;
  return null;
end $$;

-- secteurs touchés par un membre (prédictions + positions)
create or replace function public._sector_badges(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare f text; n int;
begin
  for f in
    select distinct lp.family from public.latest_prices lp
    where lp.family in ('tech', 'conso', 'sante', 'finance', 'energie', 'industrie')
      and (lp.ticker in (select ticker from public.predictions where user_id = p_user)
           or lp.ticker in (select ticker from public.trades where user_id = p_user and side = 'buy'))
  loop
    perform public._award(p_user, 'secteur_' || f);
  end loop;
  select count(distinct lp.family) into n from public.latest_prices lp
   where lp.family is not null
     and (lp.ticker in (select ticker from public.predictions where user_id = p_user)
          or lp.ticker in (select ticker from public.trades where user_id = p_user and side = 'buy'));
  if n >= 3 then perform public._award(p_user, 'touche_a_tout'); end if;
end $$;
revoke all on function public._sector_badges(uuid) from public, anon, authenticated;

-- prédictions : Multi-casquettes passe à 3 valeurs ; secteurs immédiats
create or replace function public.predictions_badges() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._award(new.user_id, 'premier_tir');
  if char_length(coalesce(new.note, '')) >= 200 then
    perform public._award(new.user_id, 'raisonnement');
  end if;
  if (select count(distinct ticker) from public.predictions where user_id = new.user_id) >= 3 then
    perform public._award(new.user_id, 'multi_valeurs');
  end if;
  if (select count(*) from jsonb_each(new.metrics) m
      where m.key in ('revenue', 'gross_margin', 'operating_income', 'operating_margin', 'net_income', 'eps_diluted', 'fcf')
        and jsonb_typeof(m.value -> 'low') = 'number' and jsonb_typeof(m.value -> 'high') = 'number') = 7 then
    perform public._award(new.user_id, 'analyste_complet');
  end if;
  perform public._sector_badges(new.user_id);
  return null;
end $$;

create or replace function public.trades_badges() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._award(new.user_id, 'premier_ordre');
  perform public._sector_badges(new.user_id);
  return null;
end $$;

-- ---------------------------------------------------------------- calcul quotidien (pipeline)
alter function public.grant_auto_badges() rename to _grant_auto_badges_core;
revoke all on function public._grant_auto_badges_core() from public, anon, authenticated;

create or replace function public.grant_auto_badges() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  n := public._grant_auto_badges_core();
  for r in
    with rets as (
      select v.portfolio_id, v.date, v.value, v.cash,
             v.value / nullif(lag(v.value) over (partition by v.portfolio_id order by v.date), 0) - 1 as ret
      from public.portfolio_values v
      where v.date >= current_date - 90),
    sharpe as (
      select portfolio_id, count(ret) as n, max(date) - min(date) as span,
             avg(ret) as mu, stddev_samp(ret) as sd, avg(case when value > 0 then 1 - cash / value end) as invested
      from rets group by portfolio_id)
    select pf.user_id, 'maitre_sharpe' as b from sharpe s join public.portfolios pf on pf.id = s.portfolio_id
      where s.n >= 55 and s.span >= 80 and s.sd > 0 and s.invested >= 0.5
        and (s.mu - 0.04 / 252) / s.sd * sqrt(252) >= 2
    union select id, 'archer' from public.profiles
    union select id, 'anciennete_1m' from public.profiles where created_at <= now() - interval '1 month'
    union select id, 'anciennete_6m' from public.profiles where created_at <= now() - interval '6 months'
    union select id, 'anciennete_1a' from public.profiles where created_at <= now() - interval '1 year'
    union select id, 'anciennete_2a' from public.profiles where created_at <= now() - interval '2 years'
    union select id, 'anciennete_5a' from public.profiles where created_at <= now() - interval '5 years'
    union select id, 'anciennete_10a' from public.profiles where created_at <= now() - interval '10 years'
  loop
    if public._award(r.user_id, r.b) then n := n + 1; end if;
  end loop;
  perform public._sector_badges(id) from public.profiles;
  return n;
end $$;
revoke all on function public.grant_auto_badges() from public, anon, authenticated;
grant execute on function public.grant_auto_badges() to service_role;

-- ---------------------------------------------------------------- membres déjà inscrits
select public._award(id, 'archer') from public.profiles;
select public._award(id, 'visionnaire') from public.profiles
 where id in (select id from public.profiles order by created_at limit 10);
