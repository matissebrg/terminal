/* Mangrove — la marée : the scoreboard and records from data/predictions.json (scored by
   pipeline/predictions.py), and the form that writes a registry file and opens it on GitHub.
   Pure helpers live in predict-core.js (MGP). */
(function () {
  'use strict';
  var P = window.MGP, MG = window.MG, D = window.MGD, cfg = window.MANGROVE || {};
  var COV = window.MG_COVERAGE || [];
  var MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
  function day(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? +m[3] + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1] : ''; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function localToday() { var t = new Date(); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); }
  var S = MG.state;

  /* ======================= scoreboard ======================= */
  function gauge(rate, n) {
    var w = P.isNum(rate) ? Math.round(rate * 100) : 0;
    return '<div class="gauge" role="img" aria-label="' + (n ? w + ' % dans l’intervalle, objectif 80 %' : 'Pas encore de résultat noté') + '"><span class="fill" style="width:' + w + '%"></span><span class="target" style="left:80%"></span></div>';
  }
  function renderBoard() {
    var pj = S.core && S.core.predictions, sm = (pj && pj.summary) || {}, counts = sm.counts || {};
    var bm = sm.by_metric || {}, hit = 0, cov = 0;
    Object.keys(bm).forEach(function (k) { var iv = bm[k].interval || {}; hit += iv.hit || 0; cov += iv.n || 0; });
    var price = sm.price || {}, ev = sm.events;
    var pricesHit = P.isNum(price.interval_rate) ? Math.round(price.interval_rate * (price.n || 0)) : 0;
    var nCov = cov, nHit = hit;
    var g1 = '<article class="g"><h4>Intervalles à 80 %</h4>' +
      '<p class="big">' + (nCov ? nHit + '<small> sur ' + nCov + '</small>' : '–') + '</p>' + gauge(nCov ? nHit / nCov : null, nCov) + '<p class="help">' + (nCov ? 'chiffres publiés tombés dans mon intervalle. Bien calibré, c’est environ 80 %.' : 'Aucun résultat noté pour l’instant. Bien calibré, 80 % des chiffres publiés tombent dans l’intervalle.') + '</p></article>';
    var g2 = '<article class="g"><h4>Questions oui / non</h4>' + (ev ? '<p class="big">' + P.fr(ev.brier, 3) + '<small> Brier</small></p><p class="help">' + esc(P.brierWords(ev.brier)) + ', sur ' + plural(ev.n, 'question tranchée', 'questions tranchées') + '. 0 est parfait ; 0,25 revient à toujours dire 50 %.</p>' :
      '<p class="big">–</p><p class="help">Aucune question tranchée. Le score de Brier va de 0 (parfait) à 0,25 (toujours dire 50 %) et au-delà.</p>') + '</article>';
    var g3 = '<article class="g"><h4>Objectifs de cours</h4>' + (price.n ? '<p class="big">' + P.fr(price.mean_abs_error * 100, 1) + '<small> % d’écart moyen</small></p><p class="help">sur ' + plural(price.n, 'objectif échu', 'objectifs échus') + (P.isNum(price.interval_rate) ? ', dont ' + pricesHit + ' dans ma fourchette' : '') + '.</p>' :
      '<p class="big">–</p><p class="help">Aucun objectif échu. L’écart se mesure sur la clôture du jour visé.</p>') + '</article>';
    $('gauges').innerHTML = g1 + g2 + g3;
    var total = (counts.pending || 0) + (counts.partial || 0) + (counts.resolved || 0) + (counts.late || 0);
    $('pred-counts').textContent = !S.ready ? 'Chargement des prédictions…' : !pj ? 'Prédictions indisponibles pour l’instant.' : total ?
      [plural(counts.pending || 0, 'en attente', 'en attente'), plural(counts.partial || 0, 'notée en partie', 'notées en partie'), plural(counts.resolved || 0, 'notée', 'notées')]
        .concat(counts.late ? [plural(counts.late, 'enregistrée trop tard', 'enregistrées trop tard')] : []).join(', ') + '.' :
      'Aucune prédiction enregistrée pour l’instant : écris la première ci-dessous, elle sera notée à la publication.';
    var keys = Object.keys(bm);
    $('pred-metrics').hidden = !keys.length;
    if (keys.length) {
      $('pred-metrics').innerHTML = '<table><thead><tr><th scope="col">Indicateur</th><th scope="col">Notées</th><th scope="col">Écart moyen</th><th scope="col">Biais</th><th scope="col">Dans l’intervalle</th><th scope="col">Plus près que le consensus</th></tr></thead><tbody>' +
        keys.map(function (k) {
          var s = bm[k], pts = s.kind === 'margin', vs = (s.vs || {}).consensus;
          var e = function (x) { return pts ? P.fr(x * 100, 1) + ' pt' : P.fr(x * 100, 1) + ' %'; };
          return '<tr><th scope="row">' + esc(s.label) + '</th><td>' + s.n + '</td><td>' + e(s.mean_abs_error) + '</td><td>' + (s.bias > 0 ? '+' : '') + e(s.bias) + (Math.abs(s.bias) > 1e-9 ? (s.bias > 0 ? ', trop optimiste' : ', trop prudent') : '') + '</td>' +
            '<td>' + (s.interval && s.interval.n ? s.interval.hit + ' sur ' + s.interval.n : '–') + '</td><td>' + (vs ? vs.wins + ' sur ' + vs.n : '–') + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
  }

  /* ======================= records ======================= */
  var filter = 'all';
  var FILTERS = [['all', 'Toutes'], ['pending', 'En attente'], ['done', 'Notées']];
  function recRows(r) {
    var rows = '';
    (r.metrics || []).forEach(function (m) {
      var range = P.isNum(m.low) ? ' <small>' + P.show(m.low, m.unit) + ' à ' + P.show(m.high, m.unit) + '</small>' : '';
      var err = P.isNum(m.error_pct) ? P.signedPct(m.error_pct) : P.isNum(m.error_pts) ? (m.error_pts > 0 ? '+' : '') + P.fr(m.error_pts * 100, 1) + ' pt' : '';
      rows += '<tr><th scope="row">' + esc(m.label) + '</th><td>' + P.show(m.value, m.unit) + range + '</td><td>' + (m.actual != null ? P.show(m.actual, m.unit) : '<span class="muted">à publier</span>') + '</td><td>' + esc(err) +
        (m.in_interval === true ? ' <span class="ok">dans l’intervalle</span>' : m.in_interval === false ? ' <span class="ko">hors intervalle</span>' : '') + '</td></tr>';
    });
    (r.events || []).forEach(function (e) {
      rows += '<tr><th scope="row">' + esc(e.question) + '</th><td>' + P.fr(e.probability * 100, 0) + ' %</td><td>' + (e.outcome === true ? 'Oui' : e.outcome === false ? 'Non' : '<span class="muted">pas tranchée</span>') + '</td><td>' + (P.isNum(e.brier) ? 'Brier ' + P.fr(e.brier, 3) : '') + '</td></tr>';
    });
    (r.price || []).forEach(function (p) {
      var range = P.isNum(p.low) ? ' <small>' + P.fr(p.low, 2) + ' à ' + P.fr(p.high, 2) + ' $</small>' : '';
      rows += '<tr><th scope="row">Cours ' + esc(p.ticker) + ' au ' + esc(day(p.date)) + '</th><td>' + P.fr(p.value, 2) + ' $' + range + '</td><td>' + (p.actual != null ? P.fr(p.actual, 2) + ' $' : '<span class="muted">à venir</span>') + '</td><td>' +
        (P.isNum(p.error_pct) ? P.signedPct(p.error_pct) : '') + (p.in_interval === true ? ' <span class="ok">dans la fourchette</span>' : p.in_interval === false ? ' <span class="ko">hors fourchette</span>' : '') + '</td></tr>';
    });
    return rows;
  }
  function renderList() {
    var recs = ((S.core && S.core.predictions && S.core.predictions.predictions) || []).slice()
      .sort(function (a, b) { return String(b.registered_at || '').localeCompare(String(a.registered_at || '')); });
    $('pred-list-title').hidden = $('pred-chips').hidden = $('pred-list').hidden = !recs.length;
    $('pred-chips').innerHTML = recs.length ? FILTERS.map(function (f) { return '<button type="button" data-f="' + f[0] + '" aria-pressed="' + (filter === f[0]) + '">' + f[1] + '</button>'; }).join('') : '';
    var shown = recs.filter(function (r) { return filter === 'all' || (filter === 'pending' ? r.status === 'pending' : r.status === 'resolved' || r.status === 'partial'); });
    var repo = cfg.repo || '';
    $('pred-list').innerHTML = shown.length ? shown.map(function (r) {
      var when = r.release_date ? 'publiés le ' + day(r.release_date) : r.expected_release ? 'publication attendue le ' + day(r.expected_release) : '';
      return '<article class="pred"><header><span class="sym">' + esc(r.ticker) + '</span><div><p class="t">' + esc(r.period || 'Cours et questions') + (when ? ', ' + esc(when) : '') + '</p>' +
        '<p class="help">Enregistrée le ' + esc(day(r.registered_at)) + (r.versions > 1 ? ' (' + r.versions + ' versions)' : '') + (r.edited_after_deadline ? '. Modifiée après l’échéance : cette version n’est pas notée.' : '') + '</p></div>' +
        '<span class="st st-' + esc(r.status) + '">' + esc(P.STATUS[r.status] || r.status) + '</span></header>' +
        (r.status === 'late' ? '<p class="help warnline">Enregistrée après l’échéance (0 h, heure de New York, le jour de la publication) : elle n’est pas notée.</p>' :
          '<div class="scroll"><table class="rt"><thead><tr><th scope="col">Prévision</th><th scope="col">Moi</th><th scope="col">Réalisé</th><th scope="col">Écart</th></tr></thead><tbody>' + recRows(r) + '</tbody></table></div>') +
        (r.note ? '<p class="prose">' + esc(String(r.note).trim()) + '</p>' : '') +
        (repo ? '<a class="linkish" href="https://github.com/' + esc(repo) + '/blob/main/' + esc(r.id) + '" target="_blank" rel="noopener">Voir le fichier et son historique</a>' : '') + '</article>';
    }).join('') : '<p class="sub">' + (recs.length ? 'Rien dans ce filtre.' : 'Pas encore de prédiction. Écris la première juste en dessous : elle sera notée à la publication.') + '</p>';
  }
  $('pred-chips').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; filter = b.getAttribute('data-f'); renderList(); });

  /* ======================= composer ======================= */
  var tk = null, ref = null;
  var sel = $('p-ticker');
  sel.innerHTML = COV.map(function (c) { return '<option value="' + esc(c.ticker) + '">' + esc(c.ticker + ', ' + c.name) + '</option>'; }).join('');
  function scorable(t) { return !!S.tracked[t]; }
  function nextOf(t) { return S.core && S.core.predictions && S.core.predictions.next && S.core.predictions.next[t]; }

  function metricTable() {
    var head = '<thead><tr><th scope="col">Indicateur</th><th scope="col">Ma prévision</th><th scope="col">Bas</th><th scope="col">Haut</th><th scope="col">Dernier publié</th><th scope="col">Naïf</th><th scope="col">Consensus</th></tr></thead>';
    return head + '<tbody>' + P.METRICS.map(function (m) {
      var r = ref && ref.metrics && ref.metrics[m.key], hist = r && r.history, last = hist && hist.length ? hist[hist.length - 1] : null;
      var cell = function (f, lab) { return '<td><input type="text" inputmode="decimal" autocomplete="off" data-k="' + m.key + '" data-f="' + f + '" aria-label="' + esc(m.label + ', ' + lab) + '"></td>'; };
      return '<tr><th scope="row">' + esc(m.label) + ' <small>' + esc(m.unit) + '</small></th>' + cell('value', 'ma prévision') + cell('low', 'bas de l’intervalle') + cell('high', 'haut de l’intervalle') +
        '<td class="ref">' + (last ? P.formValue(last.value, m.unit) + ' <small>' + esc(last.label) + '</small>' : '') + '</td><td class="ref">' + (r ? P.formValue(r.naive, m.unit) : '') + '</td><td class="ref">' + (r && r.consensus ? P.formValue(r.consensus.avg, m.unit) : '') + '</td></tr>';
    }).join('') + '</tbody>';
  }
  function eventRow(e) {
    e = e || {};
    return '<div class="erow"><div class="field grow"><label>Question</label><input type="text" class="q" value="' + esc(e.question || '') + '" placeholder="Ex. le chiffre d’affaires dépasse-t-il le haut de la guidance ?"></div>' +
      '<div class="field"><label>Probabilité de oui, %</label><input type="text" inputmode="decimal" class="p" value="' + esc(e.probability || '') + '" placeholder="60"></div>' +
      '<button type="button" class="close rm" aria-label="Retirer cette question"><svg aria-hidden="true"><use href="#g-x"/></svg></button></div>';
  }
  function priceRow(p) {
    p = p || {};
    return '<div class="erow"><div class="field"><label>Date visée</label><input type="date" class="d" value="' + esc(p.date || '') + '" min="' + localToday() + '"></div>' +
      '<div class="field"><label>Cours visé, $</label><input type="text" inputmode="decimal" class="v" value="' + esc(p.value || '') + '"></div>' +
      '<div class="field"><label>Bas, $</label><input type="text" inputmode="decimal" class="lo" value="' + esc(p.low || '') + '"></div>' +
      '<div class="field"><label>Haut, $</label><input type="text" inputmode="decimal" class="hi" value="' + esc(p.high || '') + '"></div>' +
      '<button type="button" class="close rm" aria-label="Retirer cet objectif"><svg aria-hidden="true"><use href="#g-x"/></svg></button></div>';
  }
  function collect() {
    var d = { ticker: tk, period: $('p-period').value, metrics: {}, events: [], price: [], note: $('p-note').value };
    if (scorable(tk)) {
      document.querySelectorAll('#p-metrics input').forEach(function (i) {
        var v = i.value.trim(); if (!v) return;
        var k = i.getAttribute('data-k'); (d.metrics[k] = d.metrics[k] || {})[i.getAttribute('data-f')] = v;
      });
    }
    document.querySelectorAll('#p-events .erow').forEach(function (r) {
      var q = r.querySelector('.q').value.trim(), p = r.querySelector('.p').value.trim();
      if (q || p) d.events.push({ question: q, probability: p });
    });
    document.querySelectorAll('#p-prices .erow').forEach(function (r) {
      var o = { date: r.querySelector('.d').value, value: r.querySelector('.v').value.trim(), low: r.querySelector('.lo').value.trim(), high: r.querySelector('.hi').value.trim() };
      if (o.date || o.value || o.low || o.high) d.price.push(o);
    });
    return d;
  }
  function saveDraft(d) { try { localStorage.setItem('mangrove-brouillon-' + tk, JSON.stringify(d)); } catch (e) { /* storage off */ } }
  function loadDraft(t) { try { return JSON.parse(localStorage.getItem('mangrove-brouillon-' + t) || 'null'); } catch (e) { return null; } }
  function update() {
    if (!tk) return;
    var d = collect(), now = new Date();
    saveDraft(d);
    var errs = P.validate(d, { today: localToday(), metricsAllowed: scorable(tk) });
    var touched = Object.keys(d.metrics).length || d.events.length || d.price.length;
    $('p-check').innerHTML = !touched ? '<p class="help">Remplis au moins une prévision pour composer le fichier.</p>' : errs.length ?
      '<ul class="errs">' + errs.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>' : '<p class="okline">Prêt à être enregistré.</p>';
    var y = P.toYaml(d, now), fname = P.fileName(d, now);
    $('p-yaml').textContent = y;
    $('p-fname').textContent = fname;
    var save = $('p-save'), ok = touched && !errs.length && cfg.repo;
    save.setAttribute('aria-disabled', ok ? 'false' : 'true');
    save.classList.toggle('off', !ok);
    save.href = ok ? P.newFileUrl(cfg.repo, fname, y) : '#';
  }
  $('p-save').addEventListener('click', function (e) { if (this.getAttribute('aria-disabled') === 'true') e.preventDefault(); });
  $('p-copy').addEventListener('click', function () {
    var txt = $('p-yaml').textContent, b = this;
    var done = function () { b.textContent = 'Copié'; setTimeout(function () { b.textContent = 'Copier le fichier'; }, 1600); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, fallback); else fallback();
    function fallback() { var r = document.createRange(); r.selectNodeContents($('p-yaml')); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); try { document.execCommand('copy'); done(); } catch (e) { /* user copies by hand */ } }
  });

  function setTicker(t) {
    tk = t; sel.value = t; ref = null;
    var ok = scorable(t), nx = nextOf(t), c = MG.byTicker[t] || {};
    $('p-metrics-set').hidden = !ok;
    $('p-period-field').hidden = !ok;
    $('p-metrics-off').hidden = ok;
    $('p-metrics-off').textContent = c.etf ? t + ' est un ETF : on y prévoit le cours (objectifs) et des questions oui / non.' :
      !S.ready ? 'Chargement…' : t + ' n’a pas de comptes trimestriels notés automatiquement (rapport annuel 20-F à la SEC) : prévois son cours et pose des questions oui / non, que tu trancheras.';
    $('p-period-help').textContent = ok && nx ? 'Prochaine publication : ' + nx.period + ', le ' + day(nx.date) + (nx.estimated ? ' (date estimée)' : '') + '. Échéance : 0 h, heure de New York, le jour de la publication.' : '';
    $('p-price-help').textContent = 'Vérifiés sur la clôture de ' + t + ' le jour visé (ou la séance suivante).';
    var draft = loadDraft(t) || {};
    $('p-period').value = draft.period || (nx ? nx.period : '');
    $('p-metrics').innerHTML = metricTable();
    Object.keys(draft.metrics || {}).forEach(function (k) {
      Object.keys(draft.metrics[k]).forEach(function (f) { var i = document.querySelector('#p-metrics input[data-k="' + k + '"][data-f="' + f + '"]'); if (i) i.value = draft.metrics[k][f]; });
    });
    $('p-events').innerHTML = (draft.events || []).map(eventRow).join('');
    $('p-prices').innerHTML = (draft.price || []).map(priceRow).join('');
    $('p-note').value = draft.note || '';
    update();
    if (ok) D.predict(t).then(function (r) {
      if (tk !== t || !r) return;
      ref = r;
      var vals = {}; document.querySelectorAll('#p-metrics input').forEach(function (i) { vals[i.getAttribute('data-k') + '|' + i.getAttribute('data-f')] = i.value; });
      $('p-metrics').innerHTML = metricTable();
      document.querySelectorAll('#p-metrics input').forEach(function (i) { i.value = vals[i.getAttribute('data-k') + '|' + i.getAttribute('data-f')] || ''; });
    });
  }
  sel.addEventListener('change', function () { picked = true; setTicker(sel.value); });
  $('pform').addEventListener('input', update);
  $('pform').addEventListener('click', function (e) {
    var rm = e.target.closest('.rm'); if (rm) { rm.closest('.erow').remove(); update(); }
  });
  $('p-add-event').addEventListener('click', function () { $('p-events').insertAdjacentHTML('beforeend', eventRow()); $('p-events').lastElementChild.querySelector('input').focus(); update(); });
  $('p-add-price').addEventListener('click', function () { $('p-prices').insertAdjacentHTML('beforeend', priceRow()); $('p-prices').lastElementChild.querySelector('input').focus(); update(); });

  window.MGPredict = {
    start: function (t) {
      if (MG.byTicker[t]) { picked = true; setTicker(t); }
      var h = $('ecrire'); if (h) h.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      setTimeout(function () { var f = scorable(tk) ? document.querySelector('#p-metrics input') : $('p-add-price'); if (f) f.focus({ preventScroll: true }); }, 450);
    }
  };

  /* re-render the form only when what it depends on changed, never while it is being typed in for nothing */
  var formKey = null, picked = false;
  function onData() {
    renderBoard(); renderList();
    var tr = Object.keys(S.tracked);
    var t = picked && tk ? tk : (tr.length ? tr[0] : COV[0].ticker);
    var key = t + '|' + scorable(t) + '|' + JSON.stringify(nextOf(t) || null) + '|' + (S.ready ? 'ready' : 'loading');
    if (key !== formKey) { formKey = key; setTicker(t); }
  }
  MG.on.push(onData);
  onData();
})();
