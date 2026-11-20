/* Mangrove : les valeurs de la bibliothèque, par racine.
   « Suivi complet » ou « comparable » ne se règle pas ici : c'est le pipeline qui décide
   (une valeur de config/universe.yaml a ses comptes trimestriels ; les autres sont lues comme pairs).
   root : la racine où la tuile pousse ; focus : une ligne, en tes mots. */
window.MG_ROOTS = [
  { name: 'Pharma', color: '#46E3C8' },
  { name: 'Logiciels santé', color: '#A9B7FF' },
  { name: 'Référence', color: '#F2B544' }
];
window.MG_COVERAGE = [
  { ticker: 'SNY', name: 'Sanofi', root: 'Pharma', focus: 'Immunologie, vaccins' },
  { ticker: 'LLY', name: 'Eli Lilly', root: 'Pharma', focus: 'Diabète, obésité' },
  { ticker: 'NVO', name: 'Novo Nordisk', root: 'Pharma', focus: 'Diabète, obésité' },
  { ticker: 'AZN', name: 'AstraZeneca', root: 'Pharma', focus: 'Oncologie, maladies rares' },
  { ticker: 'MRK', name: 'Merck & Co.', root: 'Pharma', focus: 'Oncologie, vaccins' },
  { ticker: 'VEEV', name: 'Veeva Systems', root: 'Logiciels santé', focus: 'Logiciels cloud des laboratoires' },
  { ticker: 'XLV', name: 'Health Care Select Sector SPDR', root: 'Référence', focus: 'ETF santé du S&P 500', etf: true }
];
