/* Options : grecques, skew, max pain, constructeur de stratégies (payoff), achat fictif.
 * Black-Scholes sans dividende, exercice européen : approximation standard, cohérente avec le pipeline. */
(function () {
  "use strict";
  const T = window.T, F = T.fmt, C = () => T.C;
  const OL = (T.OL = {});

  // ------------------------------------------------------------------ Black-Scholes
  const ncdf = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const d = 0.3989422804014327 * Math.exp(-x * x / 2);
    const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))); return x >= 0 ? 1 - p : p; };
  const npdf = (x) => 0.3989422804014327 * Math.exp(-x * x / 2);
  OL.bs = (S, K, t, r, v, call) => {
    if (t <= 0 || !v) return Math.max(0, call ? S - K : K - S);
    const sq = v * Math.sqrt(t), d1 = (Math.log(S / K) + (r + v * v / 2) * t) / sq, d2 = d1 - sq;
    return call ? S * ncdf(d1) - K * Math.exp(-r * t) * ncdf(d2) : K * Math.exp(-r * t) * ncdf(-d2) - S * ncdf(-d1);
  };
  // delta, gamma, theta per day, vega per 1 vol point
  OL.greeks = (S, K, t, r, v, call) => {
    if (t <= 0 || !v) return { delta: call ? (S > K ? 1 : 0) : (S < K ? -1 : 0), gamma: 0, theta: 0, vega: 0 };
    const sq = v * Math.sqrt(t), d1 = (Math.log(S / K) + (r + v * v / 2) * t) / sq, d2 = d1 - sq;
    const theta = (-S * npdf(d1) * v / (2 * Math.sqrt(t)) - (call ? 1 : -1) * r * K * Math.exp(-r * t) * ncdf(call ? d2 : -d2)) / 365;
    return { delta: call ? ncdf(d1) : ncdf(d1) - 1, gamma: npdf(d1) / (S * sq), theta, vega: S * npdf(d1) * Math.sqrt(t) / 100 };
  };
  const yf = (exp) => Math.max(0, (new Date(exp + "T20:00:00Z") - Date.now()) / (365 * 864e5));

  // ------------------------------------------------------------------ skew / max pain
  function ivAtDelta(rows, target, call) {
    const pts = rows.map((r) => [r[call ? "c_delta" : "p_delta"], r[call ? "c_iv" : "p_iv"]]).filter(([d, v]) => T.isNum(d) && T.isNum(v));
    pts.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < pts.length; i++) {
      const [d0, v0] = pts[i - 1], [d1, v1] = pts[i];
      if ((d0 - target) * (d1 - target) <= 0 && d1 !== d0) return v0 + (v1 - v0) * (target - d0) / (d1 - d0);
    }
    return null;
  }
  OL.skew = (o) => o.expiries.filter((e) => o.chains[e.date]).map((e) => {
    const rows = o.chains[e.date];
    const c25 = ivAtDelta(rows, 0.25, true), p25 = ivAtDelta(rows, -0.25, false);
    return { date: e.date, dte: e.dte, atm: e.atm_iv, rr: T.isNum(c25) && T.isNum(p25) ? c25 - p25 : null,
      bf: T.isNum(c25) && T.isNum(p25) && T.isNum(e.atm_iv) ? (c25 + p25) / 2 - e.atm_iv : null, maxPain: OL.maxPain(rows) };
  });
  OL.maxPain = (rows) => {
    const oi = rows.reduce((a, r) => a + (r.c_oi || 0) + (r.p_oi || 0), 0);
    if (!oi) return null;
    let best = null;
    rows.forEach((k) => {
      const pay = rows.reduce((a, r) => a + (r.c_oi || 0) * Math.max(0, k.strike - r.strike) + (r.p_oi || 0) * Math.max(0, r.strike - k.strike), 0);
      if (!best || pay < best.pay) best = { strike: k.strike, pay };
    });
    return best && best.strike;
  };

  // ------------------------------------------------------------------ panels added to the Options tab
  OL.render = (el, tk, o) => {
    const sk = OL.skew(o);
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="grid g2" style="margin-top:14px" data-sec="greeks">
        <div class="panel"><h3>Skew par échéance <span class="hint">risk reversal et butterfly 25 delta</span></h3><div class="chart" id="oskew"></div>
          <p class="note"><b>Risk reversal</b> = IV call 25Δ - IV put 25Δ : négatif quand les puts (protection) sont plus chers, cas habituel des actions. <b>Butterfly</b> = prime payée pour les ailes (queues épaisses).</p></div>
        <div class="panel"><h3>Volatilité implicite 30 jours <span class="hint">historique relevé par le terminal</span></h3><div class="chart" id="oivh"></div>
          <p class="note">${(o.iv_history || []).length < 20 ? "L'historique se construit à chaque mise à jour : le rang et le percentile de l'IV deviendront significatifs après quelques semaines." : ivRank(o)}</p></div>
      </div>
      <div class="panel" style="margin-top:14px" data-sec="greeks"><h3>Grecques <span class="row"><select id="ogx" class="sel">${o.expiries.filter((e) => o.chains[e.date]).map((e) => `<option value="${e.date}">${F.date(e.date)} · ${F.n(e.dte, 0)} j</option>`).join("")}</select></span></h3>
        <div class="tbl-wrap" id="ogreeks"></div>
        <p class="note">Par action. Thêta : perte de valeur par jour calendaire ; véga : variation pour +1 point de volatilité. Max pain : strike où les acheteurs d'options perdraient le plus à l'échéance (indicatif, calculé sur l'open interest${sk.some((s) => s.maxPain) ? "" : ", indisponible tant que Yahoo ne publie pas l'open interest de la séance"}).</p></div>
      <div class="panel" style="margin-top:14px" id="olab" data-sec="strategies"></div>`;
    if (location.hash.startsWith("#/t/")) {
      const link = document.createElement("div");
      link.className = "banner results-banner";
      link.style.marginTop = "14px";
      link.innerHTML = `⌁ <div>Toutes les options au même endroit : <a href="#/options/${tk}/strategies"><b>espace Options</b></a> (stratégies, grecques, paper trading, mes positions), aussi accessible depuis le menu de gauche.</div>`;
      el.insertBefore(link, el.firstChild);
    }
    while (wrap.firstElementChild) el.appendChild(wrap.firstElementChild);   // sections stay direct children (the Options page shows them one at a time)
    // skew chart
    const ok = sk.filter((s) => T.isNum(s.rr));
    if (ok.length) T.ec(T.$("#oskew"), {
      legend: { data: ["Risk reversal", "Butterfly"] }, tooltip: { trigger: "axis", valueFormatter: (v) => (v == null ? "-" : F.n(v, 2) + " pt") },
      xAxis: T.axis({ type: "category", data: ok.map((s) => s.date.slice(5)), splitLine: { show: false } }),
      yAxis: T.axis({ type: "value", axisLabel: { color: C().muted, formatter: (v) => v + " pt" } }),
      series: [{ name: "Risk reversal", type: "bar", barMaxWidth: 16, data: ok.map((s) => +(s.rr * 100).toFixed(2)), itemStyle: { color: C().series[1] } },
        { name: "Butterfly", type: "line", data: ok.map((s) => (T.isNum(s.bf) ? +(s.bf * 100).toFixed(2) : null)), itemStyle: { color: C().series[0] } }],
    }); else T.$("#oskew").innerHTML = '<div class="empty" style="margin-top:40px">Deltas insuffisants pour mesurer le skew.</div>';
    // IV history
    const h = (o.iv_history || []).filter((x) => T.isNum(x.iv30));
    if (h.length >= 2) T.ec(T.$("#oivh"), {
      tooltip: { trigger: "axis", valueFormatter: (v) => F.n(v, 1) + " %" },
      xAxis: T.axis({ type: "category", data: h.map((x) => x.date), splitLine: { show: false } }),
      yAxis: T.axis({ type: "value", scale: true, axisLabel: { color: C().muted, formatter: (v) => v + " %" } }),
      series: [{ type: "line", showSymbol: h.length < 30, data: h.map((x) => +(x.iv30 * 100).toFixed(2)), lineStyle: { color: C().series[0], width: 2 } }],
    }); else T.$("#oivh").innerHTML = '<div class="empty" style="margin-top:40px">Un seul relevé pour l\'instant.</div>';
    // greeks table
    const drawGreeks = (exp) => {
      const rows = (o.chains[exp] || []).filter((r) => r.strike >= o.spot * 0.85 && r.strike <= o.spot * 1.15);
      const t = yf(exp), mp = OL.maxPain(o.chains[exp] || []);
      const g = (r, call) => { const v = r[call ? "c_iv" : "p_iv"]; return T.isNum(v) ? OL.greeks(o.spot, r.strike, t, o.rf, v, call) : null; };
      const cell = (x, d) => (x && T.isNum(x) ? F.n(x, d) : "-");
      T.$("#ogreeks").innerHTML = `<table class="t chain"><thead><tr><th class="n">Δ</th><th class="n">Γ</th><th class="n">Θ / j</th><th class="n">Véga</th><th class="n strike">Strike</th><th class="n">Δ</th><th class="n">Γ</th><th class="n">Θ / j</th><th class="n">Véga</th></tr>
        <tr class="sub"><th colspan="4" class="n">CALLS</th><th class="n">${mp ? "max pain " + F.n(mp, 0) : ""}</th><th colspan="4">PUTS</th></tr></thead><tbody>
        ${rows.map((r) => { const c = g(r, true) || {}, p = g(r, false) || {};
          return `<tr class="${r.strike === mp ? "hl" : ""}"><td class="n">${cell(c.delta, 2)}</td><td class="n">${cell(c.gamma, 4)}</td><td class="n">${cell(c.theta, 3)}</td><td class="n">${cell(c.vega, 3)}</td>
            <td class="n strike"><b>${F.n(r.strike, r.strike % 1 ? 1 : 0)}</b></td>
            <td class="n">${cell(p.delta, 2)}</td><td class="n">${cell(p.gamma, 4)}</td><td class="n">${cell(p.theta, 3)}</td><td class="n">${cell(p.vega, 3)}</td></tr>`; }).join("")}</tbody></table>`;
    };
    T.$("#ogx").addEventListener("change", (e) => drawGreeks(e.target.value));
    drawGreeks(T.$("#ogx").value);
    OL.builder(T.$("#olab"), tk, o);
  };

  function ivRank(o) {
    const h = o.iv_history.map((x) => x.iv30).filter(T.isNum);
    const cur = h[h.length - 1], lo = Math.min(...h), hi = Math.max(...h);
    const rank = hi > lo ? (cur - lo) / (hi - lo) : null, pct = h.filter((x) => x <= cur).length / h.length;
    return `IV 30 j actuelle ${F.pct(cur, 1)} · rang ${F.pct(rank, 0)} (position entre le plus bas et le plus haut relevés) · percentile ${F.pct(pct, 0)} sur ${h.length} relevés.`;
  }

  // ------------------------------------------------------------------ strategy builder
  const PRESETS = {
    "Achat de call": (S) => [["long", "C", 0, 1]],
    "Achat de put": (S) => [["long", "P", 0, 1]],
    "Straddle": (S) => [["long", "C", 0, 1], ["long", "P", 0, 1]],
    "Strangle": (S) => [["long", "C", 0.05, 1], ["long", "P", -0.05, 1]],
    "Call spread haussier": (S) => [["long", "C", 0, 1], ["short", "C", 0.07, 1]],
    "Put spread baissier": (S) => [["long", "P", 0, 1], ["short", "P", -0.07, 1]],
    "Iron condor": (S) => [["short", "P", -0.05, 1], ["long", "P", -0.1, 1], ["short", "C", 0.05, 1], ["long", "C", 0.1, 1]],
    "Papillon": (S) => [["long", "C", -0.05, 1], ["short", "C", 0, 2], ["long", "C", 0.05, 1]],
  };

  OL.builder = (box, tk, o) => {
    const exps = o.expiries.filter((e) => o.chains[e.date] && e.dte >= 2).map((e) => e.date);
    let legs = [];
    const nearest = (exp, K) => (o.chains[exp] || []).reduce((a, r) => (!a || Math.abs(r.strike - K) < Math.abs(a.strike - K) ? r : a), null);
    const quote = (l) => { const r = (o.chains[l.exp] || []).find((x) => x.strike === l.strike) || {}; const p = l.type === "C" ? "c" : "p";
      return { mid: r[p + "_mid"], iv: r[p + "_iv"], bid: r[p + "_bid"], ask: r[p + "_ask"] }; };
    const defaultExp = () => { const e = (o.earnings && o.earnings.expiry && exps.includes(o.earnings.expiry)) ? o.earnings.expiry : exps.find((x) => yf(x) * 365 >= 20) || exps[0]; return e; };
    function preset(name) {
      const exp = defaultExp();
      legs = PRESETS[name](o.spot).map(([side, type, off, qty]) => ({ side, type, exp, strike: (nearest(exp, o.spot * (1 + off)) || {}).strike, qty }))
        .filter((l) => T.isNum(l.strike));
      draw();
    }
    box.innerHTML = `<h3>Constructeur de stratégies <span class="hint">payoff à l'échéance et aujourd'hui</span></h3>
      <div class="row" id="opresets">${Object.keys(PRESETS).map((k) => `<button class="chip" data-p="${k}">${k}</button>`).join("")}<button class="chip" id="oaddleg">+ Jambe</button></div>
      <div class="grid g-main" style="margin-top:10px">
        <div><div class="tbl-wrap"><table class="t legs"><thead><tr><th>Sens</th><th>Type</th><th>Échéance</th><th class="n">Strike</th><th class="n">Qté</th><th class="n">Prime (mid)</th><th class="n">IV</th><th></th></tr></thead><tbody id="olegs"></tbody></table></div>
          <div class="chart" id="opayoff" style="height:300px;margin-top:8px"></div></div>
        <div><div class="kpis kpis-col" id="ostats"></div><div id="otrade"></div></div>
      </div>
      <p class="note">Valeurs pour 1 contrat = 100 actions. Courbe « aujourd'hui » : Black-Scholes avec l'IV de chaque contrat. Probabilité de gain : loi log-normale avec l'IV ATM de l'échéance la plus proche (mesure risque-neutre, indicative). Les primes sont des milieux bid / ask : à l'exécution, on achète au prix demandé et on vend au prix offert.</p>`;
    T.$("#opresets").addEventListener("click", (e) => { const b = e.target.closest("[data-p]"); if (b) preset(b.dataset.p); });
    T.$("#oaddleg").onclick = () => { const exp = defaultExp(); legs.push({ side: "long", type: "C", exp, strike: (nearest(exp, o.spot) || {}).strike, qty: 1 }); draw(); };

    function draw() {
      T.$("#olegs").innerHTML = legs.map((l, i) => { const q = quote(l);
        return `<tr data-i="${i}"><td><select class="sel" data-f="side"><option value="long" ${l.side === "long" ? "selected" : ""}>Achat</option><option value="short" ${l.side === "short" ? "selected" : ""}>Vente</option></select></td>
          <td><select class="sel" data-f="type"><option value="C" ${l.type === "C" ? "selected" : ""}>Call</option><option value="P" ${l.type === "P" ? "selected" : ""}>Put</option></select></td>
          <td><select class="sel" data-f="exp">${exps.map((x) => `<option value="${x}" ${x === l.exp ? "selected" : ""}>${F.date(x)}</option>`).join("")}</select></td>
          <td class="n"><select class="sel" data-f="strike">${(o.chains[l.exp] || []).map((r) => `<option value="${r.strike}" ${r.strike === l.strike ? "selected" : ""}>${F.n(r.strike, r.strike % 1 ? 1 : 0)}</option>`).join("")}</select></td>
          <td class="n"><input class="sel" data-f="qty" type="number" min="1" max="50" value="${l.qty}" style="width:60px"></td>
          <td class="n">${T.isNum(q.mid) ? F.n(q.mid, 2) : "-"}</td><td class="n">${T.isNum(q.iv) ? F.pct(q.iv, 1) : "-"}</td>
          <td><button class="icon-btn" data-rm="${i}" title="Retirer">✕</button></td></tr>`; }).join("") || '<tr><td colspan="8" class="muted">Choisis une stratégie ci-dessus ou ajoute une jambe.</td></tr>';
      T.$$("#olegs select, #olegs input").forEach((inp) => inp.addEventListener("change", () => {
        const i = +inp.closest("tr").dataset.i, f = inp.dataset.f, l = legs[i];
        l[f] = f === "strike" || f === "qty" ? +inp.value : inp.value;
        if (f === "exp") l.strike = (nearest(l.exp, l.strike) || {}).strike;
        draw();
      }));
      T.$$("[data-rm]").forEach((b) => b.addEventListener("click", () => { legs.splice(+b.dataset.rm, 1); draw(); }));
      analyse();
    }

    function analyse() {
      const stats = T.$("#ostats"), chartEl = T.$("#opayoff"), trade = T.$("#otrade");
      const L = legs.map((l) => ({ ...l, ...quote(l), t: yf(l.exp), sign: l.side === "long" ? 1 : -1 })).filter((l) => T.isNum(l.mid) && T.isNum(l.strike));
      if (!L.length) { stats.innerHTML = ""; chartEl.innerHTML = ""; trade.innerHTML = ""; return; }
      const S0 = o.spot, r = o.rf || 0.04;
      const th = Math.min(...L.map((l) => l.t));
      const cost = L.reduce((a, l) => a + l.sign * l.qty * 100 * l.mid, 0);           // > 0 = débit
      const pnlAt = (S, today) => L.reduce((a, l) => {
        const tt = today ? l.t : l.t - th;
        const v = tt <= 1e-6 ? Math.max(0, l.type === "C" ? S - l.strike : l.strike - S) : OL.bs(S, l.strike, tt, r, l.iv || 0.4, l.type === "C");
        return a + l.sign * l.qty * 100 * v;
      }, 0) - cost;
      const lo = S0 * 0.6, hi = S0 * 1.4, n = 240, xs = Array.from({ length: n + 1 }, (_, i) => lo + (hi - lo) * i / n);
      const exp = xs.map((x) => pnlAt(x, false)), now = xs.map((x) => pnlAt(x, true));
      const be = [];
      for (let i = 1; i < xs.length; i++) if ((exp[i - 1] <= 0) !== (exp[i] <= 0)) be.push(xs[i - 1] + (xs[i] - xs[i - 1]) * (0 - exp[i - 1]) / (exp[i] - exp[i - 1]));
      const slopeHi = exp[n] - exp[n - 1], slopeLo = exp[1] - exp[0];
      const maxP = slopeHi > 1e-6 ? null : Math.max(...exp), maxL = (slopeLo < -1e-6 || slopeHi < -1e-6) ? null : Math.min(...exp);
      // probability of profit at the horizon (log-normal, ATM IV of the horizon expiry)
      const hexp = L.reduce((a, l) => (l.t === th ? l.exp : a), L[0].exp);
      const sig = ((o.expiries.find((e) => e.date === hexp) || {}).atm_iv) || 0.4;
      let pop = 0;
      const grid = 600, gl = S0 * 0.2, gh = S0 * 2.5, dx = (gh - gl) / grid;
      for (let i = 0; i < grid; i++) {
        const S = gl + dx * (i + 0.5), z = (Math.log(S / S0) - (r - sig * sig / 2) * th) / (sig * Math.sqrt(th || 1e-6));
        if (pnlAt(S, false) > 0) pop += npdf(z) / (S * sig * Math.sqrt(th || 1e-6)) * dx;
      }
      const G = L.reduce((a, l) => { const g = OL.greeks(S0, l.strike, l.t, r, l.iv || 0.4, l.type === "C");
        ["delta", "gamma", "theta", "vega"].forEach((k) => (a[k] += l.sign * l.qty * 100 * g[k])); return a; }, { delta: 0, gamma: 0, theta: 0, vega: 0 });
      const k = (l, v, s) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
      stats.innerHTML = k(cost >= 0 ? "Coût (débit)" : "Encaissé (crédit)", F.n(Math.abs(cost), 0) + " $", `${L.length} jambe(s), échéance ${F.date(hexp)}`)
        + k("Gain max", maxP == null ? "illimité" : F.n(maxP, 0) + " $", "à l'échéance la plus proche")
        + k("Perte max", maxL == null ? "illimitée" : F.n(maxL, 0) + " $", maxL == null ? "position vendeuse non couverte" : "")
        + k("Points morts", be.length ? be.map((x) => F.n(x, 1)).join(" · ") : "-", `cours actuel ${F.n(S0, 2)}`)
        + k("Probabilité de gain", F.pct(pop, 0), `IV ATM ${F.pct(sig, 1)}`)
        + k("Grecques", `Δ ${F.n(G.delta, 0)}`, `Γ ${F.n(G.gamma, 2)} · Θ ${F.n(G.theta, 0)} $/j · véga ${F.n(G.vega, 0)} $`);
      T.ec(chartEl, {
        legend: { data: ["À l'échéance", "Aujourd'hui"] }, tooltip: { trigger: "axis", formatter: (ps) => `Cours ${F.n(+ps[0].axisValue, 1)}<br>` + ps.map((p) => `${p.seriesName} : <b>${F.n(p.value[1], 0)} $</b>`).join("<br>") },
        grid: { left: 8, right: 14, top: 30, bottom: 24, containLabel: true },
        xAxis: T.axis({ type: "value", min: Math.round(lo), max: Math.round(hi), axisLabel: { color: C().muted } }),
        yAxis: T.axis({ type: "value", axisLabel: { color: C().muted, formatter: (v) => F.n(v / 1000, 1) + " k" } }),
        series: [
          { name: "À l'échéance", type: "line", showSymbol: false, data: xs.map((x, i) => [x, exp[i]]), lineStyle: { width: 2, color: C().series[0] }, itemStyle: { color: C().series[0] },
            areaStyle: { origin: 0, color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "rgba(38,166,154,.25)" }, { offset: 1, color: "rgba(239,83,80,.25)" }] } },
            markLine: { symbol: "none", silent: true, data: [{ xAxis: S0, label: { formatter: "cours", color: C().text2 }, lineStyle: { color: C().text, type: "dashed" } }, { yAxis: 0, label: { show: false }, lineStyle: { color: C().muted } }] } },
          { name: "Aujourd'hui", type: "line", showSymbol: false, data: xs.map((x, i) => [x, now[i]]), lineStyle: { width: 1.5, type: "dashed", color: C().series[1] }, itemStyle: { color: C().series[1] } },
        ],
      });
      // paper trade (long legs only)
      const M = T.members;
      if (!M || !M.configured || !T.member) { trade.innerHTML = `<p class="note">Connecte-toi pour acheter ces contrats dans un portefeuille fictif.</p>`; return; }
      if (L.some((l) => l.side === "short")) { trade.innerHTML = `<p class="note warn">Paper trading : positions acheteuses uniquement pour l'instant (la vente à découvert d'options demanderait des règles de marge).</p>`; return; }
      trade.innerHTML = `<div class="panel-sub"><b>Acheter dans un portefeuille fictif</b>
        <div class="row" style="margin-top:6px"><select class="sel" id="opf"><option>Chargement…</option></select><button class="btn primary" id="obuy">Passer ${L.length} ordre(s)</button></div>
        <div class="note" id="obmsg">Exécution à la clôture de la prochaine séance, au prix demandé (ask). Coût estimé au milieu : ${F.n(cost, 0)} $.</div></div>`;
      M.sb.from("portfolios").select("id, name, cash").eq("user_id", T.member.id).then(({ data }) => {
        const sel = T.$("#opf"); if (!sel) return;
        sel.innerHTML = (data || []).map((p) => `<option value="${p.id}">${T.esc(p.name)} · ${F.n(+p.cash, 0)} $</option>`).join("") || "<option value=''>Crée d'abord un portefeuille</option>";
      });
      T.$("#obuy").onclick = async () => {
        const pf = T.$("#opf").value, msg = T.$("#obmsg");
        if (!pf) { msg.className = "note warn"; msg.innerHTML = 'Crée d\'abord un portefeuille dans <a href="#/portefeuilles">Portefeuilles</a>.'; return; }
        for (const l of L) {
          const r = await M.sb.rpc("place_option_order", { p_portfolio: pf, p_ticker: tk, p_expiry: l.exp, p_strike: l.strike, p_type: l.type, p_side: "buy", p_qty: l.qty });
          if (r.error) { msg.className = "note warn"; msg.textContent = r.error.message; return; }
        }
        msg.className = "note up"; msg.innerHTML = `${L.length} ordre(s) enregistré(s) ✓ <a href="#/portefeuilles/${pf}">voir le portefeuille</a>`;
      };
    }
    preset("Achat de call");
  };

  // ------------------------------------------------------------------ dedicated page #/options[/<TICKER>[/<section>]]
  const SECTIONS = [["market", "Marché"], ["greeks", "Grecques et skew"], ["strategies", "Stratégies"], ["positions", "Mes positions"]];
  let optTickers = null;
  async function tickersWithOptions() {
    if (optTickers) return optTickers;
    const u = await T.get("universe.json");
    const out = [];
    for (const t of u.tickers) { try { const o = await T.get(`${t.ticker}/options.json`); out.push({ ...t, iv30: o.iv30, earnings: o.earnings }); } catch (e) { /* none */ } }
    optTickers = out;
    return out;
  }
  T.route(/^\/options(?:\/([A-Za-z.\-]+))?(?:\/(\w+))?$/, async (view, tkArg, secArg) => {
    const list = await tickersWithOptions();
    if (!list.length) { view.innerHTML = '<div class="empty">Aucune chaîne d\'options disponible pour l\'instant.</div>'; return; }
    const tk = (tkArg || list[0].ticker).toUpperCase();
    let sec = SECTIONS.some(([k]) => k === secArg) ? secArg : "market";
    view.innerHTML = `<div class="thead"><div class="id"><h1>Options</h1><div class="sub">Volatilité implicite, grecques, stratégies et paper trading d'options · données Yahoo différées</div></div></div>
      <div class="opt-tickers">${list.map((t) => `<a class="opt-tk ${t.ticker === tk ? "on" : ""}" href="#/options/${t.ticker}/${sec}"><b>${t.ticker}</b><span class="num">${F.n(t.price, 2)}</span>
        <span class="muted">IV 30 j ${F.pct(t.iv30, 1)}${t.earnings && t.earnings.date ? ` · résultats ${F.date(t.earnings.date)}` : ""}</span></a>`).join("")}</div>
      <nav class="tabs" id="osecs">${SECTIONS.map(([k, l]) => `<a href="#/options/${tk}/${k}" data-k="${k}" class="${k === sec ? "active" : ""}">${l}</a>`).join("")}
        <a href="#/t/${tk}" class="tabs-aside">Fiche ${tk} →</a></nav>
      <div id="ocontent"><div class="loading">Chargement…</div></div>`;
    const box = T.$("#ocontent");
    box.innerHTML = "";
    await T.tabOptions(box, tk);
    [...box.children].forEach((c) => { if (!c.dataset.sec) c.dataset.sec = "market"; });
    const pos = document.createElement("div");
    pos.dataset.sec = "positions";
    box.appendChild(pos);
    renderPositions(pos, tk);
    const show = (k) => {
      sec = k;
      [...box.children].forEach((c) => { c.style.display = c.dataset.sec === k ? "" : "none"; });
      T.$$("#osecs a[data-k]").forEach((a) => a.classList.toggle("active", a.dataset.k === k));
      T.$$(".opt-tk").forEach((a) => { a.href = `#/options/${a.querySelector("b").textContent}/${k}`; });
      history.replaceState(null, "", `#/options/${tk}/${k}`);
      window.dispatchEvent(new Event("resize"));            // charts drawn while hidden
    };
    T.$("#osecs").addEventListener("click", (e) => { const a = e.target.closest("a[data-k]"); if (!a) return; e.preventDefault(); show(a.dataset.k); });
    show(sec);
    T.markNav("/options");
  });

  // all my option positions and orders, every portfolio
  async function renderPositions(box, tk) {
    const M = T.members;
    if (!M || !M.configured) { box.innerHTML = '<div class="panel"><p class="note" style="margin:0">L\'espace membres n\'est pas activé.</p></div>'; return; }
    await M.ready;
    if (!T.member) { box.innerHTML = '<div class="panel"><h3>Mes positions</h3><p class="sec">Connecte-toi pour acheter des options dans tes portefeuilles fictifs.</p><a class="btn primary" href="#/compte">Se connecter</a></div>'; return; }
    const sb = M.sb;
    const [pfs, trades, orders] = await Promise.all([
      sb.from("portfolios").select("id, name, cash").eq("user_id", T.member.id),
      sb.from("option_trades").select("*").eq("user_id", T.member.id).order("id"),
      sb.from("option_orders").select("*").eq("user_id", T.member.id).order("id", { ascending: false }).limit(30)]);
    const pfName = Object.fromEntries((pfs.data || []).map((p) => [p.id, p.name]));
    const key = (t) => `${t.portfolio_id}|${t.ticker}|${t.expiry}|${+t.strike}|${t.type}`;
    const pos = {};
    (trades.data || []).forEach((t) => { const k = key(t), p = pos[k] || (pos[k] = { ...t, strike: +t.strike, qty: 0, cost: 0 });
      if (t.side === "buy") { p.cost += t.qty * +t.price * 100; p.qty += t.qty; } else { const avg = p.qty ? p.cost / p.qty : 0; p.qty -= t.qty; p.cost -= avg * t.qty; } });
    const open = Object.values(pos).filter((p) => p.qty > 0);
    const chains = {};
    for (const t of new Set(open.map((p) => p.ticker))) { try { chains[t] = await T.get(`${t}/options.json`); } catch (e) { /* none */ } }
    const mark = (p) => { const r = ((chains[p.ticker] || {}).chains || {})[p.expiry]; const row = r && r.find((x) => x.strike === p.strike);
      return row ? row[p.type === "C" ? "c_mid" : "p_mid"] : null; };
    box.innerHTML = `<div class="panel"><h3>Mes positions d'options <span class="hint">tous portefeuilles · 1 contrat = 100 actions</span></h3>
      <div class="tbl-wrap"><table class="t"><thead><tr><th>Portefeuille</th><th>Contrat</th><th class="n">Qté</th><th class="n">Prime moy.</th><th class="n">Dernier</th><th class="n">Valeur</th><th class="n">+/- value</th><th class="n">Échéance</th></tr></thead><tbody>
      ${open.map((p) => { const m = mark(p), val = T.isNum(m) ? m * 100 * p.qty : null, pnl = val != null ? val - p.cost : null;
        return `<tr style="cursor:pointer" data-href="#/portefeuilles/${p.portfolio_id}"><td>${T.esc(pfName[p.portfolio_id] || "?")}</td><td><b>${p.ticker}</b> ${F.n(p.strike, p.strike % 1 ? 1 : 0)} ${p.type === "C" ? "call" : "put"} <span class="muted">${F.date(p.expiry)}</span></td>
          <td class="n">${p.qty}</td><td class="n">${F.n(p.cost / p.qty / 100, 2)}</td><td class="n">${F.n(m, 2)}</td><td class="n">${F.n(val, 0)} $</td>
          <td class="n ${T.cls(pnl)}">${F.n(pnl, 0)} $</td><td class="n">J-${Math.max(0, Math.ceil((new Date(p.expiry + "T21:00:00Z") - Date.now()) / 864e5))}</td></tr>`; }).join("")
        || '<tr><td colspan="8"><div class="empty">Aucune position. Construis une stratégie dans l\'onglet <b>Stratégies</b>, ou passe un ordre depuis un portefeuille.</div></td></tr>'}
      </tbody></table></div></div>
      <div class="panel" style="margin-top:14px"><h3>Ordres récents</h3>
        ${(orders.data || []).map((o) => `<div class="order-row"><span class="${o.side === "buy" ? "up" : "down"}">${o.side === "buy" ? "Achat" : "Vente"}</span> <b>${o.qty} ${o.ticker} ${F.n(+o.strike, 0)} ${o.type}</b> <span class="muted">${F.date(o.expiry)} · ${T.esc(pfName[o.portfolio_id] || "")}</span>
          <span class="badge ${o.status === "filled" ? "st-resolved" : o.status === "pending" ? "st-pending" : "st-late"}">${{ pending: "en attente", filled: "exécuté", rejected: "rejeté", cancelled: "annulé" }[o.status]}</span>
          <span class="muted num">${o.status === "filled" ? `${F.n(+o.fill_price, 2)} le ${F.date(o.fill_date)}` : o.reason ? T.esc(o.reason) : F.dateTime(o.created_at)}</span></div>`).join("") || '<div class="muted">Aucun ordre.</div>'}
        <p class="note">Ordres exécutés à la clôture de la prochaine séance : achat au prix demandé (ask), vente au prix offert (bid). Pour revendre ou annuler, ouvre le portefeuille concerné.</p></div>`;
    T.$$("tr[data-href]", box).forEach((tr) => tr.addEventListener("click", () => T.go(tr.dataset.href)));
  }
})();
