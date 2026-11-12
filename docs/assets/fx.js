/* Visual effects layer. Everything here is decoration on top of a page that works without it:
   - animated background field (WebGL2 fragment shader: contour lines of a slow noise terrain that the pointer lifts)
   - light following the pointer along panel frames
   - route changes through the View Transitions API
   - sliding marker under the active tab
   - one boot sequence per browser session, a short decode of the headline figures
   - market clock and the effects switch in the top bar
   Effects are off when the visitor asks for reduced motion or has switched them off (localStorage "archer-fx" = "off");
   <html class="fx-off"> then also stills the CSS side. */
(function () {
  "use strict";
  const T = window.T, root = document.documentElement;
  const mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } } };
  const FX = (window.FX = {
    pref: () => store.get("archer-fx") !== "off",
    on: () => FX.pref() && !mq.matches,
  });
  const sync = () => root.classList.toggle("fx-off", !FX.on());
  sync();

  // ------------------------------------------------------------------ background field
  const VERT = "#version 300 es\nin vec2 p; void main() { gl_Position = vec4(p, 0., 1.); }";
  const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uT; uniform vec2 uP; uniform float uPa;
out vec4 o;
// simplex noise, Ian McEwan / Ashima Arts (MIT)
vec3 perm(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy)), x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 pm = perm(perm(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(pm * C.www) - 1.0, h = abs(x) - 0.5, ox = floor(x + 0.5), a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g; g.x = a0.x * x0.x + h.x * x0.y; g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes.y, pp = uP / uRes.y;
  float d = distance(uv, pp);
  float h = snoise(uv * 1.15 + vec2(uT * 0.016, 0.0)) * 0.62 + snoise(uv * 2.4 - vec2(0.0, uT * 0.012)) * 0.26 + snoise(uv * 5.0 + uT * 0.008) * 0.07;
  h += uPa * 0.42 * exp(-d * d * 11.0);                       // the pointer lifts the terrain: contours bend around it
  float k = h * 7.0, f = abs(fract(k) - 0.5), w = fwidth(k);
  float line = 1.0 - smoothstep(0.0, w * 1.15, f);             // one contour per level
  float major = mod(floor(k), 4.0) < 0.5 ? 1.0 : 0.38;         // every fourth level is brighter
  float vig = smoothstep(1.25, 0.25, distance(gl_FragCoord.xy / uRes, vec2(0.62, 0.55)));
  float a = line * major * (0.07 + 0.13 * vig) + uPa * 0.04 * exp(-d * d * 22.0);
  vec3 col = mix(vec3(0.46, 0.60, 1.0), vec3(0.86, 0.92, 1.0), line * major);
  o = vec4(col * a, a);
}`;
  const bg = { gl: null, raf: 0, t0: performance.now(), px: -9999, py: -9999, pa: 0, pTarget: 0, last: 0 };
  function bgInit() {
    const cv = document.getElementById("fx-bg");
    if (!cv || bg.gl) return !!bg.gl;
    const gl = cv.getContext("webgl2", { alpha: true, antialias: false, premultipliedAlpha: true, powerPreference: "low-power" });
    if (!gl) return false;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    try {
      const pr = gl.createProgram();
      gl.attachShader(pr, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
      gl.useProgram(pr);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      bg.u = { res: gl.getUniformLocation(pr, "uRes"), t: gl.getUniformLocation(pr, "uT"), p: gl.getUniformLocation(pr, "uP"), pa: gl.getUniformLocation(pr, "uPa") };
    } catch (e) { console.warn("fond animé indisponible :", e.message); return false; }
    bg.gl = gl; bg.cv = cv;
    cv.addEventListener("webglcontextlost", (e) => { e.preventDefault(); cancelAnimationFrame(bg.raf); bg.raf = 0; });
    bgSize();
    return true;
  }
  function bgSize() {
    if (!bg.gl) return;
    const s = Math.min(window.devicePixelRatio || 1, 1.5) * 0.75;   // three quarters of the pixels are plenty for soft lines
    const w = Math.max(2, Math.round(innerWidth * s)), h = Math.max(2, Math.round(innerHeight * s));
    if (bg.cv.width !== w || bg.cv.height !== h) { bg.cv.width = w; bg.cv.height = h; bg.gl.viewport(0, 0, w, h); }
    bg.scale = s;
  }
  function bgDraw(now) {
    const gl = bg.gl; if (!gl) return;
    bg.pa += (bg.pTarget - bg.pa) * 0.08;
    gl.uniform2f(bg.u.res, bg.cv.width, bg.cv.height);
    gl.uniform1f(bg.u.t, (now - bg.t0) / 1000);
    gl.uniform2f(bg.u.p, bg.px * bg.scale, (innerHeight - bg.py) * bg.scale);
    gl.uniform1f(bg.u.pa, bg.pa);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  const fine = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  function bgLoop(now) {
    bg.raf = 0;
    if (!FX.on() || document.hidden) return;
    if (now - bg.last >= 32) { bg.last = now; bgDraw(now); }      // about 30 images per second
    bg.raf = requestAnimationFrame(bgLoop);
  }
  function bgStart() {
    if (!FX.on() || !bgInit()) return;
    bg.cv.classList.add("on");
    bgSize();
    if (fine) { if (!bg.raf) bg.raf = requestAnimationFrame(bgLoop); }
    else bgDraw(performance.now());                              // touch devices: one still image, no battery cost
  }
  function bgStop() { cancelAnimationFrame(bg.raf); bg.raf = 0; if (bg.cv) bg.cv.classList.remove("on"); }
  window.addEventListener("resize", () => { if (bg.gl && FX.on()) { bgSize(); if (!fine) bgDraw(performance.now()); } });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && FX.on() && bg.gl && fine && !bg.raf) bg.raf = requestAnimationFrame(bgLoop); });

  // ------------------------------------------------------------------ pointer: field + light on the frame of the panel under it
  let moveQueued = false, lastEvt = null, lit = null;
  document.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    lastEvt = e;
    if (moveQueued) return;
    moveQueued = true;
    requestAnimationFrame(() => {
      moveQueued = false;
      if (!FX.on() || !lastEvt) return;
      bg.px = lastEvt.clientX; bg.py = lastEvt.clientY; bg.pTarget = 1;
      const p = lastEvt.target && lastEvt.target.closest ? lastEvt.target.closest(".panel") : null;
      if (lit && lit !== p) { lit.style.removeProperty("--mx"); lit.style.removeProperty("--my"); }
      lit = p;
      if (p) { const r = p.getBoundingClientRect(); p.style.setProperty("--mx", (lastEvt.clientX - r.left) + "px"); p.style.setProperty("--my", (lastEvt.clientY - r.top) + "px"); }
    });
  }, { passive: true });
  document.addEventListener("pointerleave", () => { bg.pTarget = 0; });
  root.addEventListener("mouseleave", () => { bg.pTarget = 0; });

  // ------------------------------------------------------------------ headline figures settle digit by digit
  function decode(el, ms) {
    if (!el || el.children.length || el.dataset.fx) return;
    const final = el.textContent, idx = [];
    for (let i = 0; i < final.length; i++) if (/\d/.test(final[i])) idx.push(i);
    if (!idx.length || idx.length > 14) return;
    el.dataset.fx = "1";
    el.setAttribute("aria-hidden", "true");                      // assistive tech never reads the shuffle, only the settled value
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      if (k >= 1 || !el.isConnected) { el.textContent = final; el.removeAttribute("aria-hidden"); return; }
      const locked = Math.floor(k * idx.length), a = final.split("");
      for (let j = locked; j < idx.length; j++) a[idx[j]] = String((Math.random() * 10) | 0);
      el.textContent = a.join("");
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  // The headline figure decodes and its reticle closes in only when the subject changes (not on every tab of the same value).
  let lastSubject = null;
  function afterRender() {
    const subject = location.hash.replace(/^#/, "").split("/").slice(0, 3).join("/");
    const changed = subject !== lastSubject; lastSubject = subject;
    if (!FX.on() || !changed) return;
    document.querySelectorAll("#view .thead .quote").forEach((q) => q.classList.add("lock"));
    document.querySelectorAll("#view .thead .quote .px, #view .big-val").forEach((el) => decode(el, 420));
  }
  // Name the page frame so the browser can tell "same header, same tabs" from "new page" during a transition.
  function tag() {
    [["#view > .thead", "vt-head"], ["#view > .kpis", "vt-kpis"], ["#view > .tabs", "vt-tabs"]].forEach(([sel, name]) => {
      const el = document.querySelector(sel); if (el) el.style.viewTransitionName = name; });
  }

  // Shared element: clicking a stock in the watchlist sends its price across the screen into the page header.
  // The same transition name must sit on one element per snapshot: on the list price before, on the header price after.
  let flight = null;
  const headPx = () => document.querySelector("#view > .thead .quote .px");
  const clearFlight = () => { if (flight) { flight.src.style.viewTransitionName = ""; clearTimeout(flight.t); flight = null; } };
  document.addEventListener("click", (e) => {
    const a = e.target.closest ? e.target.closest("a.wl-item[data-tk]") : null;
    if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    clearFlight();
    if (!FX.on() || !document.startViewTransition || a.getAttribute("href") === location.hash) return;
    const px = a.querySelector(".px"), old = headPx();
    if (!px) return;
    if (old) old.style.viewTransitionName = "";
    px.style.viewTransitionName = "vt-px";
    flight = { src: px, tk: a.dataset.tk, t: setTimeout(clearFlight, 1500) };   // no navigation followed: put things back
  }, true);
  function land() {
    if (!flight) return;
    const tk = flight.tk; clearFlight();
    const dst = headPx();
    if (dst && location.hash.indexOf("#/t/" + tk) === 0) dst.style.viewTransitionName = "vt-px";
  }
  const settle = () => { const p = headPx(); if (p) p.style.viewTransitionName = ""; };

  // ------------------------------------------------------------------ route changes
  if (T && T.render) {
    const raw = T.render;
    let first = true;
    T.render = () => {
      const plain = first || !FX.on() || !document.startViewTransition;
      first = false;
      if (plain) { clearFlight(); return raw().then(() => { tag(); afterRender(); }, afterRender); }
      try {
        const vt = document.startViewTransition(() => raw().then(() => { tag(); land(); }, () => { tag(); clearFlight(); }));
        vt.finished.then(settle, settle);
        vt.ready.catch(() => {});
        return vt.updateCallbackDone.then(afterRender, afterRender);
      } catch (e) { return raw().then(afterRender, afterRender); }
    };
  }

  // ------------------------------------------------------------------ tabs: a marker slides to the active tab
  let lastInk = null;
  function ink() {
    document.querySelectorAll(".tabs").forEach((t) => {
      const a = t.querySelector("a.active");
      let i = t.querySelector(":scope > .tab-ink");
      if (!a) { if (i) i.remove(); t.classList.remove("inked"); return; }
      const to = { left: a.offsetLeft, width: a.offsetWidth, key: t.querySelectorAll("a").length + "|" + (t.querySelector("a") || {}).textContent };
      if (!to.width) return;
      const fresh = !i;
      if (fresh) { i = document.createElement("i"); i.className = "tab-ink"; i.setAttribute("aria-hidden", "true"); t.appendChild(i); t.classList.add("inked"); }
      if (i.style.left !== to.left + "px") i.style.left = to.left + "px";
      if (i.style.width !== to.width + "px") i.style.width = to.width + "px";
      if (fresh && FX.on() && lastInk && lastInk.key === to.key && (lastInk.left !== to.left || lastInk.width !== to.width) && i.animate) {
        i.style.transformOrigin = "0 50%";
        i.animate([{ transform: `translateX(${lastInk.left - to.left}px) scaleX(${lastInk.width / to.width})` }, { transform: "none" }],
          { duration: 420, easing: "cubic-bezier(.3,1.25,.5,1)" });
      }
      if (fresh) lastInk = to;
    });
  }
  let inkT = 0;
  new MutationObserver(() => { clearTimeout(inkT); inkT = setTimeout(ink, 30); }).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  window.addEventListener("resize", ink);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(ink);

  // ------------------------------------------------------------------ top bar: New York clock + effects switch
  function nyState() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date()).map((x) => [x.type, x.value]));
    const h = +parts.hour % 24, m = +parts.minute, min = h * 60 + m, weekend = parts.weekday === "Sat" || parts.weekday === "Sun";
    return { time: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, open: !weekend && min >= 570 && min < 960 };
  }
  function clock() {
    const el = document.getElementById("mkt"); if (!el) return;
    let s; try { s = nyState(); } catch (e) { el.remove(); return; }
    el.classList.toggle("open", s.open);
    el.innerHTML = `<i></i>New York <b>${s.time}</b> ${s.open ? "ouvert" : "fermé"}`;
  }
  function chrome() {
    const tr = document.querySelector(".top-right"); if (!tr || document.getElementById("mkt")) return;
    const mk = document.createElement("span"); mk.className = "mkt"; mk.id = "mkt";
    mk.title = "Séance régulière : 9 h 30 à 16 h, heure de New York. Les jours fériés ne sont pas pris en compte.";
    const b = document.createElement("button"); b.className = "icon-btn fx-btn"; b.id = "fxBtn"; b.type = "button";
    b.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>';
    const label = () => { const on = FX.pref(); b.setAttribute("aria-pressed", String(on));
      const t = on ? (mq.matches ? "Effets visuels activés, mais suspendus : ton système demande de réduire les animations" : "Effets visuels activés. Cliquer pour les couper") : "Effets visuels coupés. Cliquer pour les activer";
      b.title = t; b.setAttribute("aria-label", t); };
    b.addEventListener("click", () => { store.set("archer-fx", FX.pref() ? "off" : "on"); apply(); label(); });
    tr.insertBefore(b, tr.firstChild); tr.insertBefore(mk, tr.firstChild);
    label(); clock(); setInterval(clock, 20000);
  }
  function apply() { sync(); if (FX.on()) bgStart(); else bgStop(); }
  if (mq.addEventListener) mq.addEventListener("change", apply);

  // ------------------------------------------------------------------ boot: once per session, skippable
  function boot() {
    const el = document.querySelector(".boot");
    if (!root.classList.contains("pre-boot") || !el) return;
    let ended = false;
    const end = (fast) => {
      if (ended) return; ended = true;
      if (fast) el.classList.add("out");
      document.body.classList.add("booting");
      setTimeout(() => { document.body.classList.remove("booting"); root.classList.remove("pre-boot"); }, 1500);
      removeEventListener("keydown", skip, true); el.removeEventListener("pointerdown", skip);
    };
    const skip = () => end(true);
    // the overlay fades on its own 0.95 s after first paint (CSS); if the scripts arrived later than that, there is nothing left to stage
    const late = performance.now() > 1300;
    if (late) { root.classList.remove("pre-boot"); return; }
    addEventListener("keydown", skip, true); el.addEventListener("pointerdown", skip);
    setTimeout(() => end(false), Math.max(0, 900 - performance.now()));
  }

  const start = () => { chrome(); boot(); apply(); ink(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
