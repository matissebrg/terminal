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

  /* ---------- light mode for slow machines ----------
     For two seconds after load, watch the frame rhythm; if most frames take longer than ~28 ms, the PC is struggling:
     body.lite drops the decorative extras (bubbles, sheen, pointer lamp, floating cards) and slows the waves. */
  (function () {
    var times = [], last = 0, start = performance.now();
    function probe(now) {
      if (last) times.push(now - last);
      last = now;
      if (now - start < 2200) return requestAnimationFrame(probe);
      times.sort(function (a, b) { return a - b; });
      var med = times[times.length >> 1] || 16;
      if (med > 28) {
        document.body.classList.add('lite');
        if (window.MG) { MG.lite = true; (MG.waves || []).forEach(function (w) { w.size(); w.draw(w.t || 0); }); }
      }
    }
    requestAnimationFrame(probe);
  })();

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
    { el: [$('values')], kids: '.value', step: 120, total: 1900 },
    { el: [$('lib-roots')], kids: '.tile, .col h3', step: 55, total: 2000 },
    { el: qa('.closing'), kids: '.mark, .word, .base', step: 160, total: 1600 }
  ];
  var byEl = new Map();
  REVEALS.forEach(function (r) { r.el.forEach(function (el) { if (el) { el.setAttribute('data-rv', ''); byEl.set(el, r); } }); });

  function reveal(el) {
    var r = byEl.get(el);
    if (!r || el.classList.contains('in')) return;
    rio.unobserve(el);
    qa(r.kids, el).forEach(function (k, i) { k.style.setProperty('--d', Math.min(i, 14) * r.step + 'ms'); });
    el.classList.add('in');
    if (el.classList.contains('tide-card')) { countUp(el); (window.MG && MG.waves || []).forEach(function (w) { if (w.el.parentNode === el && w.rise) w.rise(); }); }
    setTimeout(function () { el.classList.add('settled'); }, r.total + Math.min(qa(r.kids, el).length, 14) * r.step);
  }
  var held = new Set();     // containers that wait for something else before they reveal (the principles wait for the roots)
  var rio = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting && !held.has(e.target)) reveal(e.target); });
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

  /* ---------- waves: redraw the wave canvases while they are on screen ----------
     Time-based, so a slow frame never makes the water jump; if a frame costs too much (old PC), drop to 30 fps. */
  var waves = (window.MG && MG.waves) || [], live = new Set(), wraf = 0, t0w = 0, slow = 1;
  /* Each field redraws at its own steady rate (30 fps for the sea, 20 for the score card's lines): a steady rhythm
     reads as smooth, and it costs a fraction of 60 fps. Time-based, so a late frame never makes the water jump. If a
     redraw still costs too much (old PC), the rate is lowered a notch. */
  var gaps = [], lastNow = 0;
  function goLite() {
    if (window.MG && MG.lite) return;
    document.body.classList.add('lite');
    MG.lite = true;
    waves.forEach(function (w) { w.size(); w.draw(w.t || 0); });
  }
  function wtick(now) {
    wraf = 0;
    if (!live.size || document.body.classList.contains('still') || document.hidden) { t0w = 0; lastNow = 0; return; }
    /* the machine is judged while the water actually moves: if frames keep arriving late, switch to light mode */
    if (lastNow) { gaps.push(now - lastNow); if (gaps.length >= 90) { gaps.sort(function (a, b) { return a - b; }); if (gaps[45] > 24) goLite(); gaps = []; } }
    lastNow = now;
    if (!t0w) t0w = now - (waves[0].t || 0) * 1000;
    var t = (now - t0w) / 1000;
    live.forEach(function (wv) {
      var every = 1000 / (wv.fps * (window.MG && MG.lite ? 0.67 : slow));
      if (wv.at && now - wv.at < every - 4) return;
      wv.at = now; wv.t = t;
      var c0 = performance.now(); wv.draw(t);
      wv.cost = (wv.cost || 0) * 0.9 + (performance.now() - c0) * 0.1;
      if (wv.cost > 6 && slow > 0.6) slow = 0.67;
    });
    wraf = requestAnimationFrame(wtick);
  }
  function wkick() { if (!wraf && live.size) wraf = requestAnimationFrame(wtick); }
  if (waves.length) {
    var wio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var wv = waves.filter(function (x) { return x.el === e.target; })[0];
        if (!wv) return;
        if (e.isIntersecting) live.add(wv); else live.delete(wv);
      });
      wkick();
    });
    waves.forEach(function (wv) { wio.observe(wv.el); });
    document.addEventListener('visibilitychange', wkick);
    new MutationObserver(wkick).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  /* ---------- the roots grow down, then sway forever ----------
     Two renders (Blender): the growth (3.8 s, played once) and a 4 s loop of the grown roots swept by a current,
     whose first frame is the growth's last. Both are fetched well before the section is reached, so playback starts
     on a decoded video (no stall, no flash); the growth starts from its poster (its own first frame); when it ends
     the loop underneath starts and the growth is hidden on the very same picture. Phones get 960 px versions. */
  var rootsArt = document.querySelector('.roots-art');
  var grow = rootsArt && rootsArt.querySelector('video.roots-grow'), sway = rootsArt && rootsArt.querySelector('video.roots-sway');
  if (grow && sway && grow.canPlayType('video/mp4')) {
    rootsArt.classList.add('has-video');
    var vals = $('values');
    if (vals) held.add(vals);                                         // the principles hang from grown roots
    var release = function () {
      if (!vals || !held.has(vals)) return;
      held.delete(vals);
      var r = vals.getBoundingClientRect();
      if (r.top < innerHeight && r.bottom > 0) reveal(vals);
    };
    var fallback = function () { rootsArt.classList.remove('has-video'); release(); };   // the still picture shows
    var size = innerWidth <= 720 ? 960 : 1920;
    var fetched = false;
    function fetchVideos() {
      if (fetched) return; fetched = true;
      grow.preload = 'auto'; grow.src = 'assets/video/roots-grow-' + size + '.mp4'; grow.load();
      sway.preload = 'auto'; sway.src = 'assets/video/roots-sway-' + size + '.mp4'; sway.load();
      grow.addEventListener('error', fallback);
    }
    new IntersectionObserver(function (en, o) { if (en[0].isIntersecting) { o.disconnect(); fetchVideos(); } },
      { rootMargin: '0px 0px 1400px 0px' }).observe(rootsArt);
    var started = false;
    function start() {
      if (started) return; started = true;
      fetchVideos();
      var go = function () { var p = grow.play(); if (p && p.catch) p.catch(fallback); };
      if (grow.readyState >= 3) go(); else grow.addEventListener('canplay', go, { once: true });
    }
    new IntersectionObserver(function (en, o) { if (en[0].isIntersecting) { o.disconnect(); start(); } }, { threshold: 0.3 }).observe(rootsArt);
    grow.addEventListener('timeupdate', function () { if (grow.duration && grow.currentTime > grow.duration - 0.3) release(); });
    grow.addEventListener('ended', function () {
      release();
      var p = sway.play();
      if (p && p.then) p.then(function () { grow.classList.add('done'); }).catch(function () {});   // if the loop cannot play, the growth's last frame stays
    });
    /* the pause buttons hold the roots too; the loop also rests while the section is off screen */
    var swayOn = true;
    function syncPlay() {
      var still = document.body.classList.contains('still') || document.hidden;
      if (grow.src && !grow.ended && started) { if (still) grow.pause(); else if (grow.paused) grow.play().catch(function () {}); }
      if (grow.classList.contains('done')) { if (still || !swayOn) sway.pause(); else if (sway.paused) sway.play().catch(function () {}); }
    }
    new MutationObserver(syncPlay).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('visibilitychange', syncPlay);
    new IntersectionObserver(function (en) { swayOn = en[0].isIntersecting; syncPlay(); }).observe(rootsArt);
  }

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
      var c = document.body.classList;
      if (!raf && c.contains('below') && !c.contains('still') && !c.contains('lite')) raf = requestAnimationFrame(step);
    }, { passive: true });
  }
})();
