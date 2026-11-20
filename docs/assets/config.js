/* Mangrove : réglages du site.
 * supabaseUrl / supabaseKey : espace membres. Ces deux valeurs sont PUBLIQUES par conception : la sécurité repose
 *   sur les règles de la base (RLS), pas sur leur secret. Ne jamais mettre ici la clé « secret / service_role ».
 * comingSoon      : valeurs annoncées, pas encore couvertes (fiche « bientôt », barre latérale, recherche).
 * comparablesSoon : comparables boursiers en préparation (onglet Secteur, tableaux de multiples). Mettre false
 *                   pour les réafficher.
 * Les valeurs couvertes, elles, se déclarent dans config/universe.yaml. */
window.MANGROVE = {
  supabaseUrl: "https://mllsjapbscljfcopgdor.supabase.co",
  supabaseKey: "sb_publishable_LqrqxQeiAieM4wbqCmYMPg_mvCYyRqz",
  comingSoon: [
    { ticker: "SNY", name: "Sanofi", note: "Grande pharma française, cotée à Paris et en ADR à New York." },
    { ticker: "REGN", name: "Regeneron Pharmaceuticals", note: "Biotech commerciale (immunologie, ophtalmologie, oncologie)." },
  ],
  comparablesSoon: true,
};
