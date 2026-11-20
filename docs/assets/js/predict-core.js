/* Mangrove — prediction helpers with no DOM: reading the form values, checking them, writing the
   registry file (config/predictions/<TICKER>/*.yaml, schema in config/predictions/_modele.yaml) and
   formatting the scored records of data/predictions.json. Used by predict.js; tested under node
   (tests/js/predict_core.test.js). */
(function (root) {
  'use strict';

  /* metric keys the pipeline scores (pipeline/predictions.py, METRICS) and their units in the file */
  var METRICS = [
    { key: 'revenue', label: "Chiffre d'affaires", unit: 'Md$', kind: 'money' },
    { key: 'gross_margin', label: 'Marge brute', unit: '%', kind: 'margin' },
    { key: 'operating_income', label: 'Résultat opérationnel', unit: 'Md$', kind: 'money' },
    { key: 'operating_margin', label: 'Marge opérationnelle', unit: '%', kind: 'margin' },
    { key: 'net_income', label: 'Résultat net', unit: 'Md$', kind: 'money' },
    { key: 'eps_diluted', label: 'BPA dilué (GAAP)', unit: '$', kind: 'money' },
    { key: 'fcf', label: 'Free cash flow', unit: 'Md$', kind: 'money' }
  ];
  var BY_KEY = {};
  METRICS.forEach(function (m) { BY_KEY[m.key] = m; });

  /* "1,25" and " 1 250,5 " are numbers; empty is null; anything else is NaN */
  function num(s) {
    if (s == null) return null;
    var t = String(s).replace(/[\s  ]/g, '').replace(',', '.');
    if (t === '') return null;
    if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return NaN;
    return parseFloat(t);
  }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function quote(s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ') + '"'; }
  var PERIOD_RE = /^(Q[1-4] )?FY\d{4}$/;
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  /* d = { ticker, period, metrics: {key: {value, low, high}}, events: [{question, probability}],
           price: [{date, value, low, high}], note }  (strings straight from the form)
     opts = { today: 'YYYY-MM-DD', metricsAllowed: bool } */
  function validate(d, opts) {
    opts = opts || {};
    var errs = [];
    if (!d.ticker) errs.push('Choisis une valeur.');
    var keys = Object.keys(d.metrics || {});
    if (keys.length && opts.metricsAllowed === false) errs.push('Les résultats de ' + d.ticker + ' ne sont pas notés automatiquement : garde les objectifs de cours et les questions oui / non.');
    if (keys.length && !PERIOD_RE.test(String(d.period || '').trim())) errs.push('Période attendue au format « Q4 FY2026 » ou « FY2026 ».');
    keys.forEach(function (k) {
      var o = d.metrics[k], lab = (BY_KEY[k] || { label: k }).label;
      if (!BY_KEY[k]) { errs.push(lab + ' : indicateur inconnu.'); return; }
      var v = num(o.value), lo = num(o.low), hi = num(o.high);
      if ([v, lo, hi].some(function (x) { return x !== null && isNaN(x); })) { errs.push(lab + ' : nombre invalide.'); return; }
      if (v === null) errs.push(lab + ' : la prévision est vide.');
      if ((lo === null) !== (hi === null)) errs.push(lab + ' : donne le bas et le haut de l\'intervalle, ou aucun des deux.');
      if (lo !== null && hi !== null && lo > hi) errs.push(lab + ' : le bas dépasse le haut.');
      if (v !== null && lo !== null && v < lo) errs.push(lab + ' : la prévision est sous le bas de l\'intervalle.');
      if (v !== null && hi !== null && v > hi) errs.push(lab + ' : la prévision dépasse le haut de l\'intervalle.');
    });
    (d.events || []).forEach(function (e) {
      var p = num(e.probability);
      if (!String(e.question || '').trim()) errs.push('Une question oui / non n\'a pas de texte.');
      if (p === null || isNaN(p) || p < 0 || p > 100) errs.push('« ' + (String(e.question || '').trim() || '?') + ' » : probabilité entre 0 et 100 %.');
    });
    (d.price || []).forEach(function (p) {
      var v = num(p.value), lo = num(p.low), hi = num(p.high);
      if (!DATE_RE.test(String(p.date || ''))) errs.push('Objectif de cours : date manquante.');
      else if (opts.today && p.date <= opts.today) errs.push('Objectif de cours du ' + p.date + ' : choisis une date future.');
      if (v === null || isNaN(v) || v <= 0) errs.push('Objectif de cours : cours visé invalide.');
      if ([lo, hi].some(function (x) { return x !== null && isNaN(x); })) errs.push('Objectif de cours : intervalle invalide.');
      else if ((lo === null) !== (hi === null)) errs.push('Objectif de cours : donne le bas et le haut, ou aucun des deux.');
      else if (lo !== null && (lo > hi || (isNum(v) && (v < lo || v > hi)))) errs.push('Objectif de cours : le cours visé doit être dans l\'intervalle.');
    });
    if (!keys.length && !(d.events || []).length && !(d.price || []).length) errs.push('Rien à enregistrer : remplis au moins une prévision.');
    return errs;
  }

  function toYaml(d, now) {
    now = now || new Date();
    var tk = String(d.ticker).toUpperCase(), keys = Object.keys(d.metrics || {});
    var period = keys.length ? String(d.period).trim() : '';
    var y = '# Mangrove : prédiction ' + tk + (period ? ' ' + period : '') + '\n' +
      '# Écrite le ' + now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC. L\'heure du commit Git fait foi.\n' +
      'ticker: ' + tk + '\n';
    if (period) y += 'period: ' + period + '\n';
    if (keys.length) {
      y += 'metrics:   # Md$ pour les montants, % pour les marges, $ pour le BPA ; low / high = intervalle à 80 %\n';
      METRICS.forEach(function (m) {
        var o = d.metrics[m.key]; if (!o) return;
        var parts = ['value: ' + num(o.value)];
        if (num(o.low) !== null) parts.push('low: ' + num(o.low));
        if (num(o.high) !== null) parts.push('high: ' + num(o.high));
        y += '  ' + m.key + ': {' + parts.join(', ') + '}\n';
      });
    }
    if ((d.events || []).length) {
      y += 'events:    # probabilité en % ; après coup, remplace null par true ou false\n';
      d.events.forEach(function (e, i) {
        y += '  - {id: q' + (i + 1) + ', question: ' + quote(String(e.question).trim()) + ', probability: ' + num(e.probability) + ', outcome: null}\n';
      });
    }
    if ((d.price || []).length) {
      y += 'price:     # vérifié sur la clôture du jour visé\n';
      d.price.forEach(function (p) {
        y += '  - {date: ' + p.date + ', value: ' + num(p.value) + (num(p.low) !== null ? ', low: ' + num(p.low) + ', high: ' + num(p.high) : '') + '}\n';
      });
    }
    var note = String(d.note || '').trim();
    if (note) y += 'note: |\n' + note.split(/\r?\n/).map(function (l) { return '  ' + l; }).join('\n') + '\n';
    return y;
  }

  function fileName(d, now) {
    now = now || new Date();
    var stamp = now.toISOString().slice(0, 16).replace('T', '-').replace(':', '');
    var keys = Object.keys(d.metrics || {});
    var tail = keys.length && d.period ? String(d.period).trim().toLowerCase().replace(/\s+/g, '-') : 'cours-et-questions';
    return 'config/predictions/' + String(d.ticker).toUpperCase() + '/' + stamp + '-' + tail + '.yaml';
  }

  function newFileUrl(repo, fname, yaml) {
    return 'https://github.com/' + repo + '/new/main?filename=' + encodeURIComponent(fname) + '&value=' + encodeURIComponent(yaml);
  }

  /* ---- display of raw pipeline values (dollars, fractions) ---- */
  function fr(x, dec) {
    if (!isNum(x)) return '';
    var s = Math.abs(x).toFixed(dec).split('.');
    s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return (x < 0 ? '−' : '') + s.join(',');
  }
  /* unit 'Md$' (raw dollars), '%' (fraction), '$' (per share) -> text in the unit of the form */
  function show(raw, unit) {
    if (!isNum(raw)) return '';
    if (unit === 'Md$') return fr(raw / 1e9, 2) + ' Md$';
    if (unit === '%') return fr(raw * 100, 1) + ' %';
    return fr(raw, 2) + ' $';
  }
  /* the same number as the form expects it (no unit), for the reference columns */
  function formValue(raw, unit) {
    if (!isNum(raw)) return '';
    if (unit === 'Md$') return fr(raw / 1e9, 2);
    if (unit === '%') return fr(raw * 100, 1);
    return fr(raw, 2);
  }
  function signedPct(x, dec) { return isNum(x) ? (x > 0 ? '+' : '') + fr(x * 100, dec == null ? 1 : dec) + ' %' : ''; }

  var STATUS = { pending: 'En attente', partial: 'Notée en partie', resolved: 'Notée', late: 'Enregistrée trop tard' };

  /* Brier score in words: 0 = perfect, 0.25 = always saying 50 % */
  function brierWords(b) {
    if (!isNum(b)) return '';
    if (b < 0.1) return 'très bien calibré';
    if (b < 0.2) return 'mieux qu\'une pièce';
    if (b <= 0.25) return 'à peine mieux qu\'une pièce';
    return 'moins bien qu\'une pièce';
  }

  var api = { METRICS: METRICS, BY_KEY: BY_KEY, num: num, isNum: isNum, validate: validate, toYaml: toYaml, fileName: fileName,
    newFileUrl: newFileUrl, fr: fr, show: show, formValue: formValue, signedPct: signedPct, STATUS: STATUS, brierWords: brierWords };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MGP = api;
})(this);
