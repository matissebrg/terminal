/* Mangrove — the first screen: the chrome mangrove with the covered stocks orbiting its crown,
   the latest entry and the next publication floating beside it, and the one entrance.
   The orbit moves seven small cards with transform and opacity only, pauses off screen,
   on a hidden tab, under reduced motion, and on the pause button. */
(function () {
  'use strict';
  var MG = window.MG, A = MG.api, S = MG.state;
  var COV = window.MG_COVERAGE || [];
  var INK = { 'Pharma': '#0B6A4E', 'Logiciels santé': '#3E57A8', 'Référence': '#9A6512' };
  function $(id) { return document.getElementById(id); }
  var esc = A.esc;

  /* ---------- entrance: once, when the tree is decoded ---------- */
  var root = document.documentElement, tree = document.querySelector('.stage .tree');
  function enter() { requestAnimationFrame(function () { root.classList.add('entered'); }); }
  if (tree && !tree.complete) { tree.addEventListener('load', enter, { once: true }); tree.addEventListener('error', enter, { once: true }); setTimeout(enter, 1200); }
  else enter();

  /* ---------- orbit ---------- */
  var stage = $('stage'), orbit = $('orbit');
  var cards = COV.map(function (c, i) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'ocard';
    b.setAttribute('data-open', c.ticker);
    orbit.appendChild(b);
    return { el: b, c: c, i: i, z: null };
  });
  function fill() {
    cards.forEach(function (k) {
      var q = A.quote(k.c.ticker), col = INK[k.c.root] || '#0B6A4E';
      k.el.setAttribute('aria-label', 'Dossier ' + k.c.ticker + ', ' + k.c.name + (q && A.money(q.price) !== 'n.d.' ? ', ' + A.money(q.price) : ''));
      k.el.innerHTML = '<span class="sym" translate="no">' + esc(k.c.ticker) + '</span>' +
        '<span class="chg ' + (q ? A.dirClass(q.chg_1d) : '') + '">' + (q && q.chg_1d != null ? A.pct(q.chg_1d) : '') + '</span>' +
        '<span class="nm">' + esc(k.c.name) + '</span>' +
        '<span class="px">' + (q && q.price != null ? A.money(q.price) : (S.ready ? 'en attente' : '…')) + '</span>' +
        (A.spark(A.sparkOf(k.c.ticker), col) || '');
    });
  }
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var userPaused = false, visible = true, angle = 0, last = 0, raf = 0, geo = null;
  var PERIOD = 80000;   // one turn every 80 s: slow enough to read a card as it passes
  function measure() {
    var w = stage.clientWidth, h = stage.clientHeight, small = w < 600;
    geo = { cx: w * 0.5, cy: w * (small ? 0.163 : 0.16),   /* crown height, from the width: the image runs on below */ rx: w * (small ? 0.4 : 0.39), ry: w * 0.065,
            cw: cards[0] ? cards[0].el.offsetWidth : 170, ch: cards[0] ? cards[0].el.offsetHeight : 90 };
  }
  /* Hover (or keyboard focus) grows a card: it turns to face you, comes forward, and the orbit eases to a stop so it
     stays under the pointer; leaving lets the orbit pick up speed again. All in the same transform, no layout. */
  var spd = 1, GROW = 0.24;
  function place(a) {
    var n = cards.length;
    for (var i = 0; i < n; i++) {
      var k = cards[i], h = k.h || 0, th = a + i * 2 * Math.PI / n, s = Math.sin(th), co = Math.cos(th), front = co > -0.08;
      var x = geo.cx + geo.rx * s - geo.cw / 2, y = geo.cy + geo.ry * co - geo.ch / 2 - 10 * h;
      var depth = (co + 1) / 2, sc = (0.74 + 0.26 * depth) * (1 + GROW * h), op = 0.3 + 0.7 * depth;
      k.el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0) rotateY(' + (-s * 32 * (1 - h)).toFixed(1) + 'deg) scale(' + sc.toFixed(3) + ')';
      k.el.style.opacity = (op + (1 - op) * h).toFixed(3);
      var z = h > 0.02 ? 4 : front ? 3 : 1;
      if (k.z !== z) { k.el.style.zIndex = z; k.el.tabIndex = front || z === 4 ? 0 : -1; k.z = z; }
    }
  }
  function orbiting() { return !userPaused && visible && !reduce.matches && !document.hidden; }
  function settling() { return cards.some(function (k) { return Math.abs((k.h || 0) - (k.ht || 0)) > 0.002; }) || (orbiting() && Math.abs(spd - (hot() ? 0 : 1)) > 0.002); }
  function hot() { return cards.some(function (k) { return k.ht; }); }
  function running() { return orbiting() || settling(); }
  function frame(t) {
    raf = 0;
    var dt = last ? Math.min(t - last, 64) : 16;
    last = t;
    var ease = 1 - Math.exp(-dt / 90);
    cards.forEach(function (k) { k.h = reduce.matches ? (k.ht || 0) : (k.h || 0) + ((k.ht || 0) - (k.h || 0)) * ease; });
    spd += ((hot() ? 0 : 1) - spd) * (1 - Math.exp(-dt / 260));
    if (hot() && spd < 0.01) spd = 0;
    if (orbiting()) angle += dt / PERIOD * 2 * Math.PI * spd;
    place(angle);
    if (running()) raf = requestAnimationFrame(frame);
  }
  function kick() { if (running() && !raf) { last = 0; raf = requestAnimationFrame(frame); } }
  function setHot(k, on) { k.ht = on ? 1 : 0; k.el.classList.toggle('hot', on); kick(); }
  cards.forEach(function (k) {
    k.el.addEventListener('pointerenter', function (e) { if (e.pointerType !== 'touch') setHot(k, true); });
    k.el.addEventListener('pointerleave', function () { if (document.activeElement !== k.el) setHot(k, false); });
    k.el.addEventListener('focus', function () { if (k.el.matches(':focus-visible')) setHot(k, true); });
    k.el.addEventListener('blur', function () { if (!k.el.matches(':hover')) setHot(k, false); });
  });
  function relayout() { measure(); place(angle); }
  fill();
  relayout();
  kick();
  window.addEventListener('resize', function () { relayout(); }, { passive: true });
  document.addEventListener('visibilitychange', kick);
  if (reduce.addEventListener) reduce.addEventListener('change', function () { relayout(); kick(); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (en) { visible = en[0].isIntersecting; kick(); }).observe(stage);
  }
  /* keyboard: a focused card comes round to the front */
  orbit.addEventListener('focusin', function (e) {
    var b = e.target.closest('.ocard'); if (!b) return;
    var k = cards.filter(function (x) { return x.el === b; })[0];
    if (!k) return;
    angle = -k.i * 2 * Math.PI / cards.length;
    place(angle);
  });

  /* One pause for every moving thing on the page: the hero button and its twin in the footer. */
  var toggles = [$('motion-toggle'), $('motion-toggle-foot')].filter(Boolean);
  function setPaused(p) {
    userPaused = p;
    document.body.classList.toggle('still', p);
    toggles.forEach(function (t) {
      t.setAttribute('aria-pressed', String(p));
      if (t.id === 'motion-toggle') {
        t.setAttribute('aria-label', p ? 'Relancer les animations' : 'Mettre les animations en pause');
        t.innerHTML = '<svg aria-hidden="true"><use href="#g-' + (p ? 'play' : 'pause') + '"/></svg>';
      } else {
        t.textContent = p ? 'Relancer les animations' : 'Mettre les animations en pause';
      }
    });
    kick();
  }
  toggles.forEach(function (t) { t.addEventListener('click', function () { setPaused(!userPaused); }); });

  /* ---------- floating cards and the cover line ---------- */
  function floats() {
    var items = A.feedItems(), latest = items[0];
    $('hero-latest').innerHTML = latest ?
      '<p class="k"><span class="dot" aria-hidden="true"></span>Dernière entrée, ' + esc(A.fmt(latest.date)) + '</p>' +
      '<h3>' + esc(latest.title.length > 70 ? latest.title.slice(0, 68) + '…' : latest.title) + '</h3>' +
      '<p>' + esc(latest.label) + (latest.ticker ? ', ' + esc(latest.ticker) : '') + '</p>' +
      (latest.ticker ? '<button type="button" class="linkish" data-open="' + esc(latest.ticker) + '">Ouvrir le dossier</button>' : '<a class="linkish" href="#canopee">Lire le fil</a>') :
      '<p class="k"><span class="dot" aria-hidden="true"></span>Le fil</p><h3>' + (S.ready ? 'Encore vide' : 'Chargement…') + '</h3>';
    var next = A.cats().filter(function (c) { return c.date >= A.T0; })[0];
    $('hero-next').innerHTML = next ?
      '<p class="k"><span class="dot" aria-hidden="true"></span>' + (next.kind === 'Résultats' ? 'Prochaine publication' : 'Prochaine date') + '</p>' +
      '<h3>' + esc(next.ticker) + ', ' + esc(A.fmt(next.date).replace(/ \d{4}$/, '')) + '</h3>' +
      '<p>' + esc(next.description) + '</p>' +
      (next.predictable ? '<button type="button" class="linkish" data-predict="' + esc(next.ticker) + '">Prévoir ces résultats</button>' : '<a class="linkish" href="#ligne-d-eau">Voir le calendrier</a>') :
      '<p class="k"><span class="dot" aria-hidden="true"></span>Calendrier</p><h3>' + (S.ready ? 'Rien d’annoncé' : 'Chargement…') + '</h3>';
    var stocks = COV.filter(function (c) { return !c.etf; }).length, etfs = COV.length - stocks;
    $('hero-cover').innerHTML = '<p><b>' + COV.length + ' valeurs</b>' + stocks + ' actions et ' + (etfs === 1 ? 'l’ETF santé de référence' : etfs + ' ETF') + '</p>' +
      '<div class="tick">' + COV.map(function (c) { return '<button type="button" data-open="' + esc(c.ticker) + '" translate="no">' + esc(c.ticker) + '</button>'; }).join('') + '</div>';
    var gen = S.core && S.core.universe && S.core.universe.meta && S.core.universe.meta.generated_at;
    var d = gen ? new Date(gen) : null;
    $('hero-pill').lastElementChild.textContent = d && !isNaN(d) ? 'Données de marché du ' + d.getDate() + ' ' + A.MONTHS[d.getMonth()] + ' ' + d.getFullYear() :
      (S.ready && S.core && !S.core.ok ? 'Données de marché injoignables' : 'Bibliothèque de recherche pharma');
  }
  floats();
  MG.on.push(function () { fill(); floats(); relayout(); });
})();
