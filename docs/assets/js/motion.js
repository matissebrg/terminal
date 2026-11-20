/* Mangrove — motion. Everything here moves with transform or opacity, so the browser's compositor does the work
   and the main thread stays free (the page has to stay smooth on an office PC without a graphics card).

   - Reveals: each section's content arrives once, the first time it scrolls into view. The container gets .in, its
     children read a --d delay set here; .settled is added when the entrance is over so hover transitions are normal again.
   - Ambient loops (waves, bubbles, the tide, the sheen on the tree): run only while their section is on screen (.on).
   - Scroll-linked motion (hero copy, tree, roots, the closing word) is pure CSS (animation-timeline), see mangrove.css.
   - Nothing here runs under "reduce motion"; the pause buttons (hero and footer) stop every loop via body.still. */
(function () {
  'use strict';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduce.matches || !('IntersectionObserver' in window)) return;
  var root = document.documentElement;
  root.classList.add('mo');
  var $ = function (id) { return document.getElementById(id); };
  var qa = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };

  /* ---------- headings surface through a waterline ---------- */
  qa('.sec-head h2').forEach(function (h) {
    if (h.querySelector('.rise')) return;
    var s = document.createElement('span'); s.className = 'rise';
    while (h.firstChild) s.appendChild(h.firstChild);
    h.appendChild(s);
  });

  /* ---------- reveals ---------- */
  var REVEALS = [
    { el: qa('.sec-head'), kids: '.meter, .sub, .chips', step: 90, total: 1300 },
    { el: [$('feed')], kids: '.entry', step: 90, total: 1500 },
    { el: qa('.horizon'), kids: '.mast', step: 110, total: 2200 },
    { el: qa('.tide-card'), kids: '.g', step: 140, total: 2600 },
    { el: qa('.roots-art'), kids: '.veil', step: 0, total: 3400 },
    { el: [$('values')], kids: '.value', step: 120, total: 1900 },
    { el: [$('lib-roots')], kids: '.tile, .col h3', step: 55, total: 2000 },
    { el: qa('.closing'), kids: '.mark, .word, .base', step: 160, total: 1600 }
  ];
  var byEl = new Map();
  REVEALS.forEach(function (r) { r.el.forEach(function (el) { if (el) { el.setAttribute('data-rv', ''); byEl.set(el, r); } }); });

  var rio = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      var el = e.target, r = byEl.get(el);
      rio.unobserve(el);
      qa(r.kids, el).forEach(function (k, i) { k.style.setProperty('--d', Math.min(i, 14) * r.step + 'ms'); });
      el.classList.add('in');
      if (el.classList.contains('tide-card')) countUp(el);
      setTimeout(function () { el.classList.add('settled'); }, r.total + Math.min(qa(r.kids, el).length, 14) * r.step);
    });
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });
  byEl.forEach(function (r, el) { rio.observe(el); });

  /* the tide card's numbers count up from zero, once, keeping the French decimal comma */
  function countUp(card) {
    qa('.g .big', card).forEach(function (big, i) {
      var node = big.firstChild;
      if (!node || node.nodeType !== 3) return;
      var m = /^(\s*)(\d+)(?:,(\d+))?(.*)$/.exec(node.nodeValue);
      if (!m) return;
      var dec = m[3] ? m[3].length : 0, target = parseFloat(m[2] + (dec ? '.' + m[3] : '')), t0 = 0, dur = 1500, delay = 250 + i * 140;
      var fmt = function (v) { return m[1] + v.toFixed(dec).replace('.', ',') + m[4]; };
      node.nodeValue = fmt(0);
      function frame(now) {
        if (!t0) t0 = now;
        var p = Math.min(1, Math.max(0, (now - t0 - delay) / dur)), e = 1 - Math.pow(1 - p, 4);
        if (big.firstChild !== node) return;            // re-rendered meanwhile: the new text is already final
        node.nodeValue = fmt(target * e);
        if (p < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  }

  /* ---------- bubbles in the dark water ---------- */
  var small = window.matchMedia('(max-width: 720px)').matches;
  function bubbles(host, n) {
    if (!host) return null;
    var box = document.createElement('div'); box.className = 'bubbles'; box.setAttribute('aria-hidden', 'true');
    var html = '';
    n = Math.round(n * (small ? 0.55 : 1));
    for (var i = 0; i < n; i++) {
      var s = 3 + Math.pow(Math.random(), 2) * 9;
      html += '<span style="--x:' + (4 + Math.random() * 92).toFixed(1) + '%;--s:' + s.toFixed(1) + 'px;--t:' + (9 + Math.random() * 10).toFixed(1) +
        's;--w:-' + (Math.random() * 18).toFixed(1) + 's;--dx:' + ((Math.random() - 0.5) * 60).toFixed(0) + 'px"></span>';
    }
    box.innerHTML = html;
    host.insertBefore(box, host.firstChild);
    return box;
  }
  var boxes = [bubbles($('maree'), 14), bubbles(document.querySelector('.roots-art'), 18), bubbles(document.querySelector('.closing'), 9)].filter(Boolean);
  function sizeBubbles() { boxes.forEach(function (b) { b.style.setProperty('--rise', (b.offsetHeight + 40) + 'px'); }); }
  sizeBubbles();
  var rt = 0;
  window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(sizeBubbles, 200); });

  /* ---------- loops run only on screen ---------- */
  var oio = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { e.target.classList.toggle('on', e.isIntersecting); });
  }, { rootMargin: '80px 0px' });
  qa('.hero, .horizon, .tide-card, .roots-art, .closing').concat(boxes).forEach(function (el) { oio.observe(el); });

  /* ---------- light sweeping over the chrome: the tree's own alpha masks the band ---------- */
  var stage = $('stage'), tree = stage && stage.querySelector('.tree');
  function maskTree() {
    var src = tree.currentSrc || tree.src;
    if (!src) return;
    stage.style.setProperty('--tree-mask', 'url("' + src + '")');
    stage.classList.add('masked');                      // the sheen only shows once it can be clipped to the tree
  }
  if (tree) { if (tree.complete) maskTree(); else tree.addEventListener('load', maskTree); }

  /* ---------- a lamp under the water: a soft light that follows the pointer (mouse only) ---------- */
  if (window.matchMedia('(pointer: fine)').matches) {
    var lamp = document.createElement('div'); lamp.className = 'lamp'; lamp.setAttribute('aria-hidden', 'true');
    document.body.insertBefore(lamp, document.body.firstChild);
    var tx = innerWidth / 2, ty = innerHeight / 2, x = tx, y = ty, raf = 0;
    lamp.style.transform = 'translate3d(' + (x - 300) + 'px,' + (y - 300) + 'px,0)';
    function step() {
      x += (tx - x) * 0.12; y += (ty - y) * 0.12;
      lamp.style.transform = 'translate3d(' + (x - 300).toFixed(1) + 'px,' + (y - 300).toFixed(1) + 'px,0)';
      raf = (Math.abs(tx - x) + Math.abs(ty - y) > 0.5) ? requestAnimationFrame(step) : 0;
    }
    window.addEventListener('pointermove', function (e) {
      tx = e.clientX; ty = e.clientY;
      if (!raf && document.body.classList.contains('below') && !document.body.classList.contains('still')) raf = requestAnimationFrame(step);
    }, { passive: true });
  }
})();
