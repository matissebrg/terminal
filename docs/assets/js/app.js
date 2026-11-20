/* Mangrove — the descent: canopée (fil), ligne d'eau (calendrier sur l'horizon), racines (principes),
   bibliothèque (valeurs, documents, dossiers). La marée lives in predict.js, the hero in hero.js.
   Library content comes from library/*.js (globals, so the private copy works from file://);
   market data from the pipeline through MGD (data.js). Plain script, no build step. */
(function () {
  'use strict';
  var P = window.MGP, D = window.MGD;
  var ROOTS = window.MG_ROOTS || [], COV = window.MG_COVERAGE || [], DOCS = window.MG_LIBRARY || [];
  var CATS = window.MG_CATALYSTS || [], VALUES = window.MG_VALUES || [];
  var C_STOCK = '#0E7A5A', C_BENCH = '#4C66B8';   // validated pair (dataviz validator, light dossier surface #F7F9F6)
  /* event kinds: a light colour below the water, an ink colour on the white chips of the horizon */
  var KIND_COLORS = { 'Résultats': '#E4EEEA', 'Réglementaire': '#E6B05A', 'Essai': '#3FE3A6', 'Congrès': '#A9C1FF', 'Objectif de cours': '#FF9BC2' };
  var KIND_INK = { 'Résultats': '#33403B', 'Réglementaire': '#9A6512', 'Essai': '#0B6A4E', 'Congrès': '#3E57A8', 'Objectif de cours': '#A8336A' };
  var MARK = '<svg viewBox="0 0 120 96" fill="currentColor" aria-hidden="true">' + (window.MG_MARK || '') + '</svg>';
  var FEED_TYPES = { price: 'Cours', filing: 'Dépôt SEC', coverage: 'Couverture', catalyst: 'Catalyseur', prediction: 'Prédiction', results: 'Résultats', trial: 'Essai clinique' };
  var MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

  var rootColor = {}; ROOTS.forEach(function (r) { rootColor[r.name] = r.color; });
  var byTicker = {}; COV.forEach(function (c) { byTicker[c.ticker] = c; });

  /* live state, filled as the pipeline files arrive */
  var S = { core: null, tracked: {}, comps: {}, company: {}, px: {}, ready: false };
  window.MG = { state: S, byTicker: byTicker, openDossier: null, on: [] };

  /* ---------- helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
  function $(id) { return document.getElementById(id); }
  function parseDate(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  function fmt(d) { return d ? d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() : ''; }
  function today() { var t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function colorOf(t) { var c = byTicker[t]; return (c && rootColor[c.root]) || '#46E3C8'; }
  function safeUrl(u) { return /^https?:\/\//i.test(u || '') || /^(library\/|\.\/)[\w\-./ ]+$/.test(u || '') ? u : ''; }
  function money(x) { return P.isNum(x) ? P.fr(x, 2) + ' $' : 'n.d.'; }
  function cap(x) { return P.isNum(x) ? P.fr(x / 1e9, x >= 1e11 ? 0 : 1) + ' Md$' : 'n.d.'; }
  function pct(x) { return P.isNum(x) ? P.signedPct(x) : 'n.d.'; }
  function dirClass(x) { return P.isNum(x) ? (x >= 0 ? 'up' : 'down') : ''; }
  function stamp(iso) {
    var d = iso ? new Date(iso) : null;
    return d && !isNaN(d) ? d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() + ' à ' + String(d.getHours()).padStart(2, '0') + ' h ' + String(d.getMinutes()).padStart(2, '0') : '';
  }
  function statusOf(t) {
    var c = byTicker[t] || {};
    if (c.etf) return { key: 'etf', label: 'ETF de référence' };
    if (S.tracked[t]) return { key: 'full', label: 'Suivi complet' };
    if (S.comps[t]) return { key: 'comp', label: S.comps[t].accounting && S.comps[t].accounting.annual_only ? 'Comparable, comptes annuels' : 'Comparable' };
    return { key: 'wait', label: !S.ready ? 'Chargement' : S.core && !S.core.ok ? 'Données injoignables' : 'En attente du pipeline' };
  }
  /* a 60-day sparkline: a single stroke, no axes */
  function spark(vals, color) {
    if (!vals || vals.length < 2) return '';
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), n = vals.length, W = 120, H = 30;
    var d = vals.map(function (v, i) { return (i ? 'L' : 'M') + (i / (n - 1) * W).toFixed(1) + ' ' + (H - 2 - (hi > lo ? (v - lo) / (hi - lo) : .5) * (H - 4)).toFixed(1); }).join('');
    return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true"><path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/></svg>';
  }
  function sparkOf(t) {
    var u = S.tracked[t], c = byTicker[t] || {};
    if (u && u.spark) return u.spark;
    if (c.etf && S.core && S.core.universe && S.core.universe.benchmarks && S.core.universe.benchmarks[t]) return S.core.universe.benchmarks[t].spark;
    return S.px[t] ? S.px[t].slice(-60).map(function (b) { return b.c; }) : null;
  }
  /* last close, 1-day and 1-year change from a bar series */
  function perfFrom(bars) {
    if (!bars || bars.length < 2) return null;
    var last = bars[bars.length - 1], prev = bars[bars.length - 2];
    var t1y = new Date(parseDate(last.t).getTime() - 365 * 864e5).toISOString().slice(0, 10);
    var y1 = null; for (var i = bars.length - 1; i >= 0; i--) { if (bars[i].t <= t1y) { y1 = bars[i]; break; } }
    return { last: last.c, date: last.t, chg_1d: last.c / prev.c - 1, r_1y: y1 ? (last.ac || last.c) / (y1.ac || y1.c) - 1 : null };
  }
  function hasPrices(t) {
    var u = S.core && S.core.universe;
    return !!(S.tracked[t] || S.comps[t] || (u && u.benchmarks && u.benchmarks[t]));
  }
  function quote(t) {
    var u = S.tracked[t], c = byTicker[t] || {};
    if (u) return { price: u.price, chg_1d: u.chg_1d, r_1y: u.r_1y, mcap: u.market_cap };
    if (c.etf && S.core && S.core.universe && S.core.universe.benchmarks && S.core.universe.benchmarks[t]) {
      var b = S.core.universe.benchmarks[t]; return { price: b.last, chg_1d: b.chg_1d, r_1y: b.r_1y };
    }
    var p = perfFrom(S.px[t]), comp = S.comps[t];
    if (p || comp) return { price: p ? p.last : comp.price, chg_1d: p ? p.chg_1d : null, r_1y: p ? p.r_1y : null, mcap: comp ? comp.market_cap : null };
    return null;
  }

  /* ======================= canopée : the feed ======================= */
  var feedFilter = 'Tout', feedAll = false, FEED_PAGE = 6;
  function feedItems() {
    var notes = DOCS.map(function (d) {
      return { date: parseDate(d.date), kind: 'Mes notes', label: d.type || 'Note', title: d.title, summary: d.summary, ticker: d.ticker, file: d.file };
    });
    var ev = ((S.core && S.core.feed && S.core.feed.events) || []).filter(function (e) { return FEED_TYPES[e.type] && (!e.ticker || byTicker[e.ticker]); }).map(function (e) {
      return { date: parseDate(e.date), kind: FEED_TYPES[e.type], label: FEED_TYPES[e.type], title: e.title, summary: e.detail, ticker: e.ticker, link: e.url };
    });
    return notes.concat(ev).filter(function (x) { return x.date; }).sort(function (a, b) { return b.date - a.date; });
  }
  function renderFeed() {
    var items = feedItems(), kinds = ['Tout'];
    items.forEach(function (x) { if (kinds.indexOf(x.kind) < 0) kinds.push(x.kind); });
    if (kinds.indexOf(feedFilter) < 0) feedFilter = 'Tout';
    $('feed-chips').innerHTML = kinds.length > 2 ? kinds.map(function (k) { return '<button type="button" data-k="' + esc(k) + '" aria-pressed="' + (k === feedFilter) + '">' + esc(k) + '</button>'; }).join('') : '';
    var list = items.filter(function (x) { return feedFilter === 'Tout' || x.kind === feedFilter; });
    var shown = feedAll ? list : list.slice(0, FEED_PAGE);
    $('feed').innerHTML = shown.length ? shown.map(function (x) {
      var a = [];
      if (x.ticker && byTicker[x.ticker]) a.push('<button type="button" class="linkish" data-open="' + esc(x.ticker) + '">Dossier ' + esc(x.ticker) + '</button>');
      if (x.file && safeUrl(x.file)) a.push('<a class="linkish" href="' + esc(x.file) + '" target="_blank" rel="noopener"><svg aria-hidden="true"><use href="#g-file"/></svg>Ouvrir le fichier</a>');
      if (x.link && /^https?:\/\//i.test(x.link)) a.push('<a class="linkish" href="' + esc(x.link) + '" target="_blank" rel="noopener">Lire la source</a>');
      return '<article class="entry"><p class="when">' + x.date.getDate() + '<small>' + MONTHS[x.date.getMonth()] + ' ' + x.date.getFullYear() + '</small></p><div>' +
        '<p class="kind">' + esc(x.label) + (x.ticker ? '<span class="tk">' + esc(x.ticker) + '</span>' : '') + '</p>' +
        '<h3>' + esc(x.title) + '</h3>' + (x.summary ? '<p class="s">' + esc(x.summary) + '</p>' : '') +
        (a.length ? '<div class="meta">' + a.join('') + '</div>' : '') + '</div></article>';
    }).join('') : '<p class="feed-empty">' + (S.ready ? 'Rien pour l’instant. Le fil se remplit à chaque passage du pipeline et avec tes notes (library/library.js).' : 'Chargement du fil…') + '</p>';
    var more = $('feed-more');
    more.hidden = list.length <= FEED_PAGE;
    more.textContent = feedAll ? 'Afficher moins' : 'Tout afficher (' + list.length + ')';
  }
  $('feed-chips').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; feedFilter = b.getAttribute('data-k'); feedAll = false; renderFeed(); });
  $('feed-more').addEventListener('click', function () { feedAll = !feedAll; renderFeed(); });

  /* ======================= ligne d'eau : dated events ======================= */
  var T0 = today(), TL_START = new Date(T0.getTime() - 14 * 864e5), TL_END = new Date(T0.getFullYear(), T0.getMonth() + 6, T0.getDate());
  var selectedCat = null, cats = [];
  function buildCats() {
    var out = [];
    CATS.forEach(function (c) { out.push({ date: parseDate(c.date), ticker: c.ticker, kind: c.kind, description: c.description, confirmed: c.confidence === 'confirmed', source: c.source }); });
    var next = (S.core && S.core.predictions && S.core.predictions.next) || {};
    Object.keys(next).forEach(function (t) {
      var n = next[t]; if (!n || !n.date) return;
      out.push({ date: parseDate(n.date), ticker: t, kind: 'Résultats', description: 'Publication de ' + n.period + (n.estimated ? '. Date estimée (' + n.source + ').' : '. Date annoncée par la société.'), confirmed: !n.estimated, predictable: true });
    });
    ((S.core && S.core.predictions && S.core.predictions.predictions) || []).forEach(function (r) {
      (r.price || []).forEach(function (p) {
        if (p.actual != null) return;
        out.push({ date: parseDate(p.date), ticker: p.ticker, kind: 'Objectif de cours', description: 'Mon objectif : ' + money(p.value) + (P.isNum(p.low) ? ', entre ' + money(p.low) + ' et ' + money(p.high) : '') + '.', confirmed: true });
      });
    });
    cats = out.filter(function (c) { return c.date && c.date >= TL_START && c.date <= TL_END; })
      .sort(function (a, b) { return a.date - b.date || String(a.ticker).localeCompare(b.ticker); });
    cats.forEach(function (c, i) { c.i = i; });
  }
  function pinHtml(c, ink) {
    var col = (ink ? KIND_INK : KIND_COLORS)[c.kind] || '#E4EEEA';
    return '<i class="' + (c.confirmed ? '' : 'ring') + '" style="background:' + col + ';color:' + col + '"></i>';
  }
  function renderWaterline() {
    buildCats();
    var present = Object.keys(KIND_COLORS).filter(function (k) { return cats.some(function (c) { return c.kind === k; }); });
    $('cat-legend').innerHTML = (present.length ? present : ['Résultats']).map(function (k) { return '<span><i style="background:' + KIND_COLORS[k] + '"></i>' + k + '</span>'; }).join('') +
      '<span><i class="ring"></i>Cercle vide : date estimée</span>';
    var span = TL_END - TL_START, pos = function (d) { return ((d - TL_START) / span) * 100; };
    var lanes = [], placed = cats.map(function (c) { var x = pos(c.date), lane = 0; while (lanes[lane] != null && x - lanes[lane] < 10.5) lane++; lanes[lane] = x; return { c: c, x: x, lane: lane }; });
    var months = '', m = new Date(TL_START.getFullYear(), TL_START.getMonth() + 1, 1);
    while (m <= TL_END) { months += '<span class="month" style="left:' + pos(m).toFixed(2) + '%">' + MONTHS[m.getMonth()] + (m.getMonth() === 0 ? ' ' + m.getFullYear() : '') + '</span>'; m = new Date(m.getFullYear(), m.getMonth() + 1, 1); }
    var masts = placed.map(function (p) {
      var c = p.c, stem = 30 + (p.lane % 3) * 92;
      var short = fmt(c.date).replace(/ \d{4}$/, '');
      return '<div class="mast" style="left:' + p.x.toFixed(2) + '%">' +
        '<button type="button" class="cm" data-i="' + c.i + '" aria-pressed="' + (selectedCat === c.i) + '" aria-label="' + esc(fmt(c.date) + ', ' + c.ticker + ', ' + c.kind + (c.confirmed ? '' : ', date estimée')) + '">' +
        '<span class="tk">' + esc(c.ticker) + '</span><span class="d">' + esc(short) + '</span><span class="kd">' + pinHtml(c, true) + esc(c.kind) + '</span></button>' +
        '<span class="stem' + (c.confirmed ? '' : ' est') + '" style="height:' + stem + 'px"></span></div>' +
        '<div class="reflect" style="left:' + p.x.toFixed(2) + '%" aria-hidden="true"><span class="stem" style="height:' + Math.round(stem * .7) + 'px"></span><span class="ghost"></span></div>';
    }).join('');
    $('timeline').innerHTML = masts + months + '<div class="today" style="left:' + pos(T0).toFixed(2) + '%"><span>Aujourd’hui</span></div>';
    if (selectedCat == null || !cats[selectedCat]) { var up = cats.filter(function (c) { return c.date >= T0; })[0]; selectedCat = up ? up.i : null; }
    renderCatDetail();
    $('cat-list').innerHTML = cats.length ? cats.map(function (c) {
      return '<li><span class="when">' + esc(fmt(c.date)) + '</span><button type="button" class="linkish" data-open="' + esc(c.ticker) + '">' + esc((byTicker[c.ticker] || {}).name || c.ticker) + '</button>' +
        '<span class="k">' + pinHtml(c) + esc(c.kind) + '</span><span class="d">' + esc(c.description) + '</span><span class="conf">' + (c.kind === 'Objectif de cours' ? 'Ma date' : c.confirmed ? 'Confirmée' : 'Estimée') + '</span></li>';
    }).join('') : '<li class="none">' + (S.ready ? 'Aucune date dans les six prochains mois. Ajoute tes catalyseurs dans library/catalysts.js.' : 'Chargement du calendrier…') + '</li>';
  }
  function renderCatDetail() {
    var c = selectedCat != null ? cats[selectedCat] : null, box = $('cat-detail');
    if (!c) { box.hidden = true; return; }
    box.hidden = false;
    var co = byTicker[c.ticker] || {};
    var acts = '<button type="button" class="linkish" data-open="' + esc(c.ticker) + '">Dossier ' + esc(c.ticker) + '</button>';
    if (c.predictable) acts += '<button type="button" class="linkish" data-predict="' + esc(c.ticker) + '">Prévoir ces résultats</button>';
    if (c.source && /^https?:\/\//i.test(c.source)) acts += '<a class="linkish" href="' + esc(c.source) + '" target="_blank" rel="noopener">Source</a>';
    box.innerHTML = '<div class="date">' + c.date.getDate() + '<small>' + MONTHS[c.date.getMonth()] + ' ' + c.date.getFullYear() + '</small></div>' +
      '<div><h4>' + esc(co.name || c.ticker) + ', ' + esc(c.kind.toLowerCase()) + '</h4><p>' + esc(c.description) + '</p><div class="meta">' + acts + '</div></div>' +
      '<div class="meta">' + pinHtml(c) + '<span class="conf-tag">' + (c.kind === 'Objectif de cours' ? 'Mon échéance' : c.confirmed ? 'Date confirmée' : 'Date estimée') + '</span></div>';
  }
  $('timeline').addEventListener('click', function (e) {
    var b = e.target.closest('.cm'); if (!b) return;
    selectedCat = +b.getAttribute('data-i'); renderWaterline();
    var again = document.querySelector('.cm[data-i="' + selectedCat + '"]'); if (again) again.focus({ preventScroll: true });
  });

  /* ======================= racines ======================= */
  $('values').innerHTML = VALUES.map(function (v) { return '<article class="value"><h3>' + esc(v.title) + '</h3><p>' + esc(v.text) + '</p></article>'; }).join('');

  /* ======================= bibliothèque ======================= */
  var lib = { q: '', type: '', view: 'roots', sort: 'date', dir: -1 };
  var SEC_TYPE = 'Dépôt SEC';
  function allDocs() {
    var mine = DOCS.filter(function (d) { return byTicker[d.ticker]; }).map(function (d) {
      return { date: parseDate(d.date), ticker: d.ticker, type: d.type || 'Note', title: d.title, summary: d.summary, file: d.file, tags: d.tags || [], mine: true };
    });
    var sec = [];
    Object.keys(S.company).forEach(function (t) {
      ((S.company[t] && S.company[t].filings) || []).filter(function (f) { return f.is_results || /^(10-K|20-F)/.test(f.form); }).slice(0, 12).forEach(function (f) {
        sec.push({ date: parseDate(f.filed), ticker: t, type: SEC_TYPE, title: formTitle(f), file: f.url, tags: [f.form], sec: true });
      });
    });
    return mine.concat(sec).filter(function (d) { return d.date; });
  }
  function formTitle(f) {
    var what = { '10-K': 'Rapport annuel', '10-Q': 'Rapport trimestriel', '20-F': 'Rapport annuel', '6-K': 'Communication', '8-K': 'Communiqué de résultats' }[f.form] || 'Dépôt';
    return what + ' (' + f.form + ')' + (f.report_date && f.form !== '8-K' && f.form !== '6-K' ? ', période close le ' + fmt(parseDate(f.report_date)) : '');
  }
  function docMatches(d) {
    if (lib.type === '__mine' ? !d.mine : lib.type && d.type !== lib.type) return false;
    if (!lib.q) return true;
    var c = byTicker[d.ticker] || {};
    return [d.title, d.summary, d.type, d.tags.join(' '), d.ticker, c.name, c.focus].join(' ').toLowerCase().indexOf(lib.q) >= 0;
  }
  function fillTypes() {
    var types = [];
    DOCS.forEach(function (d) { var t = d.type || 'Note'; if (types.indexOf(t) < 0) types.push(t); });
    var cur = $('lib-type').value;
    $('lib-type').innerHTML = '<option value="">Tous</option>' + (types.length ? '<option value="__mine">Mes documents</option>' : '') +
      types.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('') + '<option>' + SEC_TYPE + '</option>';
    $('lib-type').value = cur;
  }
  function renderLibrary() {
    var docs = allDocs(), shownDocs = docs.filter(docMatches);
    var comps = COV.filter(function (c) {
      if (!lib.q && !lib.type) return true;
      var own = !lib.type && [c.ticker, c.name, c.root, c.focus].join(' ').toLowerCase().indexOf(lib.q) >= 0;
      return own || shownDocs.some(function (d) { return d.ticker === c.ticker; });
    });
    var nMine = shownDocs.filter(function (d) { return d.mine; }).length;
    $('lib-count').textContent = plural(comps.length, 'valeur', 'valeurs') + ', ' + plural(nMine, 'document à moi', 'documents à moi') + ', ' + plural(shownDocs.length - nMine, 'dépôt SEC', 'dépôts SEC');
    var none = lib.view === 'roots' ? !comps.length : !shownDocs.length;
    $('lib-empty').hidden = !none;
    $('lib-roots').hidden = lib.view !== 'roots' || none;
    $('lib-list').hidden = lib.view !== 'list' || none;
    if (lib.view === 'roots') {
      $('lib-roots').innerHTML = ROOTS.map(function (r) {
        var group = comps.filter(function (c) { return c.root === r.name; });
        if (!group.length) return '';
        return '<section class="col" style="--c:' + r.color + '" aria-label="' + esc(r.name) + '"><h3><i></i>' + esc(r.name) + ' <span class="n">' + group.length + '</span></h3><div class="tiles">' +
          group.map(function (c) {
            var q = quote(c.ticker), st = statusOf(c.ticker), nd = docs.filter(function (d) { return d.ticker === c.ticker && d.mine; }).length;
            return '<button type="button" class="tile" style="--c:' + r.color + '" data-open="' + esc(c.ticker) + '" aria-label="' + esc('Dossier ' + c.ticker + ', ' + c.name) + '">' +
              '<span class="row"><span class="sym" translate="no">' + esc(c.ticker) + '</span>' + (q && P.isNum(q.chg_1d) ? '<span class="chg ' + dirClass(q.chg_1d) + '">' + pct(q.chg_1d) + '</span>' : '') + '</span>' +
              '<span class="nm">' + esc(c.name) + '</span><span class="focus">' + esc(c.focus) + '</span>' +
              (spark(sparkOf(c.ticker), r.color) || '<svg class="spark" aria-hidden="true"></svg>') +
              '<span class="row"><span class="px">' + (q && P.isNum(q.price) ? money(q.price) : '') + '</span><span class="status s-' + st.key + '">' + esc(st.label) + (nd ? ', ' + plural(nd, 'doc.', 'docs') : '') + '</span></span></button>';
          }).join('') + '</div></section>';
      }).join('');
    } else {
      var k = lib.sort, dir = lib.dir;
      shownDocs.sort(function (a, b) {
        var va = k === 'date' ? a.date : String(a[k] || '').toLowerCase(), vb = k === 'date' ? b.date : String(b[k] || '').toLowerCase();
        return (va > vb ? 1 : va < vb ? -1 : 0) * dir || b.date - a.date;
      });
      $('lib-rows').innerHTML = shownDocs.map(function (d) {
        var t = safeUrl(d.file) ? '<a class="linkish" href="' + esc(d.file) + '" target="_blank" rel="noopener">' + esc(d.title) + '</a>' : esc(d.title);
        return '<tr><td class="when">' + esc(fmt(d.date)) + '</td><td><button type="button" class="linkish" data-open="' + esc(d.ticker) + '">' + esc(d.ticker) + '</button></td>' +
          '<td><span class="kind"><i style="background:' + (d.sec ? 'var(--ecume-2)' : colorOf(d.ticker)) + '"></i>' + esc(d.type) + '</span></td><td>' + t + (d.summary ? '<p class="s">' + esc(d.summary) + '</p>' : '') + '</td></tr>';
      }).join('');
      Array.prototype.forEach.call(document.querySelectorAll('#lib-list th'), function (th) {
        if (th.getAttribute('data-k') === lib.sort) th.setAttribute('aria-sort', lib.dir > 0 ? 'ascending' : 'descending'); else th.removeAttribute('aria-sort');
      });
    }
  }
  function setView(v) {
    lib.view = v;
    $('view-roots').setAttribute('aria-pressed', String(v === 'roots'));
    $('view-list').setAttribute('aria-pressed', String(v === 'list'));
    renderLibrary();
  }
  var qTimer;
  $('lib-q').addEventListener('input', function (e) { clearTimeout(qTimer); qTimer = setTimeout(function () { lib.q = e.target.value.trim().toLowerCase(); renderLibrary(); }, 120); });
  $('lib-type').addEventListener('change', function (e) { lib.type = e.target.value; renderLibrary(); });
  $('view-roots').addEventListener('click', function () { setView('roots'); });
  $('view-list').addEventListener('click', function () { setView('list'); });
  $('lib-clear').addEventListener('click', function () { lib.q = lib.type = ''; $('lib-q').value = ''; $('lib-type').value = ''; renderLibrary(); $('lib-q').focus(); });
  document.querySelector('#lib-list thead').addEventListener('click', function (e) {
    var th = e.target.closest('th'); if (!th) return;
    var k = th.getAttribute('data-k');
    if (lib.sort === k) lib.dir = -lib.dir; else { lib.sort = k; lib.dir = k === 'date' ? -1 : 1; }
    renderLibrary();
    var b = document.querySelector('#lib-list th[data-k="' + k + '"] button'); if (b) b.focus();
  });

  /* ======================= charts (SVG, hover tooltip, table fallback) ======================= */
  /* series: [{name, color, bars}] rebased to 100 on the first common day of the last year */
  function rebase(series) {
    var start = null;
    series.forEach(function (s) {
      var last = s.bars[s.bars.length - 1].t, from = new Date(parseDate(last).getTime() - 365 * 864e5).toISOString().slice(0, 10);
      var first = (s.bars.filter(function (b) { return b.t >= from; })[0] || s.bars[0]).t;
      if (!start || first > start) start = first;
    });
    var dates = {};
    series.forEach(function (s) { s.bars.forEach(function (b) { if (b.t >= start) dates[b.t] = (dates[b.t] || 0) + 1; }); });
    var days = Object.keys(dates).filter(function (d) { return dates[d] === series.length; }).sort();
    return { days: days, lines: series.map(function (s) {
      var map = {}; s.bars.forEach(function (b) { map[b.t] = b.ac || b.c; });
      var b0 = map[days[0]];
      return { name: s.name, color: s.color, values: days.map(function (d) { return map[d] / b0 * 100; }) };
    }) };
  }
  function lineChart(id, series, w) {
    var r = rebase(series); if (r.days.length < 20) return '<p class="help">Historique de cours trop court pour un graphique.</p>';
    var W = Math.max(320, Math.min(640, w || 640)), H = W < 480 ? 210 : 230, L = 44, R = 64, T = 12, B = 28, n = r.days.length;
    var all = []; r.lines.forEach(function (l) { all = all.concat(l.values); });
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all), step = (hi - lo) > 60 ? 20 : (hi - lo) > 25 ? 10 : 5;
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    var x = function (i) { return L + (W - L - R) * i / (n - 1); }, y = function (v) { return T + (H - T - B) * (1 - (v - lo) / (hi - lo)); };
    var grid = '';
    for (var g = lo; g <= hi + 1e-9; g += step) grid += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(g).toFixed(1) + '" y2="' + y(g).toFixed(1) + '" class="' + (g === 100 ? 'gbase' : 'grid') + '"/><text x="' + (L - 8) + '" y="' + (y(g) + 4).toFixed(1) + '" class="ax" text-anchor="end">' + g + '</text>';
    var ticks = '', lastM = -1;
    r.days.forEach(function (d, i) { var dt = parseDate(d); if (dt.getMonth() !== lastM && dt.getDate() <= 7 && dt.getMonth() % 3 === 0) { ticks += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 8) + '" class="ax" text-anchor="middle">' + MONTHS[dt.getMonth()] + (dt.getMonth() === 0 ? ' ' + dt.getFullYear() : '') + '</text>'; } lastM = dt.getMonth(); });
    var ends = r.lines.map(function (l) { return { l: l, v: l.values[n - 1], y: y(l.values[n - 1]) }; }).sort(function (a, b) { return a.y - b.y; });
    if (ends.length === 2 && ends[1].y - ends[0].y < 14) { var mid = (ends[0].y + ends[1].y) / 2; ends[0].ly = mid - 7; ends[1].ly = mid + 7; } else ends.forEach(function (e) { e.ly = e.y; });
    var paths = r.lines.map(function (l) {
      return '<path d="' + l.values.map(function (v, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); }).join('') + '" fill="none" stroke="' + l.color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    }).join('') + ends.map(function (e) {
      return '<circle cx="' + x(n - 1).toFixed(1) + '" cy="' + e.y.toFixed(1) + '" r="4" fill="' + e.l.color + '" stroke="#F7F9F6" stroke-width="2"/><text x="' + (x(n - 1) + 9).toFixed(1) + '" y="' + (e.ly + 4).toFixed(1) + '" class="endl">' + esc(e.l.name) + ' ' + P.fr(e.v, 0) + '</text>';
    }).join('');
    var summary = r.lines.map(function (l) { return l.name + ' ' + P.signedPct(l.values[n - 1] / 100 - 1, 0); }).join(', ');
    var legend = '<div class="chart-legend">' + r.lines.map(function (l) { return '<span><span class="key" style="background:' + l.color + '"></span>' + esc(l.name) + '</span>'; }).join('') + '</div>';
    var rows = [];
    for (var i = 0; i < n; i += Math.max(1, Math.round(n / 12))) rows.push(i);
    if (rows[rows.length - 1] !== n - 1) rows.push(n - 1);
    var table = '<details class="tview"><summary>Voir les chiffres</summary><div class="scroll"><table><thead><tr><th scope="col">Date</th>' + r.lines.map(function (l) { return '<th scope="col">' + esc(l.name) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (i) { return '<tr><td>' + fmt(parseDate(r.days[i])) + '</td>' + r.lines.map(function (l) { return '<td>' + P.fr(l.values[i], 1) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div></details>';
    CHARTS[id] = { kind: 'line', r: r, x: x, y: y, n: n, W: W, L: L, R: R };
    return legend + '<div class="chart" data-chart="' + id + '"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Cours sur un an, base 100 : ' + esc(summary) + '">' + grid + ticks + paths +
      '<line class="xhair" x1="0" x2="0" y1="' + T + '" y2="' + (H - B) + '" hidden/></svg><div class="tip" hidden></div></div>' + table;
  }
  function barChart(id, rows, unit, w) {
    /* rows: [{label, value (raw), est}] ; one series, value at each cap only for the last */
    var W = Math.max(320, Math.min(640, w || 640)), H = 200, L = 52, R = 12, T = 22, B = 28, n = rows.length;
    var vals = rows.map(function (r) { return r.value / 1e9; }), hi = Math.max.apply(null, vals);
    var step = niceStep(hi / 4); hi = Math.ceil(hi / step) * step;
    var band = (W - L - R) / n, bw = Math.min(24, band * 0.6);
    var y = function (v) { return T + (H - T - B) * (1 - v / hi); };
    var grid = '';
    for (var g = 0; g <= hi + 1e-9; g += step) grid += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(g).toFixed(1) + '" y2="' + y(g).toFixed(1) + '" class="grid"/><text x="' + (L - 8) + '" y="' + (y(g) + 4).toFixed(1) + '" class="ax" text-anchor="end">' + P.fr(g, step < 1 ? 1 : 0) + '</text>';
    var bars = rows.map(function (r, i) {
      var cx = L + band * (i + 0.5), v = vals[i], top = y(v), h = y(0) - top, rad = Math.min(4, h);
      var d = 'M' + (cx - bw / 2).toFixed(1) + ' ' + y(0).toFixed(1) + 'V' + (top + rad).toFixed(1) + 'Q' + (cx - bw / 2).toFixed(1) + ' ' + top.toFixed(1) + ' ' + (cx - bw / 2 + rad).toFixed(1) + ' ' + top.toFixed(1) +
        'H' + (cx + bw / 2 - rad).toFixed(1) + 'Q' + (cx + bw / 2).toFixed(1) + ' ' + top.toFixed(1) + ' ' + (cx + bw / 2).toFixed(1) + ' ' + (top + rad).toFixed(1) + 'V' + y(0).toFixed(1) + 'Z';
      return '<path d="' + d + '" fill="' + C_STOCK + '"' + (r.est ? ' fill-opacity=".35" stroke="' + C_STOCK + '" stroke-dasharray="3 3"' : '') + '/>' +
        '<rect class="hit" x="' + (cx - band / 2).toFixed(1) + '" y="' + T + '" width="' + band.toFixed(1) + '" height="' + (H - T - B) + '" data-i="' + i + '" fill="transparent"/>' +
        (band >= 52 || i % 2 === (n - 1) % 2 ? '<text x="' + cx.toFixed(1) + '" y="' + (H - 8) + '" class="ax" text-anchor="middle">' + esc(r.label.replace(/FY20(\d\d)/, 'FY$1')) + '</text>' : '') +
        (i === n - 1 ? '<text x="' + cx.toFixed(1) + '" y="' + (top - 7).toFixed(1) + '" class="endl" text-anchor="middle">' + P.fr(v, 2) + '</text>' : '');
    }).join('');
    CHARTS[id] = { kind: 'bar', rows: rows, unit: unit };
    var table = '<details class="tview"><summary>Voir les chiffres</summary><div class="scroll"><table><thead><tr><th scope="col">Trimestre</th><th scope="col">Chiffre d’affaires</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td>' + esc(r.label) + (r.est ? ' (consensus)' : '') + '</td><td>' + P.show(r.value, 'Md$') + '</td></tr>'; }).join('') + '</tbody></table></div></details>';
    return '<div class="chart" data-chart="' + id + '"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Chiffre d’affaires par trimestre, de ' + esc(rows[0].label) + ' à ' + esc(rows[n - 1].label) + '">' + grid + bars + '</svg><div class="tip" hidden></div></div>' + table;
  }
  function niceStep(x) { var p = Math.pow(10, Math.floor(Math.log10(x || 1))), f = x / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }
  var CHARTS = {};
  document.addEventListener('pointermove', function (e) {
    var box = e.target.closest && e.target.closest('.chart');
    document.querySelectorAll('.chart .tip:not([hidden])').forEach(function (t) { if (!box || t.parentNode !== box) { t.hidden = true; var xh = t.parentNode.querySelector('.xhair'); if (xh) xh.setAttribute('hidden', ''); } });
    if (!box) return;
    var ch = CHARTS[box.getAttribute('data-chart')], tip = box.querySelector('.tip'), svg = box.querySelector('svg');
    if (!ch) return;
    var rect = svg.getBoundingClientRect(), sx = (e.clientX - rect.left) / rect.width;
    var html = '', px;
    if (ch.kind === 'line') {
      var vx = sx * ch.W, i = Math.round((vx - ch.L) / ((ch.W - ch.L - ch.R) / (ch.n - 1)));
      i = Math.max(0, Math.min(ch.n - 1, i)); px = ch.x(i);
      var xh = svg.querySelector('.xhair'); xh.removeAttribute('hidden'); xh.setAttribute('x1', px); xh.setAttribute('x2', px);
      html = '<b>' + fmt(parseDate(ch.r.days[i])) + '</b>' + ch.r.lines.map(function (l) { return '<span><span class="key" style="background:' + l.color + '"></span>' + esc(l.name) + ' ' + P.fr(l.values[i], 1) + '</span>'; }).join('');
      px = px / ch.W * rect.width;
    } else {
      var hit = e.target.closest('.hit'); if (!hit) { tip.hidden = true; return; }
      var r = ch.rows[+hit.getAttribute('data-i')];
      html = '<b>' + esc(r.label) + (r.est ? ', consensus' : '') + '</b><span>' + P.show(r.value, 'Md$') + '</span>';
      var hb = hit.getBoundingClientRect(); px = hb.left - rect.left + hb.width / 2;
    }
    tip.innerHTML = html; tip.hidden = false;
    tip.style.left = Math.max(8, Math.min(rect.width - tip.offsetWidth - 8, px + 12)) + 'px';
  });

  /* ======================= dossier ======================= */
  var dlg = $('dossier'), lastFocus = null, openTk = null;
  function statRow(items) {
    return '<dl class="stats">' + items.filter(Boolean).map(function (it) { return '<div><dt>' + esc(it[0]) + '</dt><dd class="' + (it[2] || '') + '">' + it[1] + '</dd></div>'; }).join('') + '</dl>';
  }
  function keyFigures(f, annual) {
    if (!f) return '';
    var per = annual ? 'dernier exercice publié' : (f.period || '12 mois glissants').replace('TTM', '12 mois à fin');
    var acc = f.accounting && f.accounting.reporting && f.accounting.reporting !== 'USD' ? ' Comptes en ' + f.accounting.reporting + ', convertis en dollars (' + P.fr(f.accounting.usd_per_unit, 4) + ' $ par ' + f.accounting.reporting + ').' : '';
    return '<h3>Chiffres clés</h3><p class="help">' + esc(per.charAt(0).toUpperCase() + per.slice(1)) + ', source SEC.' + esc(acc) + '</p>' + statRow([
      ['Chiffre d’affaires', P.show(f.revenue_ttm, 'Md$') || 'n.d.'],
      P.isNum(f.revenue_growth_ttm) ? ['Croissance sur un an', P.signedPct(f.revenue_growth_ttm), dirClass(f.revenue_growth_ttm)] : null,
      ['Marge opérationnelle', P.show(f.operating_margin_ttm, '%') || 'n.d.'],
      ['Résultat net', P.show(f.net_income_ttm, 'Md$') || 'n.d.'],
      ['Free cash flow', P.show(f.fcf_ttm, 'Md$') || 'n.d.'],
      ['Cours / bénéfice', P.isNum(f.pe) ? P.fr(f.pe, 1) : 'n.d.'],
      ['VE / CA', P.isNum(f.ev_sales) ? P.fr(f.ev_sales, 1) : 'n.d.']
    ]);
  }
  function docsBlock(t) {
    var docs = allDocs().filter(function (d) { return d.ticker === t; }).sort(function (a, b) { return b.date - a.date; });
    var mine = docs.filter(function (d) { return d.mine; }), sec = docs.filter(function (d) { return d.sec; }).slice(0, 6);
    var li = function (d) {
      var title = safeUrl(d.file) ? '<a class="linkish" href="' + esc(d.file) + '" target="_blank" rel="noopener">' + esc(d.title) + '</a>' : esc(d.title);
      return '<li><span class="when">' + esc(fmt(d.date)) + '</span><div><p class="t">' + (d.mine ? esc(d.type) + ' : ' : '') + title + '</p>' + (d.summary ? '<p class="s">' + esc(d.summary) + '</p>' : '') + '</div></li>';
    };
    return '<h3>Mes documents</h3><ul class="dlist">' + (mine.length ? mine.map(li).join('') : '<li class="none">Aucun document pour l’instant (library/library.js).</li>') + '</ul>' +
      (sec.length ? '<h3>Derniers dépôts SEC</h3><ul class="dlist">' + sec.map(li).join('') + '</ul>' : '');
  }
  function predsBlock(t) {
    var recs = ((S.core && S.core.predictions && S.core.predictions.predictions) || []).filter(function (r) { return r.ticker === t || (r.price || []).some(function (p) { return p.ticker === t; }); });
    var upcoming = cats.filter(function (c) { return c.ticker === t && c.date >= T0; });
    return '<h3>À venir</h3><ul class="dlist">' + (upcoming.length ? upcoming.map(function (c) {
      return '<li><span class="when">' + esc(fmt(c.date)) + '</span><div><p class="t">' + esc(c.kind) + (c.confirmed ? '' : ', date estimée') + '</p><p class="s">' + esc(c.description) + '</p></div></li>';
    }).join('') : '<li class="none">Aucune date dans les six prochains mois.</li>') + '</ul>' +
      '<h3>Mes prédictions</h3><p class="help">' + (recs.length ? plural(recs.length, 'prédiction enregistrée', 'prédictions enregistrées') + ', détail dans la marée.' : 'Aucune prédiction sur ' + esc(t) + ' pour l’instant.') + '</p>' +
      '<button class="btn btn-ink btn-small" type="button" data-predict="' + esc(t) + '">Écrire une prédiction sur ' + esc(t) + '<svg aria-hidden="true"><use href="#g-arrow"/></svg></button>';
  }
  function thesisBlock(co) {
    var th = co && co.thesis ? String(co.thesis).trim() : '';
    if (!th || /^À écrire/.test(th)) return '<h3>Thèse</h3><p class="help">Pas encore écrite. Elle se rédige dans config/assumptions/' + esc(co ? co.ticker : '') + '.yaml, champ thesis.</p>';
    return '<h3>Thèse</h3>' + th.split(/\n{2,}/).map(function (p) { return '<p class="prose">' + esc(p) + '</p>'; }).join('');
  }
  function openDossier(t) {
    var c = byTicker[t]; if (!c) return;
    if (!dlg.open) lastFocus = document.activeElement;
    openTk = t;
    var st = statusOf(t), q = quote(t);
    var head = '<div class="dos-top"><div><h2 id="dos-title">' + esc(t) + '</h2><p class="dos-sub"><span class="nm">' + esc(c.name) + '</span><span class="kind"><i style="background:' + colorOf(t) + '"></i>' + esc(c.root) + ', ' + esc(c.focus) + '</span><span class="status s-' + st.key + '">' + esc(st.label) + '</span></p></div>' +
      '<button type="button" class="close" id="dos-close" aria-label="Fermer le dossier"><svg aria-hidden="true"><use href="#g-x"/></svg></button></div>';
    var nx = S.core && S.core.predictions && S.core.predictions.next && S.core.predictions.next[t];
    var stats = statRow([
      ['Cours', q && P.isNum(q.price) ? money(q.price) : 'n.d.'],
      ['Séance', q ? pct(q.chg_1d) : 'n.d.', q ? dirClass(q.chg_1d) : ''],
      ['Sur un an', q ? pct(q.r_1y) : 'n.d.', q ? dirClass(q.r_1y) : ''],
      q && P.isNum(q.mcap) ? ['Capitalisation', cap(q.mcap)] : null,
      nx ? ['Prochains résultats', esc(fmt(parseDate(nx.date))) + (nx.estimated ? ' <small>estimée</small>' : '')] : null
    ]);
    var note = '';
    if (st.key === 'comp') note = '<p class="help warnline">' + esc(t) + ' dépose un rapport annuel 20-F, sans comptes trimestriels exploitables à la SEC : la bibliothèque montre son cours et ses comptes annuels, et la marée note les objectifs de cours et les questions oui / non.</p>';
    if (st.key === 'wait') note = '<p class="help warnline">' + (D.offline && !S.core.ok ? 'Données de marché injoignables depuis cette copie : vérifie la connexion, ou ouvre le site en ligne.' : 'Pas encore de données : le pipeline les récupère à son prochain passage (onglet Actions du repo).') + '</p>';
    $('dos-body').innerHTML = head + stats + note + '<h3>Cours sur un an, base 100</h3><div id="dos-chart"><p class="help">Chargement du graphique…</p></div>' +
      '<div id="dos-quarters"></div><div id="dos-figures"></div><div id="dos-thesis"></div>' + predsBlock(t) + docsBlock(t);
    $('dos-close').addEventListener('click', function () { dlg.close(); });
    if (!dlg.open) { if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', ''); }
    $('dos-close').focus();
    /* live parts */
    var bench = t === 'XLV' ? 'SPY' : 'XLV';
    var none = Promise.resolve(null);
    Promise.all([hasPrices(t) ? D.rawPrices(t) : none, hasPrices(bench) ? D.rawPrices(bench) : none]).then(function (r) {
      if (openTk !== t || !$('dos-chart')) return;
      var s = [];
      if (r[0] && r[0].bars && r[0].bars.length) s.push({ name: t, color: C_STOCK, bars: r[0].bars });
      if (r[1] && r[1].bars && r[1].bars.length) s.push({ name: bench, color: C_BENCH, bars: r[1].bars });
      $('dos-chart').innerHTML = s.length ? lineChart('px-' + t, s, $('dos-chart').clientWidth) : '<p class="help">' + (S.core && !S.core.ok ? 'Cours injoignables pour l’instant.' : 'Pas encore d’historique de cours pour ' + esc(t) + '.') + '</p>';
    });
    if (S.tracked[t]) {
      Promise.all([D.predict(t), D.peers(t), D.company(t)]).then(function (r) {
        if (openTk !== t || !$('dos-quarters')) return;
        var pr = r[0], rev = pr && pr.metrics && pr.metrics.revenue;
        if (rev && rev.history && rev.history.length) {
          var rows = rev.history.slice(-8).map(function (h) { return { label: h.label, value: h.value }; });
          if (rev.consensus && P.isNum(rev.consensus.avg) && pr.next) rows.push({ label: pr.next.label, value: rev.consensus.avg, est: true });
          $('dos-quarters').innerHTML = '<h3>Chiffre d’affaires par trimestre, en Md$</h3>' + (rows[rows.length - 1].est ? '<p class="help">La dernière colonne, en pointillé, est le consensus pour ' + esc(pr.next.label) + ' (' + esc(rev.consensus.source || 'Yahoo') + ').</p>' : '') + barChart('rev-' + t, rows, 'Md$', $('dos-quarters').clientWidth);
        }
        $('dos-figures').innerHTML = keyFigures(r[1] && r[1].target, false);
        $('dos-thesis').innerHTML = thesisBlock(r[2]);
      });
    } else if (S.comps[t]) {
      $('dos-figures').innerHTML = keyFigures(S.comps[t], S.comps[t].accounting && S.comps[t].accounting.annual_only);
    }
  }
  window.MG.openDossier = openDossier;
  window.MG.api = { quote: quote, statusOf: statusOf, sparkOf: sparkOf, spark: spark, feedItems: feedItems, cats: function () { return cats; },
    money: money, pct: pct, dirClass: dirClass, fmt: fmt, esc: esc, MONTHS: MONTHS, rootColor: rootColor, T0: T0 };
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', function () { openTk = null; if (lastFocus && lastFocus.focus) lastFocus.focus(); });
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-open]');
    if (b) { openDossier(b.getAttribute('data-open')); return; }
    var p = e.target.closest('[data-predict]');
    if (p && window.MGPredict) { if (dlg.open) dlg.close(); window.MGPredict.start(p.getAttribute('data-predict')); }
  });

  /* ======================= depth gauge, nav, menu, marks, waves ======================= */
  Array.prototype.forEach.call(document.querySelectorAll('[data-mark]'), function (el) { el.innerHTML = MARK; });
  var depthLinks = Array.prototype.slice.call(document.querySelectorAll('.depth a'));
  var navLinks = Array.prototype.slice.call(document.querySelectorAll('.nav-links a'));
  var SECS = ['top', 'canopee', 'ligne-d-eau', 'maree', 'racines', 'bibliotheque'];
  if ('IntersectionObserver' in window) {
    /* the section crossing the middle of the screen is "where you are" */
    var here = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var id = en.target.id;
        depthLinks.forEach(function (l) { if (l.getAttribute('data-sec') === id) l.setAttribute('aria-current', 'true'); else l.removeAttribute('aria-current'); });
        navLinks.forEach(function (l) { if (l.getAttribute('href') === '#' + id) l.setAttribute('aria-current', 'true'); else l.removeAttribute('aria-current'); });
        document.body.classList.toggle('at-top', id === 'top');
      });
    }, { rootMargin: '-45% 0px -54% 0px' });
    SECS.forEach(function (id) { var el = $(id); if (el) here.observe(el); });
    /* the floating chrome turns to glass once dark water passes under the nav */
    var under = new Set();
    var dark = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) under.add(en.target); else under.delete(en.target); });
      document.body.classList.toggle('below', under.size > 0);
      var meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', under.size ? '#04110F' : '#EDF0EC');
    }, { rootMargin: '0px 0px -93% 0px' });
    Array.prototype.forEach.call(document.querySelectorAll('.dark, .horizon .sea'), function (el) { dark.observe(el); });
  }
  var menuBtn = document.querySelector('.nav-menu'), menu = $('menu');
  function setMenu(open) {
    menu.hidden = !open; menuBtn.setAttribute('aria-expanded', String(open)); menuBtn.textContent = open ? 'Fermer' : 'Menu';
    document.body.style.overflow = open ? 'hidden' : '';
    if (open) menu.querySelector('a').focus();
  }
  menuBtn.addEventListener('click', function () { setMenu(menu.hidden); });
  menu.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !menu.hidden) { setMenu(false); menuBtn.focus(); } });

  /* fine-line wave fields, drawn once: the sea under the horizon and the tide card */
  function waveField(svg, o) {
    if (!svg) return;
    var W = 1440, H = o.h, out = '';
    for (var k = 0; k < o.n; k++) {
      var t = k / (o.n - 1), y0 = o.y0 + Math.pow(t, o.persp) * (H - o.y0), amp = o.amp * (0.25 + t), f = o.freq * (1 - t * 0.35), ph = k * 0.55;
      var d = '';
      for (var x = 0; x <= W; x += 24) {
        var swell = Math.sin(x / W * Math.PI * 1.3 + 0.6) * o.swell * t;
        var y = y0 + Math.sin(x * f + ph) * amp + Math.sin(x * f * 0.37 + ph * 1.7) * amp * 0.6 + swell;
        d += (x ? 'L' : 'M') + x + ' ' + y.toFixed(1);
      }
      out += '<path d="' + d + '" stroke-opacity="' + (o.op0 + (o.op1 - o.op0) * t).toFixed(3) + '"/>';
    }
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML = '<g fill="none" stroke="' + o.color + '" stroke-width="1" vector-effect="non-scaling-stroke">' + out + '</g>';
  }
  waveField($('waves'), { h: 260, n: 34, y0: 4, persp: 1.7, amp: 2.2, freq: 0.008, swell: 18, color: '#E4EEEA', op0: 0.45, op1: 0.14 });
  waveField($('tide-lines'), { h: 600, n: 44, y0: 150, persp: 1.25, amp: 7, freq: 0.0045, swell: 120, color: '#7FE7C6', op0: 0.04, op1: 0.2 });

  function renderAll() {
    renderFeed(); renderWaterline(); fillTypes(); renderLibrary();
    window.MG.on.forEach(function (f) { try { f(S); } catch (e) { console.error(e); } });
    if (openTk && dlg.open) openDossier(openTk);
  }
  renderAll();
  D.core().then(function (core) {
    S.core = core;
    ((core.universe && core.universe.tickers) || []).forEach(function (u) { S.tracked[u.ticker] = u; });
    S.ready = true;
    var gen = core.universe && core.universe.meta && core.universe.meta.generated_at;
    $('foot-data').textContent = !core.ok ? (D.offline ? 'Copie privée : données de marché injoignables pour l’instant.' : 'Données de marché indisponibles.') :
      'Données de marché du ' + stamp(gen) + (D.offline ? ', lues sur le site public' : '') + '.';
    renderAll();
    var tracked = Object.keys(S.tracked);
    var others = COV.filter(function (c) { return !S.tracked[c.ticker] && !c.etf; }).map(function (c) { return c.ticker; });
    return Promise.all(tracked.map(function (t) {
      return Promise.all([D.company(t), D.peers(t)]).then(function (r) {
        if (r[0]) S.company[t] = r[0];
        ((r[1] && r[1].peers) || []).forEach(function (p) { if (others.indexOf(p.ticker) >= 0 && !S.comps[p.ticker]) S.comps[p.ticker] = p; });
      });
    }));
  }).then(function () {
    renderAll();
    /* comparables' price series, only once a tracked stock has listed them as peers */
    return Promise.all(Object.keys(S.comps).map(function (t) { return D.rawPrices(t).then(function (r) { if (r && r.bars) S.px[t] = r.bars; }); }));
  }).then(renderAll);
})();
