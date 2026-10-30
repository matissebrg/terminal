-- ============================================================================
-- Archer Terminal · prédictions de catalyseurs biotech (décisions FDA, résultats d'essais)
--
--  * Les catalyseurs viennent du pipeline (config/assumptions/<T>.yaml, bloc catalysts), avec la
--    probabilité historique de l'étape (p_base) et celle qu'implique le cours (p_market).
--  * Chaque membre donne SA probabilité de succès avant la date limite : 00:00 New York le jour de
--    l'événement. Les prédictions des autres et la moyenne du groupe restent cachées tant qu'on n'a
--    pas donné la sienne (pas d'ancrage), puis visibles à la clôture.
--  * Score de Brier (p - issue)², 0 = parfait ; comparé à celui du taux historique : battre la base,
--    c'est apporter une information que les statistiques n'ont pas.
-- ============================================================================

create table if not exists public.catalysts (
  id text primary key,
  ticker text not null,
  asset text,
  kind text not null,
  title text,
  event_date date not null,
  deadline timestamptz not null,
  p_base numeric,
  p_model numeric,
  p_market numeric,
  confirmed boolean not null default false,
  outcome text check (outcome in ('success', 'failure', 'mixed')),
  resolved_at timestamptz,
  source text,
  updated_at timestamptz not null default now()
);
alter table public.catalysts enable row level security;

create table if not exists public.catalyst_predictions (
  user_id uuid not null references public.profiles (id) on delete cascade,
  catalyst_id text not null references public.catalysts (id) on delete cascade,
  p numeric not null check (p >= 0.01 and p <= 0.99),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, catalyst_id)
);
alter table public.catalyst_predictions enable row level security;

-- ---------------------------------------------------------------- écrire / retirer sa prédiction
create or replace function public.predict_catalyst(p_catalyst text, p_prob numeric, p_note text default null)
returns public.catalyst_predictions
language plpgsql security definer set search_path = public as $$
declare c public.catalysts; v public.catalyst_predictions;
begin
  if not public.is_member() then raise exception 'réservé aux membres'; end if;
  select * into c from public.catalysts where id = p_catalyst;
  if not found then raise exception 'catalyseur inconnu'; end if;
  if c.outcome is not null or now() >= c.deadline then raise exception 'prédictions closes pour cet événement'; end if;
  if p_prob is null or p_prob < 0.01 or p_prob > 0.99 then raise exception 'probabilité entre 1 %% et 99 %%'; end if;
  insert into public.catalyst_predictions (user_id, catalyst_id, p, note)
  values (auth.uid(), p_catalyst, round(p_prob, 3), nullif(trim(p_note), ''))
  on conflict (user_id, catalyst_id) do update set p = excluded.p, note = excluded.note, updated_at = now()
  returning * into v;
  perform public._award(auth.uid(), 'premier_pari_clinique');
  return v;
end $$;

create or replace function public.delete_catalyst_prediction(p_catalyst text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.catalysts where id = p_catalyst and (outcome is not null or now() >= deadline)) then
    raise exception 'prédictions closes pour cet événement';
  end if;
  delete from public.catalyst_predictions where user_id = auth.uid() and catalyst_id = p_catalyst;
end $$;

-- ---------------------------------------------------------------- consensus du groupe (anti-ancrage)
create or replace function public.catalyst_crowd(p_catalyst text)
returns table (n int, mean numeric, median numeric, visible boolean)
language plpgsql stable security definer set search_path = public as $$
declare open_ boolean; mine boolean;
begin
  if not public.is_member() then raise exception 'réservé aux membres'; end if;
  select (outcome is null and now() < deadline) into open_ from public.catalysts where id = p_catalyst;
  select exists (select 1 from public.catalyst_predictions where catalyst_id = p_catalyst and user_id = auth.uid()) into mine;
  return query
    select count(*)::int,
           case when mine or not coalesce(open_, true) then round(avg(cp.p), 3) end,
           case when mine or not coalesce(open_, true) then round((percentile_cont(0.5) within group (order by cp.p))::numeric, 3) end,
           (mine or not coalesce(open_, true))
    from public.catalyst_predictions cp where cp.catalyst_id = p_catalyst;
end $$;

-- ---------------------------------------------------------------- classement (Brier vs taux historique)
create or replace function public.catalyst_scores()
returns table (username text, n int, brier numeric, base_brier numeric, skill numeric)
language sql stable security definer set search_path = public as $$
  select pr.username, count(*)::int,
         round(avg(power(cp.p - (c.outcome = 'success')::int, 2)), 4),
         round(avg(power(coalesce(c.p_base, 0.5) - (c.outcome = 'success')::int, 2)), 4),
         round(1 - avg(power(cp.p - (c.outcome = 'success')::int, 2))
                   / nullif(avg(power(coalesce(c.p_base, 0.5) - (c.outcome = 'success')::int, 2)), 0), 3)
  from public.catalyst_predictions cp
  join public.catalysts c on c.id = cp.catalyst_id and c.outcome in ('success', 'failure')
  join public.profiles pr on pr.id = cp.user_id
  where public.is_member() and (pr.show_on_leaderboard or pr.id = auth.uid())
  group by pr.username
  order by 4 asc, 2 desc
$$;

-- ---------------------------------------------------------------- succès
insert into public.badges (id, name, description, kind, rank, image, icon, auto, sort, level, title) values
  ('premier_pari_clinique', 'Premier pari clinique', 'Une première probabilité donnée sur un catalyseur biotech (décision FDA, résultats d''essai).', 'achievement', 0, null, 'flask', true, 136, 1, null),
  ('contrarien_clinique', 'Contrarien clinique', 'A vu venir un échec : probabilité de 35 % ou moins sur un événement que l''histoire donnait gagnant à 60 % ou plus, et qui a échoué.', 'achievement', 0, null, 'flask', true, 286, 2, 'Contrarien'),
  ('oracle_clinique', 'Oracle clinique', 'Au moins 5 catalyseurs résolus avec un score de Brier moyen meilleur que celui des taux historiques.', 'achievement', 0, null, 'flask', true, 386, 3, 'Oracle clinique')
on conflict (id) do update set name = excluded.name, description = excluded.description, icon = excluded.icon,
  sort = excluded.sort, level = excluded.level, title = excluded.title;

create or replace function public.catalysts_resolved() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.outcome is null or new.outcome is not distinct from old.outcome then return null; end if;
  if new.outcome = 'failure' and coalesce(new.p_base, 0) >= 0.6 then
    for r in select user_id from public.catalyst_predictions where catalyst_id = new.id and p <= 0.35 loop
      perform public._award(r.user_id, 'contrarien_clinique');
    end loop;
  end if;
  for r in
    select cp.user_id from public.catalyst_predictions cp
    join public.catalysts c on c.id = cp.catalyst_id and c.outcome in ('success', 'failure')
    where cp.user_id in (select user_id from public.catalyst_predictions where catalyst_id = new.id)
    group by cp.user_id
    having count(*) >= 5
       and avg(power(cp.p - (c.outcome = 'success')::int, 2)) < avg(power(coalesce(c.p_base, 0.5) - (c.outcome = 'success')::int, 2))
  loop
    perform public._award(r.user_id, 'oracle_clinique');
  end loop;
  return null;
end $$;
drop trigger if exists catalysts_resolved on public.catalysts;
create trigger catalysts_resolved after update of outcome on public.catalysts
for each row execute function public.catalysts_resolved();

-- ---------------------------------------------------------------- RLS et droits
drop policy if exists catalysts_read on public.catalysts;
create policy catalysts_read on public.catalysts for select to authenticated using (public.is_member());
drop policy if exists catalyst_predictions_read on public.catalyst_predictions;
create policy catalyst_predictions_read on public.catalyst_predictions for select to authenticated using (
  user_id = (select auth.uid())
  or exists (select 1 from public.catalysts c where c.id = catalyst_predictions.catalyst_id
             and (c.outcome is not null or now() >= c.deadline)));

grant select, insert, update, delete on public.catalysts, public.catalyst_predictions to service_role;
grant select on public.catalysts, public.catalyst_predictions to authenticated;
revoke all on public.catalysts, public.catalyst_predictions from anon;

revoke all on function public.predict_catalyst(text, numeric, text) from public, anon;
revoke all on function public.delete_catalyst_prediction(text) from public, anon;
revoke all on function public.catalyst_crowd(text) from public, anon;
revoke all on function public.catalyst_scores() from public, anon;
revoke all on function public.catalysts_resolved() from public, anon, authenticated;
grant execute on function public.predict_catalyst(text, numeric, text) to authenticated;
grant execute on function public.delete_catalyst_prediction(text) to authenticated;
grant execute on function public.catalyst_crowd(text) to authenticated;
grant execute on function public.catalyst_scores() to authenticated;
