/* Mangrove : catalyseurs datés que le pipeline ne voit pas (décisions FDA, lectures d'essais, congrès,
   résultats des émetteurs étrangers). Les dates de résultats des valeurs suivies viennent du pipeline.
   kind : Réglementaire, Essai, Congrès ou Résultats ; confidence : 'confirmed' (date annoncée) ou 'estimated'.
   source : lien vers l'annonce, pour pouvoir la revérifier. Relevé du 20 novembre 2026. */
window.MG_CATALYSTS = [
  { date: '2027-01-28', ticker: 'SNY', kind: 'Résultats', confidence: 'confirmed',
    description: 'Résultats du quatrième trimestre et de l’année 2026, commentés en webcast.',
    source: 'https://www.sanofi.com/fr/investisseurs/resultats-et-evenements/resultats-financiers/resultats-T2-2015' },
  { date: '2027-02-03', ticker: 'NVO', kind: 'Résultats', confidence: 'estimated',
    description: 'Résultats annuels 2026. Date non publiée par la société : les calendriers tiers donnent du 2 au 4 février.',
    source: 'https://www.marketscreener.com/quote/stock/NOVO-NORDISK-A-S-1412980/calendar/' },
  { date: '2027-02-11', ticker: 'AZN', kind: 'Résultats', confidence: 'estimated',
    description: 'Résultats annuels et du quatrième trimestre 2026. Date projetée par MarketScreener, pas encore annoncée (10 février l’an dernier).',
    source: 'https://in.marketscreener.com/quote/stock/ASTRAZENECA-PLC-4000930/calendar/' },
  { date: '2027-04-23', ticker: 'SNY', kind: 'Résultats', confidence: 'confirmed',
    description: 'Résultats du premier trimestre 2027, commentés en webcast.',
    source: 'https://www.sanofi.com/fr/investisseurs/resultats-et-evenements/resultats-financiers/resultats-T2-2015' }
];
