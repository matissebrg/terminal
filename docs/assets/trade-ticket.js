/* Trade ticket: stock picker with logos, market / limit orders, estimated bid-ask, impact and
   execution timing, animated. Mirrors pipeline/execution.py (same spread rule, square-root impact,
   10 % participation, limit orders from the next session). */
(function () {
  "use strict";
  const T = window.T, F = T.fmt;
  const NY_TZ = "America/New_York";
  const reduce = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const TK = (window.TT = {});

  // ------------------------------------------------------------------ logos (identification only)
  // Public logo CDNs, tried in order; a coloured monogram if both fail. Logos belong to their companies.
  const LOGO_SRC = [(t) => `https://financialmodelingprep.com/image-stock/${encodeURIComponent(t)}.png`,
    (t) => `https://assets.parqet.com/logos/symbol/${encodeURIComponent(t)}?format=png`];
  const hue = (t) => [...t].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  TK.logo = (tk, size = 28) => `<span class="tlogo" style="--sz:${size}px;--h:${hue(tk)}" data-tk="${T.esc(tk)}"><span class="mono">${T.esc(tk.replace(/[^A-Z]/g, "").slice(0, 2))}</span><img alt="" loading="lazy" decoding="async" data-i="0" src="${LOGO_SRC[0](tk)}"></span>`;
  document.addEventListener("error", (e) => {
    const im = e.target;
    if (!(im instanceof HTMLImageElement) || !im.closest(".tlogo")) return;
    const i = +im.dataset.i + 1, tk = im.closest(".tlogo").dataset.tk;
    if (i < LOGO_SRC.length) { im.dataset.i = i; im.src = LOGO_SRC[i](tk); } else im.remove();
  }, true);
  document.addEventListener("load", (e) => { const im = e.target; if (im instanceof HTMLImageElement && im.closest(".tlogo")) im.closest(".tlogo").classList.add("ok"); }, true);

  // ------------------------------------------------------------------ market model (= pipeline/execution.py)
  TK.spreadBps = (advDollars, price) => {
    let bp = advDollars > 0 ? 10 * Math.pow(advDollars / 1e7, -0.5) : 150;
    bp = Math.min(150, Math.max(1, bp));
    if (price > 0) bp = Math.max(bp, 0.01 / price * 1e4);
    return bp;
  };
  TK.quote = (p) => {
    const c = +p.close, sp = p.spread_bps != null ? +p.spread_bps : TK.spreadBps((+p.adv_shares || 0) * c, c);
    const half = c * sp / 2 / 1e4;
    return { last: c, bid: c - half, ask: c + half, spreadBps: sp, adv: +p.adv_shares || null, sigma: +p.sigma_d || null };
  };
  TK.estimate = (p, side, qty) => {
    const q = TK.quote(p), vol = q.adv || 0, sigma = q.sigma || 0.02;
    const take = vol ? Math.min(qty, 0.1 * vol) : qty;
    const impact = vol ? 0.5 * sigma * Math.sqrt(take / vol) : 0;
    const sign = side === "buy" ? 1 : -1, half = q.spreadBps / 2 / 1e4;
    return { ...q, price: q.last * (1 + sign * (half + impact)), halfBps: half * 1e4, impactBps: impact * 1e4,
      participation: vol ? qty / vol : null, sessions: vol ? Math.max(1, Math.ceil(qty / (0.1 * vol))) : 1 };
  };
  // probability that the price touches L within n sessions (driftless log-price, reflection principle)
  const Phi = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
  TK.touchProb = (S, L, sigma, n) => (sigma > 0 && n > 0 ? Math.min(1, 2 * Phi(-Math.abs(Math.log(L / S)) / (sigma * Math.sqrt(n)))) : null);

  // ------------------------------------------------------------------ market clock (weekends only; holidays not modelled)
  const nyParts = (d = new Date()) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: NY_TZ, hour12: false, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(d).map((x) => [x.type, x.value]));
    return { wd: p.weekday, date: `${p.year}-${p.month}-${p.day}`, min: (+p.hour % 24) * 60 + +p.minute };
  };
  TK.clock = () => {
    const n = nyParts(), weekend = n.wd === "Sat" || n.wd === "Sun";
    const open = !weekend && n.min >= 570 && n.min < 960;
    const pre = !weekend && n.min < 570;
    return { open, weekend, pre, label: open ? "Marché ouvert" : weekend ? "Week-end" : pre ? "Avant l'ouverture" : "Marché fermé",
      toClose: open ? 960 - n.min : null, nyTime: `${String(Math.floor(n.min / 60)).padStart(2, "0")}:${String(n.min % 60).padStart(2, "0")}` };
  };
  const nextSession = (fromToday) => { // first weekday >= today (or > today)
    const d = new Date(); for (let i = 0; i < 8; i++) { const x = new Date(d.getTime() + i * 864e5); const w = nyParts(x).wd;
      if (w !== "Sat" && w !== "Sun" && (i > 0 || fromToday)) return x; } return d; };
  TK.when = (type) => {
    const c = TK.clock();
    const fmt = (d) => d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "short", timeZone: NY_TZ });
    if (type === "limit") {
      const d = nextSession(c.pre); return `Active à partir de la séance du ${fmt(d)}, valable 30 jours`;
    }
    const d = nextSession(c.open || c.pre);
    return `Exécution à la clôture du ${fmt(d)} (16:00 New York)`;
  };

  // ------------------------------------------------------------------ tween numbers
  const tween = (el, to, fmt, ms = 380) => {
    if (!el) return;
    const from = +el.dataset.v || 0; el.dataset.v = to;
    if (reduce() || !isFinite(from) || !isFinite(to)) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  };

  // ------------------------------------------------------------------ picker
  function picker(root, items, groups, onPick) {
    root.innerHTML = `<div class="tp-search"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input type="text" placeholder="Ticker ou nom" aria-label="Rechercher une valeur" autocomplete="off"><kbd>↑↓ ↵</kbd></div>
      <div class="tp-list" role="listbox"></div>`;
    const inp = root.querySelector("input"), list = root.querySelector(".tp-list");
    let shown = [], cur = 0;
    const row = (p, i) => { const ch = p.prev_close ? +p.close / +p.prev_close - 1 : null;
      return `<div class="tp-row" role="option" data-tk="${T.esc(p.ticker)}" style="--i:${Math.min(i, 14)}">${TK.logo(p.ticker, 30)}
        <span class="tp-id"><b>${T.esc(p.ticker)}</b><span class="muted">${T.esc(p.name || "")}</span></span>
        <span class="tp-px num">${F.px(+p.close)}${ch != null ? `<span class="${T.cls(ch)}">${F.pct(ch, 2, true)}</span>` : ""}</span></div>`; };
    const draw = () => {
      const q = inp.value.trim().toLowerCase();
      shown = items.filter((p) => !q || p.ticker.toLowerCase().includes(q) || (p.name || "").toLowerCase().includes(q));
      let html = "", i = 0;
      groups.forEach(([label, test]) => { const g = shown.filter(test); if (!g.length) return;
        html += `<div class="tp-group">${label}</div>` + g.map((p) => row(p, i++)).join(""); });
      list.innerHTML = html || '<div class="muted" style="padding:14px">Aucune valeur.</div>';
      shown = [...list.querySelectorAll(".tp-row")].map((r) => r.dataset.tk);
      cur = 0; mark();
    };
    const mark = () => list.querySelectorAll(".tp-row").forEach((r, i) => r.classList.toggle("cur", i === cur));
    inp.addEventListener("input", draw);
    inp.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); cur = (cur + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % Math.max(1, shown.length); mark();
        const r = list.querySelectorAll(".tp-row")[cur]; if (r) r.scrollIntoView({ block: "nearest" }); }
      if (e.key === "Enter" && shown[cur]) { e.preventDefault(); onPick(shown[cur], list.querySelectorAll(".tp-row")[cur]); }
    });
    list.addEventListener("click", (e) => { const r = e.target.closest(".tp-row"); if (r) onPick(r.dataset.tk, r); });
    draw();
    return { focus: () => inp.focus(), draw };
  }

  // fly the logo from the list row to the ticket header (FLIP)
  function fly(fromEl, toEl) {
    if (reduce() || !fromEl || !toEl) return;
    const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
    const ghost = fromEl.cloneNode(true); ghost.classList.add("tlogo-ghost");
    Object.assign(ghost.style, { left: a.left + "px", top: a.top + "px", width: a.width + "px", height: a.height + "px" });
    document.body.appendChild(ghost);
    toEl.style.opacity = "0";
    ghost.animate([{ transform: "translate(0,0) scale(1)" }, { transform: `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(${b.width / a.width})` }],
      { duration: 520, easing: "cubic-bezier(.2,.8,.2,1)" }).finished.then(() => { ghost.remove(); toEl.style.opacity = ""; toEl.animate([{ transform: "scale(1.18)" }, { transform: "scale(1)" }], { duration: 260, easing: "ease-out" }); });
  }

  // ------------------------------------------------------------------ ticket
  /** ctx: {el, prices: latest_prices rows, covered: Set of covered tickers, cash, reserved, shares: {tk: free shares},
   *        submit: async ({ticker, side, qty, type, limit}) => void} */
  TK.mount = (ctx) => {
    const el = ctx.el;
    const px = Object.fromEntries(ctx.prices.map((p) => [p.ticker, p]));
    const st = { tk: null, side: "buy", type: "market", unit: "qty" };
    el.innerHTML = `<div class="tt">
      <div class="tt-head"><h3>Passer un ordre</h3><span class="tt-clock" id="ttclock"></span></div>
      <div class="tt-stage">
        <div class="tt-pick" id="ttpick"></div>
        <div class="tt-form" id="ttform" hidden>
          <div class="tt-sel"><button type="button" class="tt-back" title="Changer de valeur" aria-label="Changer de valeur">‹</button><span id="ttlogo"></span>
            <div class="tt-name"><b id="tttk"></b><span class="muted" id="ttname"></span></div><div class="tt-last num"><b id="ttlast"></b><span id="ttchg"></span></div></div>
          <div class="tt-range"><span class="num" id="ttlo"></span><div class="bar"><i id="ttdot"></i></div><span class="num" id="tthi"></span></div>
          <div class="tt-side" id="ttside"><i class="pill"></i><button type="button" data-k="buy" class="on">Acheter</button><button type="button" data-k="sell">Vendre</button></div>
          <div class="seg tt-type" id="tttype"><button type="button" data-k="market" class="on">Au marché</button><button type="button" data-k="limit">À cours limité</button></div>
          <div class="tt-book" id="ttbook"></div>
          <label class="tt-lbl">Quantité <span class="seg tt-unit" id="ttunit"><button type="button" data-k="qty" class="on">actions</button><button type="button" data-k="usd">$</button></span></label>
          <div class="tt-qty"><button type="button" data-d="-1" aria-label="Moins">−</button><input id="ttq" inputmode="decimal" value="10"><button type="button" data-d="1" aria-label="Plus">+</button><button type="button" class="btn btn-xs" id="ttmax">Max</button></div>
          <div class="tt-limit" id="ttlim" hidden><label class="tt-lbl">Prix limite ($)</label>
            <div class="tt-qty"><input id="ttl" inputmode="decimal"></div>
            <div class="tt-chips" id="ttchips"></div><div class="note" id="ttprob"></div></div>
          <div class="tt-est" id="ttest"></div>
          <div class="note tt-when" id="ttwhen"></div>
          <button class="btn primary tt-go" id="ttgo" type="button"><span>Envoyer l'ordre</span></button>
          <div class="note" id="ttmsg"></div>
        </div>
      </div></div>`;
    const $ = (s) => el.querySelector(s);
    const clock = () => { const c = TK.clock(); $("#ttclock").innerHTML = `<i class="dot ${c.open ? "on" : ""}"></i>${c.label} · ${c.nyTime} NY${c.toClose != null ? ` · clôture dans ${Math.floor(c.toClose / 60)} h ${String(c.toClose % 60).padStart(2, "0")}` : ""}`; };
    clock(); const clk = setInterval(() => { if (!document.body.contains(el)) clearInterval(clk); else clock(); }, 30000);
    const items = ctx.prices.filter((p) => p.close);
    const pk = picker($("#ttpick"), items, [["Valeurs suivies", (p) => ctx.covered.has(p.ticker)], ["Pairs, indices et autres", (p) => !ctx.covered.has(p.ticker)]],
      (tk, row) => choose(tk, row && row.querySelector(".tlogo")));
    const choose = (tk, fromLogo) => {
      st.tk = tk; const p = px[tk];
      $("#ttlogo").innerHTML = TK.logo(tk, 40); $("#tttk").textContent = tk; $("#ttname").textContent = p.name || "";
      $("#ttlast").textContent = F.px(+p.close);
      const ch = p.prev_close ? +p.close / +p.prev_close - 1 : null;
      $("#ttchg").className = T.cls(ch); $("#ttchg").textContent = ch != null ? F.pct(ch, 2, true) : "";
      const lo = +p.low, hi = +p.high;
      if (lo && hi && hi > lo) { $("#ttlo").textContent = F.n(lo, 2); $("#tthi").textContent = F.n(hi, 2); $("#ttdot").style.left = `${((+p.close - lo) / (hi - lo)) * 100}%`; $(".tt-range").hidden = false; }
      else $(".tt-range").hidden = true;
      $("#ttpick").classList.add("out"); $("#ttform").hidden = false;
      $("#ttform").classList.remove("in"); void $("#ttform").offsetWidth; $("#ttform").classList.add("in");
      fly(fromLogo, $("#ttlogo .tlogo"));
      $("#ttl").value = F.n(+p.close, 2).replace(/\s/g, "");
      upd();
    };
    $(".tt-back").addEventListener("click", () => { $("#ttform").hidden = true; $("#ttpick").classList.remove("out"); pk.focus(); });
    const segs = (id, key, cb) => $(id).addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; st[key] = b.dataset.k;
      $(id).querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); cb && cb(); upd(); });
    segs("#ttside", "side", () => $("#ttside").classList.toggle("sell", st.side === "sell"));
    segs("#tttype", "type", () => { $("#ttlim").hidden = st.type !== "limit"; });
    segs("#ttunit", "unit");
    const num = (v) => parseFloat(String(v || "").replace(/\s/g, "").replace(",", "."));
    const qtyShares = () => { const v = num($("#ttq").value), p = px[st.tk]; if (!isFinite(v) || !p) return NaN;
      return st.unit === "usd" ? Math.floor((v / +p.close) * 10000) / 10000 : v; };
    el.querySelectorAll(".tt-qty button[data-d]").forEach((b) => b.addEventListener("click", () => { const v = num($("#ttq").value) || 0; const step = st.unit === "usd" ? 1000 : 1;
      $("#ttq").value = Math.max(0, v + step * +b.dataset.d); upd(); }));
    $("#ttmax").addEventListener("click", () => { const p = px[st.tk]; if (!p) return;
      let q = st.side === "buy" ? Math.floor((ctx.cash - ctx.reserved) / TK.estimate(p, "buy", 1).ask) : (ctx.shares[st.tk] || 0);
      q = Math.max(0, q); $("#ttq").value = st.unit === "usd" ? Math.floor(q * +p.close) : q; upd(); });
    ["#ttq", "#ttl"].forEach((s) => $(s).addEventListener("input", upd));
    function upd() {
      const p = px[st.tk]; if (!p) return;
      const q = qtyShares(), e = TK.estimate(p, st.side, isFinite(q) ? q : 0);
      const L = num($("#ttl").value);
      const lim = st.type === "limit" && isFinite(L) ? L : null;
      // estimated quote ladder: bid | ask around the last close, with your execution price
      const execPx = lim != null ? lim : e.price;
      const lo = Math.min(e.bid, execPx, e.last) , hi = Math.max(e.ask, execPx, e.last);
      const pad = (hi - lo) * 0.35 || e.last * 0.001, a = lo - pad, b = hi + pad, pos = (v) => `${((v - a) / (b - a)) * 100}%`;
      $("#ttbook").innerHTML = `<div class="bk-row"><span>Acheteur (bid) <b class="num up">${F.n(e.bid, 2)}</b></span><span class="muted">écart ${F.n(e.spreadBps, 1)} pb</span><span>Vendeur (ask) <b class="num down">${F.n(e.ask, 2)}</b></span></div>
        <div class="bk-bar"><i class="bk-sp" style="left:${pos(e.bid)};width:calc(${pos(e.ask)} - ${pos(e.bid)})"></i><i class="bk-mid" style="left:${pos(e.last)}"></i><i class="bk-you ${st.side}" style="left:${pos(execPx)}" title="Ton prix estimé"></i></div>
        <div class="bk-legend"><span class="muted">fourchette estimée d'après le volume moyen (${e.adv ? F.n(e.adv * e.last / 1e6, 0) + " M$/jour" : "volume inconnu"})</span><span class="you-l ${st.side}">● ton prix</span></div>`;
      if (st.type === "limit") {
        $("#ttchips").innerHTML = [["Bid", e.bid], ["Milieu", e.last], ["Ask", e.ask], [st.side === "buy" ? "-1 %" : "+1 %", e.last * (st.side === "buy" ? 0.99 : 1.01)], [st.side === "buy" ? "-5 %" : "+5 %", e.last * (st.side === "buy" ? 0.95 : 1.05)]]
          .map(([l, v]) => `<button type="button" class="chip" data-v="${v.toFixed(2)}">${l}</button>`).join("");
        const pr = lim ? TK.touchProb(e.last, lim, e.sigma, 21) : null;
        const marketable = lim && ((st.side === "buy" && lim >= e.ask) || (st.side === "sell" && lim <= e.bid));
        $("#ttprob").innerHTML = lim ? (marketable ? "Limite au-delà du prix opposé : exécution probable dès la prochaine séance (à ta limite, ou mieux à l'ouverture)."
          : `Distance : ${F.pct(Math.abs(lim / e.last - 1), 1)} soit ${e.sigma ? F.n(Math.abs(Math.log(lim / e.last)) / e.sigma, 1) : "-"} écart(s)-type(s) quotidien(s) · probabilité d'être touchée en 30 jours ≈ <b>${pr != null ? F.pct(pr, 0) : "-"}</b> (marche aléatoire, sans tendance).`) : "";
      }
      const amount = isFinite(q) ? q * execPx : null;
      const cashAfter = st.side === "buy" ? ctx.cash - (amount || 0) : ctx.cash + (amount || 0);
      $("#ttest").innerHTML = `<div class="est-grid">
        <span>Dernière clôture</span><b class="num">${F.px(e.last)}</b>
        ${st.type === "market" ? `<span>Demi-écart</span><b class="num">${F.n(e.halfBps, 1)} pb</b><span>Impact de marché</span><b class="num">${F.n(e.impactBps, 1)} pb</b>` : `<span>Écart et impact</span><b class="num">aucun (ordre passif)</b>`}
        <span>Prix estimé</span><b class="num" id="tte-px"></b>
        <span>Quantité</span><b class="num">${isFinite(q) ? F.n(q, q % 1 ? 4 : 0) : "-"}</b>
        <span>Montant estimé</span><b class="num big" id="tte-amt"></b>
        <span>Liquidités après</span><b class="num ${cashAfter - ctx.reserved < 0 ? "down" : ""}">${F.n(cashAfter, 0)} $</b></div>
        ${e.participation != null && e.participation > 0.1 ? `<p class="note warn">Ordre = ${F.pct(e.participation, 0)} du volume moyen : exécuté en ${e.sessions} séance(s), 10 % du volume au plus par séance.</p>` : e.participation != null && isFinite(q) && q > 0 ? `<p class="note">Ton ordre représente ${F.pct(e.participation, e.participation < 0.001 ? 3 : 2)} du volume quotidien moyen.</p>` : ""}
        ${ctx.reserved > 0 && st.side === "buy" ? `<p class="note">${F.n(ctx.reserved, 0)} $ réservés aux puts vendus ne sont pas utilisables.</p>` : ""}
        ${st.side === "sell" ? `<p class="note">Disponible à la vente : ${F.n(ctx.shares[st.tk] || 0, 0)} action(s)${ctx.locked && ctx.locked[st.tk] ? ` (${F.n(ctx.locked[st.tk], 0)} bloquée(s) par des calls vendus)` : ""}.</p>` : ""}`;
      tween($("#tte-px"), execPx, (v) => F.px(v)); tween($("#tte-amt"), amount || 0, (v) => F.n(v, 0) + " $");
      $("#ttwhen").textContent = TK.when(st.type);
      $("#ttgo").className = `btn primary tt-go ${st.side}`;
      $("#ttgo span").textContent = `${st.side === "buy" ? "Acheter" : "Vendre"} ${isFinite(q) && q > 0 ? F.n(q, q % 1 ? 4 : 0) + " " : ""}${st.tk}${st.type === "limit" && lim ? " à " + F.n(lim, 2) + " $ max".replace(" max", st.side === "buy" ? " max" : " min") : ""}`;
    }
    $("#ttchips").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (!b) return; $("#ttl").value = b.dataset.v; upd(); });
    $("#ttgo").addEventListener("click", async () => {
      const q = qtyShares(), L = num($("#ttl").value), btn = $("#ttgo");
      if (!st.tk || !(q > 0)) { $("#ttq").focus(); $("#ttq").animate([{ transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "none" }], { duration: 220 }); return; }
      btn.disabled = true; btn.classList.add("busy");
      try {
        await ctx.submit({ ticker: st.tk, side: st.side, qty: q, type: st.type, limit: st.type === "limit" ? L : null });
        btn.classList.remove("busy"); btn.classList.add("done");
        btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" class="tick"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Ordre envoyé</span>`;
        setTimeout(() => ctx.done && ctx.done(), reduce() ? 0 : 900);
      } catch (ex) {
        btn.disabled = false; btn.classList.remove("busy");
        $("#ttmsg").className = "note warn"; $("#ttmsg").textContent = ex.message || String(ex);
      }
    });
    if (ctx.preselect && px[ctx.preselect]) choose(ctx.preselect, null);
    return { choose };
  };
})();
