/* Core: formatting, data loading, DOM helpers, chart helpers, router, command palette. */
(function () {
  "use strict";
  const T = (window.T = {});

  // ------------------------------------------------------------------ formatting (fr-FR)
  const nf = (d) => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const NF = {};
  const f = (v, d = 2) => (NF[d] || (NF[d] = nf(d))).format(v);
  T.isNum = (v) => typeof v === "number" && isFinite(v);
  T.fmt = {
    n: (v, d = 2) => (T.isNum(v) ? f(v, d) : "—"),
    px: (v, d = 2) => (T.isNum(v) ? f(v, d) + " $" : "—"),
    pct: (v, d = 1, sign = false) => (T.isNum(v) ? (sign && v > 0 ? "+" : "") + f(v * 100, d) + " %" : "—"),
    x: (v, d = 1) => (T.isNum(v) ? f(v, d) + "x" : "—"),
    days: (v) => (T.isNum(v) ? f(v, 0) + " j" : "—"),
    usd: (v, d) => {
      if (!T.isNum(v)) return "—";
      const a = Math.abs(v);
      if (a >= 1e12) return f(v / 1e12, d ?? 2) + " T$";
      if (a >= 1e9) return f(v / 1e9, d ?? (a >= 1e11 ? 0 : 1)) + " Md$";
      if (a >= 1e6) return f(v / 1e6, d ?? 0) + " M$";
      if (a >= 1e3) return f(v / 1e3, d ?? 0) + " k$";
      return f(v, d ?? 0) + " $";
    },
    big: (v) => {  // statements: always in $ millions or billions, decided by the caller
      if (!T.isNum(v)) return "—";
      return f(v, 0);
    },
    date: (s) => {
      if (!s) return "—";
      const d = new Date(s + (s.length === 10 ? "T00:00:00" : ""));
      return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
    },
    dateTime: (s) => (s ? new Date(s).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"),
    by: (fmtKey, v) => ({ pct: T.fmt.pct, x: T.fmt.x, days: T.fmt.days, usd: T.fmt.usd }[fmtKey] || T.fmt.n)(v),
  };
  T.cls = (v) => (T.isNum(v) ? (v > 0 ? "up" : v < 0 ? "down" : "") : "");

  // ------------------------------------------------------------------ DOM
  T.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  T.$ = (sel, root = document) => root.querySelector(sel);
  T.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  T.html = (el, s) => { el.innerHTML = s; return el; };

  // ------------------------------------------------------------------ data
  const cache = {};
  T.get = (path) => {
    if (!cache[path]) {
      cache[path] = fetch("data/" + path, { cache: "no-cache" }).then((r) => {
        if (!r.ok) throw new Error(path + " : HTTP " + r.status);
        return r.json();
      }).catch((e) => { delete cache[path]; throw e; });
    }
    return cache[path];
  };

  // ------------------------------------------------------------------ colours
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  T.C = {
    text: v("--text"), text2: v("--text-2"), muted: v("--muted"), grid: v("--grid"), border: v("--border"),
    panel: v("--panel"), panel3: v("--panel-3"), accent: v("--accent"), up: v("--up"), down: v("--down"), warn: v("--warn"),
    series: [v("--s1"), v("--s2"), v("--s3"), v("--s4"), v("--s5"), v("--s6")],
    neutral: "#5d6272",
  };
  // Colour follows the entity, never its rank: fixed slot per ticker.
  const slot = {};
  T.colorOf = (tk, order) => {
    if (!(tk in slot)) {
      const i = order ? order.indexOf(tk) : Object.keys(slot).length;
      slot[tk] = T.C.series[(i >= 0 ? i : Object.keys(slot).length) % T.C.series.length];
    }
    return slot[tk];
  };

  // ------------------------------------------------------------------ charts
  const live = [];
  T.disposeCharts = () => {
    while (live.length) { const c = live.pop(); try { c.dispose ? c.dispose() : c.remove(); } catch (e) { /* noop */ } }
  };
  const baseEc = () => ({
    backgroundColor: "transparent",
    textStyle: { fontFamily: "Inter, system-ui, sans-serif", color: T.C.text2 },
    animationDuration: 350,
    grid: { left: 8, right: 14, top: 26, bottom: 8, containLabel: true },
    tooltip: {
      backgroundColor: "#1e222d", borderColor: "#2f3544", textStyle: { color: T.C.text, fontSize: 12 },
      extraCssText: "box-shadow:0 8px 30px rgba(0,0,0,.45);border-radius:8px;",
    },
    legend: { textStyle: { color: T.C.text2 }, icon: "roundRect", itemWidth: 10, itemHeight: 3, top: 0, right: 0 },
  });
  T.axis = (extra = {}) => Object.assign({
    axisLine: { lineStyle: { color: T.C.border } }, axisTick: { show: false },
    axisLabel: { color: T.C.muted, fontSize: 11, fontFamily: "JetBrains Mono, monospace" },
    splitLine: { lineStyle: { color: T.C.grid } },
  }, extra);
  T.ec = (el, option) => {
    if (!el || !window.echarts) return null;
    const c = echarts.init(el, null, { renderer: "canvas" });
    c.setOption(deepMerge(baseEc(), option));
    live.push(c);
    return c;
  };
  window.addEventListener("resize", () => live.forEach((c) => c.resize && c.resize()));

  T.lw = (el, opts = {}) => {
    const chart = LightweightCharts.createChart(el, Object.assign({
      autoSize: true,
      layout: { background: { type: "solid", color: "transparent" }, textColor: T.C.muted,
                fontFamily: "JetBrains Mono, monospace", fontSize: 11 },
      grid: { vertLines: { color: T.C.grid }, horzLines: { color: T.C.grid } },
      rightPriceScale: { borderColor: T.C.border },
      timeScale: { borderColor: T.C.border, timeVisible: false },
      crosshair: { mode: 0, vertLine: { color: "#4a5163", labelBackgroundColor: "#2a2e39" },
                   horzLine: { color: "#4a5163", labelBackgroundColor: "#2a2e39" } },
      localization: { locale: "fr-FR", priceFormatter: (p) => f(p, 2) },
    }, opts));
    live.push(chart);
    return chart;
  };

  T.spark = (vals, w = 220, h = 26, color) => {
    const a = (vals || []).filter(T.isNum);
    if (a.length < 2) return "";
    const min = Math.min(...a), max = Math.max(...a), r = max - min || 1;
    const pts = a.map((x, i) => `${(i / (a.length - 1)) * w},${h - 2 - ((x - min) / r) * (h - 4)}`).join(" ");
    const c = color || (a[a.length - 1] >= a[0] ? T.C.up : T.C.down);
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline fill="none" stroke="${c}" stroke-width="1.5" vector-effect="non-scaling-stroke" points="${pts}"/></svg>`;
  };

  function deepMerge(a, b) {
    const out = Array.isArray(a) ? a.slice() : Object.assign({}, a);
    for (const k in b) {
      if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && a && typeof a[k] === "object" && !Array.isArray(a[k])) out[k] = deepMerge(a[k], b[k]);
      else out[k] = b[k];
    }
    return out;
  }
  T.deepMerge = deepMerge;

  // ------------------------------------------------------------------ router
  const routes = [];
  T.route = (re, fn) => routes.push([re, fn]);
  T.go = (h) => { if (location.hash === h) T.render(); else location.hash = h; };
  T.render = async () => {
    const h = location.hash.replace(/^#/, "") || "/";
    T.disposeCharts();
    T.onKey = null;
    document.body.classList.remove("side-open");
    const view = T.$("#view");
    for (const [re, fn] of routes) {
      const m = h.match(re);
      if (m) {
        try { await fn(view, ...m.slice(1)); }
        catch (e) {
          console.error(e);
          view.innerHTML = `<div class="panel"><h3>Erreur</h3><p class="sec">${T.esc(e.message)}</p>
            <p class="muted">Les données n'ont peut-être pas encore été générées par le pipeline (onglet Actions du repo).</p></div>`;
        }
        T.markNav(h);
        window.scrollTo({ top: 0 });
        return;
      }
    }
    view.innerHTML = `<div class="empty">Page introuvable.</div>`;
  };
  T.markNav = (h) => {
    T.$$(".nav a").forEach((a) => a.classList.toggle("active", "#" + h === a.getAttribute("href") || (a.dataset.nav === "home" && h === "/")));
    T.$$(".wl-item").forEach((a) => a.classList.toggle("active", h.startsWith("/t/" + a.dataset.tk)));
  };

  // ------------------------------------------------------------------ command palette
  T.commands = () => [];
  const back = () => T.$("#cmdkBack"), box = () => T.$("#cmdk"), input = () => T.$("#cmdkInput"), list = () => T.$("#cmdkList");
  let items = [], sel = 0;
  T.openCmdk = () => {
    back().classList.add("open"); box().classList.add("open");
    input().value = ""; filter(""); setTimeout(() => input().focus(), 0);
  };
  T.closeCmdk = () => { back().classList.remove("open"); box().classList.remove("open"); };
  function filter(q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    items = T.commands().filter((c) => words.every((w) => (c.label + " " + (c.keywords || "")).toLowerCase().includes(w))).slice(0, 12);
    sel = 0; draw();
  }
  function draw() {
    list().innerHTML = items.length ? items.map((c, i) => `<li class="${i === sel ? "on" : ""}" data-i="${i}">${c.icon || "›"} <span>${c.html || T.esc(c.label)}</span><span class="k">${T.esc(c.kind || "")}</span></li>`).join("")
      : `<li class="muted">Aucun résultat</li>`;
  }
  function pick(i) { const c = items[i]; if (c) { T.closeCmdk(); T.go(c.href); } }
  document.addEventListener("DOMContentLoaded", () => {
    input().addEventListener("input", (e) => filter(e.target.value));
    input().addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
      else if (e.key === "Enter") pick(sel);
      else if (e.key === "Escape") T.closeCmdk();
    });
    list().addEventListener("click", (e) => { const li = e.target.closest("li[data-i]"); if (li) pick(+li.dataset.i); });
    back().addEventListener("click", T.closeCmdk);
    T.$("#searchBtn").addEventListener("click", T.openCmdk);
    T.$("#searchBtn").addEventListener("keydown", (e) => { if (e.key === "Enter") T.openCmdk(); });
    T.$("#menuBtn").addEventListener("click", () => document.body.classList.toggle("side-open"));
    document.addEventListener("keydown", (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) { e.preventDefault(); T.openCmdk(); }
      else if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && T.onKey) T.onKey(e);
    });
  });
})();
