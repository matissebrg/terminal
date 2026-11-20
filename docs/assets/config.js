/* Espace membres (Supabase). Ces deux valeurs sont PUBLIQUES par conception : la sécurité repose
 * sur les règles de la base (RLS), pas sur leur secret. Ne jamais mettre ici la clé « secret / service_role ». */
window.ARCHER_CONFIG = {
  supabaseUrl: "https://mllsjapbscljfcopgdor.supabase.co",
  supabaseKey: "sb_publishable_LqrqxQeiAieM4wbqCmYMPg_mvCYyRqz",
};

/* Mangrove : périmètre du terminal (santé : pharma et biotech).
 * - focusFamilies : familles de config/universe.yaml affichées (« sante »).
 * - focusExtra    : valeurs hors famille gardées quand même (Veeva : logiciels pour les laboratoires).
 * - benchmarks    : indices affichés (S&P 500, biotech, santé ; logiciels pour Veeva).
 * - comingSoon    : valeurs annoncées, pas encore couvertes (fiche « bientôt »).
 * - comparablesSoon : les comparables boursiers sont en préparation (onglet Secteur, tableaux de multiples).
 * Les valeurs hors périmètre (NVDA, WMT…) restent calculées par le pipeline : les prédictions déjà ouvertes
 * dessus continuent d'être notées. Elles sont seulement retirées de l'affichage. */
window.MANGROVE = {
  focusFamilies: ["sante"],
  focusExtra: ["VEEV"],
  benchmarks: ["SPY", "IBB", "XLV", "XSW"],
  comingSoon: [
    { ticker: "SNY", name: "Sanofi", note: "Grande pharma française, cotée à Paris et en ADR à New York." },
    { ticker: "REGN", name: "Regeneron Pharmaceuticals", note: "Biotech commerciale (immunologie, ophtalmologie, oncologie)." },
  ],
  comparablesSoon: true,
};
