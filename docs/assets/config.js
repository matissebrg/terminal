/* Mangrove : réglages du site.
 * repo        : le dépôt GitHub où « Enregistrer sur GitHub » crée les fichiers de prédiction.
 * publicSite  : l'adresse du site en ligne. La copie privée, ouverte depuis ton disque (file://), y lit les
 *               données de marché publiques ; elle n'y envoie rien.
 * supabaseUrl / supabaseKey : base de l'ancien espace membres, encore lue par le pipeline (pipeline/community.py).
 *               Ces deux valeurs sont PUBLIQUES par conception : la sécurité repose sur les règles de la base (RLS).
 *               Ne jamais mettre ici la clé « secret / service_role ».
 * Les valeurs suivies se déclarent dans config/universe.yaml, la bibliothèque dans library/. */
window.MANGROVE = {
  repo: "matissebrg/terminal",
  publicSite: "https://matissebrg.github.io/terminal/",
  supabaseUrl: "https://mllsjapbscljfcopgdor.supabase.co",
  supabaseKey: "sb_publishable_LqrqxQeiAieM4wbqCmYMPg_mvCYyRqz",
};
