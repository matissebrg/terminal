-- Mangrove Terminal · changement de nom (anciennement Archer Terminal)
-- Ne change que ce que les membres lisent : noms et descriptions des badges, titres des notifications déjà reçues,
-- préfixe des nouveaux codes d'invitation. Les identifiants internes (badge « archer », table archer_migrations)
-- restent tels quels : ils sont référencés par les déclencheurs et par l'historique des migrations.

update public.badges set name = 'Racine', description = 'Inscrit sur Mangrove.', icon = 'roots' where id = 'archer';
update public.badges set description = 'L''un des 10 premiers inscrits sur Mangrove.' where id = 'visionnaire';
update public.badges set description = 'A aidé à construire Mangrove : retours, bugs, idées. Attribué par un administrateur.' where id = 'supporter';
update public.badges set description = 'Membre de la bêta Mangrove Terminal.' where id = 'members';

update public.notifications set title = replace(title, 'Nouveau badge : Archer', 'Nouveau badge : Racine')
  where title like '%Nouveau badge : Archer%';

create or replace function public.create_invite(p_max_uses int default 1, p_days int default 30, p_note text default null)
returns public.invite_codes
language plpgsql security definer set search_path = public as $$
declare v public.invite_codes;
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs.'; end if;
  insert into public.invite_codes (code, max_uses, expires_at, note, created_by)
  values ('MANGROVE-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
          greatest(1, least(coalesce(p_max_uses, 1), 200)),
          case when p_days is null or p_days <= 0 then null else now() + make_interval(days => p_days) end,
          p_note, auth.uid())
  returning * into v;
  return v;
end $$;
