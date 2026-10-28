/* Ticker pages: Synthèse, Financiers, Ratios, Valorisation, Secteur, Performance, Dépôts. */
(function () {
  "use strict";
  const T = window.T, F = T.fmt, C = () => T.C;

  const TABS = [
    ["synthese", "Synthèse"], ["financiers", "États financiers"], ["ratios", "Ratios"], ["valorisation", "Valorisation"],
    ["predictions", "Prédictions"], ["options", "Options"], ["secteur", "Secteur"], ["performance", "Performance"],
    ["depots", "Dépôts SEC"],
  ];

  // ================================================================== shell
  T.route(/^\/t\/([A-Za-z.\-]+)(?:\/(\w+))?$/, async (view, tk, tab) => {
    tk = tk.toUpperCase();
    tab = tab || "synthese";
    const [co, val, status] = await Promise.all([T.get(`${tk}/company.json`), T.get(`${tk}/valuation.json`),
      T.get("status.json").catch(() => null)]);
    const p = co.perf || {};
    const sc = val.scenarios || {};
    const w = sc.weighted_value_per_share, base = val.dcf.result.value_per_share;
    const up = T.isNum(w) && T.isNum(co.price) ? w / co.price - 1 : null;
    const ev = val.target ? val.target.enterprise_value : null;
    view.innerHTML = `${T.banner(co.meta, status)}
      <div class="thead">
        <div class="id"><h1>${T.esc(co.name)} <span class="tag">${tk}</span><span class="tag">${T.esc((co.profile.exchanges || [])[0] || "")}</span></h1>
          <div class="sub">${T.esc(co.sector || "")} · ${T.esc(co.industry || "")} · dernier trimestre publié : ${T.esc(co.latest_period || "-")}</div></div>
        <div class="quote"><span class="px">${F.px(co.price)}</span>
          <span class="chg ${T.cls(p.chg_1d)}">${F.pct(p.chg_1d, 2, true)}</span></div>
        <div class="asof">Clôture du ${F.date(p.date)}<br>Données au ${F.dateTime(co.meta.generated_at)}</div>
      </div>
      <div class="kpis">
        <div class="kpi"><div class="l">Capitalisation</div><div class="v">${F.usd(co.market_cap)}</div><div class="s">VE ${F.usd(ev)}</div></div>
        <div class="kpi hl"><div class="l">Valeur pondérée (scénarios)</div><div class="v">${F.px(w)}</div><div class="s ${T.cls(up)}">${F.pct(up, 1, true)} vs cours</div></div>
        <div class="kpi"><div class="l">DCF scénario base</div><div class="v">${F.px(base)}</div><div class="s">WACC ${F.pct(val.dcf.inputs.wacc, 2)}</div></div>
        <div class="kpi"><div class="l">Comparables (médiane)</div><div class="v">${F.px((val.comps.implied_summary || {}).median)}</div><div class="s">${F.px((val.comps.implied_summary || {}).low, 0)} - ${F.px((val.comps.implied_summary || {}).high, 0)}</div></div>
        <div class="kpi"><div class="l">P/E · VE/CA (TTM)</div><div class="v">${F.x(val.target.pe)} · ${F.x(val.target.ev_sales)}</div><div class="s">VE/EBITDA ${F.x(val.target.ev_ebitda)}</div></div>
        <div class="kpi"><div class="l">52 semaines</div><div class="v">${F.n(p.low_52w, 0)} - ${F.n(p.high_52w, 0)}</div><div class="s">1 an <span class="${T.cls(p.r_1y)}">${F.pct(p.r_1y, 0, true)}</span> · β ${F.n((co.beta || {}).adjusted, 2)}</div></div>
      </div>
      <nav class="tabs">${TABS.map(([k, l]) => `<a href="#/t/${tk}/${k}" class="${k === tab ? "active" : ""}">${l}</a>`).join("")}</nav>
      <div id="tab"></div>
      <footer class="foot"><span>Sources : SEC EDGAR (XBRL), Yahoo Finance / Stooq (cours), FRED (taux).</span>
        <span>Graphiques : <a href="https://www.tradingview.com/" target="_blank" rel="noopener">TradingView Lightweight Charts™</a>, Apache ECharts.</span>
        <span>Pas un conseil en investissement.</span></footer>`;
    T.onKey = (e) => { const i = parseInt(e.key, 10); if (i >= 1 && i <= TABS.length) T.go(`#/t/${tk}/${TABS[i - 1][0]}`); };
    const el = T.$("#tab");
    const fn = { synthese, financiers, ratios, valorisation, secteur, performance, depots,
      predictions: T.tabPredictions, options: T.tabOptions }[tab] || synthese;
    await fn(el, tk, co, val);
  });

  // ================================================================== helpers
  function priceChart(el, bars, { mode = "area", range = "1A", benchmarks = null, benchNames = {}, tk = "" } = {}) {
    const chart = T.lw(el, { rightPriceScale: { borderColor: C().border, mode: mode === "cmp" ? 2 : 0 } });
    if (mode === "candles") {
      const s = chart.addCandlestickSeries({ upColor: C().up, downColor: C().down, borderVisible: false,
        wickUpColor: C().up, wickDownColor: C().down });
      s.setData(bars.map((b) => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c })));
      const v = chart.addHistogramSeries({ priceScaleId: "", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
      v.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      v.setData(bars.map((b) => ({ time: b.t, value: b.v, color: b.c >= b.o ? "rgba(38,166,154,.35)" : "rgba(239,83,80,.35)" })));
    } else if (mode === "cmp" && benchmarks) {
      const s = chart.addLineSeries({ color: T.colorOf(tk), lineWidth: 2, title: tk });
      s.setData(bars.map((b) => ({ time: b.t, value: b.ac })));
      const bc = { SPY: C().neutral, SOXX: C().series[5] };
      Object.entries(benchmarks).forEach(([k, arr]) => {
        const l = chart.addLineSeries({ color: bc[k] || C().muted, lineWidth: 2, title: k });
        l.setData(arr.map(([t, v]) => ({ time: t, value: v })));
      });
    } else {
      const s = chart.addAreaSeries({ lineColor: "#3d7bff", lineWidth: 2,
        topColor: "rgba(41,98,255,.28)", bottomColor: "rgba(41,98,255,0)" });
      s.setData(bars.map((b) => ({ time: b.t, value: b.c })));
    }
    setRange(chart, bars, range);
    return chart;
  }
  function setRange(chart, bars, range) {
    if (!bars.length) return;
    const last = new Date(bars[bars.length - 1].t + "T00:00:00");
    const d = new Date(last);
    ({ "1M": () => d.setMonth(d.getMonth() - 1), "3M": () => d.setMonth(d.getMonth() - 3), "6M": () => d.setMonth(d.getMonth() - 6),
       "YTD": () => d.setMonth(0, 1), "1A": () => d.setFullYear(d.getFullYear() - 1), "3A": () => d.setFullYear(d.getFullYear() - 3),
       "5A": () => d.setFullYear(d.getFullYear() - 5) }[range] || (() => d.setFullYear(d.getFullYear() - 1)))();
    const from = d.toISOString().slice(0, 10);
    chart.timeScale().setVisibleRange({ from: from < bars[0].t ? bars[0].t : from, to: bars[bars.length - 1].t });
  }
  const seg = (id, opts, on) => `<div class="seg" id="${id}">${opts.map(([k, l]) => `<button data-k="${k}" class="${k === on ? "on" : ""}">${l}</button>`).join("")}</div>`;
  function onSeg(id, cb) {
    const s = T.$("#" + id);
    s.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      T.$$("button", s).forEach((x) => x.classList.toggle("on", x === b));
      cb(b.dataset.k);
    });
  }

  function footballField(el, rows, price) {
    if (!rows || !rows.length) { el.innerHTML = '<div class="empty">Pas assez de données.</div>'; return; }
    const labels = rows.map((r) => r.label);
    const all = rows.flatMap((r) => [r.low, r.high]).concat(price ? [price] : []).filter(T.isNum);
    const lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo) * 0.08;
    const step = Math.pow(10, Math.floor(Math.log10(Math.max(hi - lo, 1))));
    const xmin = Math.max(0, Math.floor((lo - pad) / step) * step), xmax = Math.ceil((hi + pad) / step) * step;
    T.ec(el, {
      grid: { left: 8, right: 26, top: 30, bottom: 4, containLabel: true },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: (ps) => {
        const r = rows[ps[0].dataIndex];
        return `<b>${T.esc(r.label)}</b><br>${F.px(r.low)} - ${F.px(r.high)}${T.isNum(r.mid) ? `<br>Point central ${F.px(r.mid)}` : ""}`;
      } },
      xAxis: T.axis({ type: "value", min: xmin, max: xmax, axisLabel: { color: C().muted, formatter: (v) => F.n(v, 0) } }),
      yAxis: T.axis({ type: "category", data: labels, inverse: true, axisLabel: { color: C().text2, fontFamily: "Inter", width: 180, overflow: "break" }, splitLine: { show: false } }),
      series: [
        { type: "bar", stack: "r", data: rows.map((r) => r.low), itemStyle: { color: "transparent" }, silent: true, barWidth: 14 },
        { type: "bar", stack: "r", data: rows.map((r, i) => ({ value: r.high - r.low,
            itemStyle: { color: i === rows.length - 1 ? C().neutral : C().series[0], borderRadius: 4 } })), barWidth: 14,
          markLine: price ? { symbol: "none", silent: true, label: { position: "start", formatter: "cours " + F.n(price, 0), color: C().text, fontFamily: "JetBrains Mono", fontSize: 11 },
            lineStyle: { color: C().text, type: "solid", width: 1.5 }, data: [{ xAxis: price }] } : undefined },
        { type: "scatter", symbolSize: 9, data: rows.map((r, i) => (T.isNum(r.mid) ? [r.mid, i] : null)).filter(Boolean),
          itemStyle: { color: "#fff", borderColor: C().panel, borderWidth: 2 }, tooltip: { show: false } },
      ],
    });
  }

  // ================================================================== Synthèse
  async function synthese(el, tk, co, val) {
    const [px, fin, feed] = await Promise.all([T.get(`${tk}/prices.json`), T.get(`${tk}/financials.json`), T.get("feed.json")]);
    const ttm = fin.ttm;
    const sc = val.scenarios.cases || {};
    const price = co.price;
    const rev = val.reverse_dcf || {};
    const order = ["bear", "base", "bull"].filter((k) => sc[k]);
    const vals = order.map((k) => sc[k].value_per_share).concat([price]).filter(T.isNum);
    const lo = Math.min(...vals) * 0.9, hi = Math.max(...vals) * 1.05;
    const pos = (v) => ((v - lo) / (hi - lo)) * 100;
    const w = val.scenarios.weighted_value_per_share;
    const up = T.isNum(w) && T.isNum(price) ? w / price - 1 : null;
    const g = (k) => ttm[k];
    const yoy = (k) => (T.isNum(ttm[k]) && T.isNum(ttm[k + "_prev"]) && ttm[k + "_prev"] > 0 ? ttm[k] / ttm[k + "_prev"] - 1 : null);
    const events = (feed.events || []).filter((e) => e.ticker === tk).slice(0, 6);
    const keyFigs = `<div class="panel"><h3>Chiffres clés <span class="hint">${T.esc(ttm._label || "TTM")}</span></h3>
          <div class="kv">
            <div>Chiffre d'affaires</div><div>${F.usd(g("revenue"))} <span class="${T.cls(yoy("revenue"))}">${F.pct(yoy("revenue"), 0, true)}</span></div>
            <div>Résultat opérationnel</div><div>${F.usd(g("operating_income"))} <span class="muted">${F.pct(g("operating_income") / g("revenue"), 1)}</span></div>
            <div>Résultat net</div><div>${F.usd(g("net_income"))} <span class="${T.cls(yoy("net_income"))}">${F.pct(yoy("net_income"), 0, true)}</span></div>
            <div>Free cash flow</div><div>${F.usd(g("fcf"))} <span class="muted">${F.pct(g("fcf") / g("revenue"), 1)}</span></div>
            <div>BPA dilué</div><div>${F.n(g("eps_diluted"), 2)} $</div>
            <div>Trésorerie nette</div><div>${F.usd(g("net_cash"))}</div>
            <div>Rachats + dividendes</div><div>${F.usd((g("buybacks") || 0) + (g("dividends_paid") || 0))}</div>
          </div></div>`;
    const lowS = Math.min(...order.map((k) => sc[k].value_per_share)), highS = Math.max(...order.map((k) => sc[k].value_per_share));
    el.innerHTML = `
      <div class="grid g-main">
        <div class="panel" style="display:flex;flex-direction:column"><h3>Cours <span class="row">${seg("rng", [["1M", "1M"], ["3M", "3M"], ["6M", "6M"], ["YTD", "YTD"], ["1A", "1A"], ["5A", "5A"]], "1A")}</span></h3>
          <div class="chart lg" id="pc" style="flex:1;min-height:420px"></div></div>
        <div class="stack">
          <div class="panel verdict"><h3>Verdict du modèle <a class="hint" href="#/t/${tk}/valorisation">détail →</a></h3>
            <div class="row" style="align-items:baseline"><span class="big-val">${F.px(w)}</span>
              <span class="chg ${T.cls(up)}" style="font:600 14px var(--mono);padding:3px 8px;border-radius:6px">${F.pct(up, 1, true)}</span></div>
            <div class="muted">Valeur par action pondérée par les probabilités des scénarios</div>
            <div class="meter" style="margin-top:28px">
              <div class="fill" style="left:${pos(lowS)}%;right:${100 - pos(highS)}%;background:linear-gradient(90deg,rgba(57,135,229,.25),rgba(57,135,229,.55))"></div>
              ${order.map((k) => `<div class="mk" style="left:${pos(sc[k].value_per_share)}%;background:${C().series[0]}"><span>${k}</span></div>`).join("")}
              <div class="mk" style="left:${pos(price)}%;background:${C().text};height:22px;top:-7px"><span style="top:-17px;color:var(--text)">cours</span></div>
            </div>
            <div class="kv">${order.map((k) => `<div>${({ bear: "Bear", base: "Base", bull: "Bull" })[k]} · ${F.pct(sc[k].probability, 0)}</div><div>${F.px(sc[k].value_per_share)} <span class="${T.cls(sc[k].value_per_share / price - 1)}">${F.pct(sc[k].value_per_share / price - 1, 0, true)}</span></div>`).join("")}</div>
            <div class="note">${rev && T.isNum(rev.implied_growth)
              ? `<b>DCF reverse :</b> le cours actuel suppose une croissance du CA de <b>${F.pct(rev.implied_growth, 1)}</b> par an pendant ${rev.years} ans, contre <b>${F.pct(rev.assumed_growth_cagr, 1)}</b> dans le scénario base.`
              : "DCF reverse non calculable avec ces hypothèses."}</div>
          </div>
          ${keyFigs}
        </div>
      </div>
      <div class="grid g-main" style="margin-top:14px">
        <div class="panel"><h3>Football field <span class="hint">fourchettes de valeur par action ($)</span></h3><div class="chart" id="ff" style="height:250px"></div></div>
        <div class="panel"><h3>Thèse</h3><p class="sec" style="margin:0">${T.esc(co.thesis || "-")}</p>
          <p class="note">Hypothèses : <code>config/assumptions/${tk}.yaml</code> · <a href="${T.repoUrl(`edit/main/config/assumptions/${tk}.yaml`)}" target="_blank" rel="noopener">modifier sur GitHub ↗</a></p></div>
      </div>
      <div class="panel" style="margin-top:14px"><h3>Feed ${tk} <a class="hint" href="#/feed">tout voir →</a></h3><div class="feed">${events.map((e) => T.renderEvent(e, { hideTicker: true })).join("") || '<div class="empty">Aucun événement.</div>'}</div></div>`;
    const chart = priceChart(T.$("#pc"), px.bars, { range: "1A" });
    onSeg("rng", (k) => setRange(chart, px.bars, k));
    footballField(T.$("#ff"), val.football_field, price);
  }

  // ================================================================== Financiers
  const STMTS = {
    income: { label: "Compte de résultat", rows: [
      ["revenue", "total"], ["cost_of_revenue", "sub"], ["gross_profit", "total"], ["rnd", "sub"], ["sga", "sub"],
      ["operating_expenses", "sub"], ["operating_income", "total"], ["interest_expense", "sub"], ["pretax_income", ""],
      ["income_tax", "sub"], ["net_income", "total"], ["ebitda", "hl"], ["eps_diluted", "ps"], ["diluted_shares", "sh"]] },
    balance: { label: "Bilan", rows: [
      ["cash", ""], ["short_term_investments", ""], ["equity_investments", ""], ["receivables", ""], ["inventory", ""], ["current_assets", "total"],
      ["total_assets", "total"], ["current_liabilities", ""], ["debt_current", "sub"], ["debt_noncurrent", "sub"],
      ["total_debt", "hl"], ["total_liabilities", "total"], ["equity", "total"], ["net_cash", "hl"]] },
    cashflow: { label: "Flux de trésorerie", rows: [
      ["cfo", "total"], ["d_and_a", "sub"], ["sbc", "sub"], ["capex", "sub"], ["fcf", "hl"], ["acquisitions", ""],
      ["buybacks", ""], ["dividends_paid", ""]] },
  };
  async function financiers(el, tk) {
    const fin = await T.get(`${tk}/financials.json`);
    const st = { freq: "annual", stmt: "income", row: "revenue" };
    el.innerHTML = `<div class="panel" style="margin-bottom:14px"><h3><span id="chTitle"></span>
        <span class="row">${seg("freq", [["annual", "Annuel"], ["quarterly", "Trimestriel"]], "annual")}</span></h3>
        <div class="chart" id="finChart" style="height:240px"></div></div>
      <div class="panel"><h3><span class="row">${seg("stmt", Object.entries(STMTS).map(([k, v]) => [k, v.label]), "income")}</span>
        <span class="row"><span class="hint" id="unitHint"></span><button class="btn" id="csv">Exporter CSV</button></span></h3>
        <div class="tbl-wrap" id="finTbl"></div>
        <p class="note">Cliquer une ligne pour la tracer. Sous chaque valeur de flux : variation sur un an (même période N-1). Les en-têtes renvoient au dépôt EDGAR d'origine.</p></div>`;
    let chart;
    const periods = () => (st.freq === "annual" ? fin.periods.annual.slice(-8) : fin.periods.quarterly.slice(-12));
    const lag = () => (st.freq === "annual" ? 1 : 4);
    const all = () => (st.freq === "annual" ? fin.periods.annual : fin.periods.quarterly);
    const val = (k, l) => ((fin.lines[k] || {})[st.freq] || {})[l];
    const kind = (k) => fin.kinds[k];
    function unit() {
      const m = Math.max(...periods().map((p) => Math.abs(val("revenue", p.label) || 0)));
      return m >= 1e10 ? [1e9, "Md$"] : [1e6, "M$"];
    }
    function cell(k, l, i, div) {
      const v = val(k, l);
      if (!T.isNum(v)) return `<td class="n muted">-</td>`;
      let txt;
      if (k === "eps_diluted") txt = F.n(v, 2);
      else if (k === "diluted_shares") txt = F.n(v / 1e6, 0) + " M";
      else txt = F.n(v / div, div >= 1e9 ? 2 : 0);
      let yoy = "";
      if (kind(k) !== "instant") {
        const ap = all(), idx = ap.findIndex((p) => p.label === l);
        const prev = idx >= lag() ? val(k, ap[idx - lag()].label) : null;
        if (T.isNum(prev) && prev > 0) { const g = v / prev - 1; yoy = `<span class="yoy ${T.cls(g)}">${F.pct(g, 0, true)}</span>`; }
      }
      return `<td class="n">${txt}${yoy}</td>`;
    }
    function draw() {
      const [div, u] = unit();
      T.$("#unitHint").textContent = `en ${u} sauf BPA et actions`;
      const ps = periods();
      const rows = STMTS[st.stmt].rows.filter(([k]) => ps.some((p) => T.isNum(val(k, p.label))));
      const srcs = fin.sources[st.freq] || {};
      const head = ps.map((p) => {
        const acc = srcs[p.label];
        const url = acc ? `https://www.sec.gov/Archives/edgar/data/${fin.cik}/${acc.replace(/-/g, "")}/` : null;
        return `<th class="n">${url ? `<a href="${url}" target="_blank" rel="noopener">${p.label}</a>` : p.label}<br><span class="muted" style="text-transform:none">${F.date(p.end)}</span></th>`;
      }).join("");
      T.$("#finTbl").innerHTML = `<table class="t"><thead><tr><th class="lbl">${STMTS[st.stmt].label}</th>${head}</tr></thead><tbody>
        ${rows.map(([k, c]) => `<tr data-k="${k}" class="${c === "sub" ? "sub" : c === "total" ? "total" : c === "hl" ? "hl" : ""} ${k === st.row ? "sel" : ""}" style="cursor:pointer">
          <td class="lbl">${T.esc(fin.labels[k] || k)}</td>${ps.map((p, i) => cell(k, p.label, i, div)).join("")}</tr>`).join("")}</tbody></table>`;
      T.$$("#finTbl tbody tr").forEach((tr) => tr.addEventListener("click", () => { st.row = tr.dataset.k; draw(); }));
      drawChart(div, u);
    }
    function drawChart(div, u) {
      const k = st.row, ps = periods();
      const isPs = k === "eps_diluted", isSh = k === "diluted_shares";
      const d = isPs ? 1 : isSh ? 1e6 : div;
      T.$("#chTitle").textContent = `${fin.labels[k] || k} - ${isPs ? "$ par action" : isSh ? "millions d'actions" : u}`;
      if (chart) chart.dispose();
      chart = T.ec(T.$("#finChart"), {
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => F.n(v, isPs ? 2 : d >= 1e9 ? 2 : 0) },
        xAxis: T.axis({ type: "category", data: ps.map((p) => p.label), splitLine: { show: false } }),
        yAxis: T.axis({ type: "value", axisLabel: { color: C().muted, formatter: (v) => F.n(v, 0) } }),
        series: [{ type: "bar", data: ps.map((p) => { const v = val(k, p.label); return T.isNum(v) ? +(v / d).toFixed(4) : null; }),
          barMaxWidth: 34, itemStyle: { color: (p) => (p.value < 0 ? C().down : C().series[0]), borderRadius: [4, 4, 0, 0] },
          label: { show: true, position: "top", color: C().text2, fontSize: 10.5, fontFamily: "JetBrains Mono",
            formatter: (p) => (p.dataIndex === ps.length - 1 ? F.n(p.value, isPs ? 2 : d >= 1e9 ? 1 : 0) : "") } }],
      });
    }
    onSeg("freq", (k) => { st.freq = k; draw(); });
    onSeg("stmt", (k) => { st.stmt = k; st.row = STMTS[k].rows[0][0]; draw(); });
    T.$("#csv").addEventListener("click", () => {
      const ps = periods();
      const lines = [["ligne", ...ps.map((p) => p.label)].join(";")];
      Object.values(STMTS).forEach((s) => s.rows.forEach(([k]) => lines.push([fin.labels[k] || k, ...ps.map((p) => val(k, p.label) ?? "")].join(";"))));
      const blob = new Blob([lines.join("\n")], { type: "text/csv" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${tk}_${st.freq}.csv`; a.click();
    });
    draw();
  }

  // ================================================================== Ratios
  async function ratios(el, tk) {
    const r = await T.get(`${tk}/ratios.json`);
    const st = { freq: "annual" };
    el.innerHTML = `<div class="row" style="margin-bottom:6px"><span class="sec">Valeur affichée : TTM (12 derniers mois). Courbe : historique ${seg("rfreq", [["annual", "annuel"], ["quarterly", "trimestriel"]], "annual")}</span></div><div id="rbody"></div>
      <p class="note">Ratios trimestriels de rendement (ROE, ROIC, ROA, rotation) annualisés ×4. ROIC non calculé quand le capital investi est ≤ 0 (cas d'une trésorerie supérieure aux fonds propres + dette).</p>`;
    function draw() {
      T.disposeCharts();
      const defs = r.definitions;
      const groups = {};
      Object.entries(defs).forEach(([k, d]) => (groups[d.group] = groups[d.group] || []).push(k));
      T.$("#rbody").innerHTML = Object.entries(groups).map(([g, ks]) => `<div class="group-title">${g}</div><div class="rcards">
        ${ks.map((k) => {
          const series = r[st.freq][k] || {};
          const last = r.ttm[k] ?? Object.values(series).filter(T.isNum).slice(-1)[0];
          return `<div class="rcard"><div class="h"><span class="l">${T.esc(defs[k].label)}</span><span class="v">${F.by(defs[k].fmt, last)}</span></div>
            <div class="d">${T.esc(defs[k].def)}</div><div class="chart xs" data-k="${k}"></div>
            <div class="row muted num" style="justify-content:space-between;font-size:10px">${(() => { const ks = Object.keys(series).filter((x) => T.isNum(series[x])); return ks.length ? `<span>${ks[0]}</span><span>${ks[ks.length - 1]}</span>` : ""; })()}</div></div>`;
        }).join("")}</div>`).join("");
      T.$$("#rbody .chart").forEach((c) => {
        const k = c.dataset.k, d = defs[k], s = r[st.freq][k] || {};
        const xs = Object.keys(s), ys = Object.values(s);
        if (!ys.some(T.isNum)) { c.innerHTML = '<div class="muted" style="font-size:11px;padding-top:20px">pas de données</div>'; return; }
        const scale = d.fmt === "pct" ? 100 : d.fmt === "usd" ? 1e-9 : 1;
        T.ec(c, {
          grid: { left: 0, right: 0, top: 6, bottom: 0, containLabel: false },
          tooltip: { trigger: "axis", formatter: (ps) => `${ps[0].axisValue}<br><b>${F.by(d.fmt, ys[ps[0].dataIndex])}</b>` },
          xAxis: { type: "category", data: xs, show: false, boundaryGap: false },
          yAxis: { type: "value", show: false, scale: true },
          series: [{ type: "line", data: ys.map((y) => (T.isNum(y) ? y * scale : null)), smooth: false, symbol: "circle", symbolSize: 4, showSymbol: false,
            lineStyle: { width: 2, color: C().series[0] }, itemStyle: { color: C().series[0] }, connectNulls: true,
            areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: "rgba(57,135,229,.25)" }, { offset: 1, color: "rgba(57,135,229,0)" }]) } }],
        });
      });
    }
    onSeg("rfreq", (k) => { st.freq = k; draw(); });
    draw();
  }

  // ================================================================== Valorisation
  async function valorisation(el, tk, co, val) {
    const D = val.dcf, I = D.inputs, R = D.result, sc = val.scenarios.cases || {};
    const price = co.price;
    const rv = val.reverse_dcf || {};
    el.innerHTML = `
      <div class="kpis">
        <div class="kpi hl"><div class="l">DCF base</div><div class="v">${F.px(R.value_per_share)}</div><div class="s ${T.cls(R.upside)}">${F.pct(R.upside, 1, true)}</div></div>
        <div class="kpi"><div class="l">Valeur d'entreprise</div><div class="v">${F.usd(R.enterprise_value)}</div><div class="s">fonds propres ${F.usd(R.equity_value)}</div></div>
        <div class="kpi"><div class="l">WACC</div><div class="v">${F.pct(I.wacc, 2)}</div><div class="s">ke ${F.pct(I.wacc_detail.cost_of_equity, 2)} · β ${F.n(I.wacc_detail.beta, 2)}</div></div>
        <div class="kpi"><div class="l">Poids de la valeur terminale</div><div class="v">${F.pct(R.terminal_value_share_of_ev, 0)}</div><div class="s">g = ${F.pct(I.terminal_growth, 1)}</div></div>
        <div class="kpi"><div class="l">VE/EBITDA de sortie implicite</div><div class="v">${F.x(R.implied_exit_ev_ebitda)}</div><div class="s">contrôle de cohérence de la VT</div></div>
        <div class="kpi"><div class="l">Croissance implicite (reverse)</div><div class="v">${F.pct(rv.implied_growth, 1)}</div><div class="s">/an sur ${rv.years || "-"} ans vs ${F.pct(rv.assumed_growth_cagr, 1)} modèle</div></div>
      </div>
      <div class="panel" style="margin-bottom:14px"><h3>Scénarios <span class="hint">valeur pondérée : <b class="num" style="color:var(--text)">${F.px(val.scenarios.weighted_value_per_share)}</b></span></h3>
        <div class="scen">${["bear", "base", "bull"].filter((k) => sc[k]).map((k) => `<div class="c">
          <div class="h"><span>${k}</span><span>probabilité ${F.pct(sc[k].probability, 0)}</span></div>
          <div class="v">${F.px(sc[k].value_per_share)} <span class="${T.cls(sc[k].value_per_share / price - 1)}" style="font-size:13px">${F.pct(sc[k].value_per_share / price - 1, 0, true)}</span></div>
          <div class="muted num" style="font-size:11.5px">croissance a1-a5 : ${sc[k].growth_path.slice(0, 5).map((x) => F.pct(x, 0)).join(" · ")}<br>marge EBIT cible ${F.pct(sc[k].ebit_margin_target, 0)} · CA an ${I.years} : ${F.usd(sc[k].revenue_year_n)}</div>
          <p>${T.esc(sc[k].narrative || "")}</p></div>`).join("")}</div></div>

      <div class="panel" style="margin-bottom:14px"><h3>Simulateur DCF <span class="row">
          <button class="btn" id="reset">Réinitialiser</button><button class="btn" id="yaml">Copier en YAML</button>
          <a class="btn primary" href="${T.repoUrl(`edit/main/config/assumptions/${tk}.yaml`)}" target="_blank" rel="noopener">Enregistrer sur GitHub ↗</a></span></h3>
        <div class="grid g-main">
          <div><div class="controls" id="ctl"></div>
            <p class="note">Les curseurs ne modifient rien de façon permanente. Pour changer le modèle officiel (et déclencher un événement dans le feed), copie le YAML et colle-le dans <code>config/assumptions/${tk}.yaml</code> sur GitHub.</p></div>
          <div class="stack">
            <div><div class="muted">Valeur par action (simulée)</div><div class="row" style="align-items:baseline"><span class="big-val" id="simV">-</span><span id="simU" class="num"></span></div>
              <div class="kv" style="margin-top:10px" id="simKv"></div></div>
            <div class="chart" id="simChart" style="height:220px"></div>
          </div>
        </div>
        <details style="margin-top:10px"><summary class="sec" style="cursor:pointer">Tableau des projections</summary><div class="tbl-wrap" id="simTbl" style="margin-top:8px"></div></details>
      </div>

      <div class="grid g2" style="margin-bottom:14px">
        <div class="panel"><h3>Sensibilité - WACC × croissance terminale <span class="hint">$ par action</span></h3><div class="tbl-wrap" id="h1"></div></div>
        <div class="panel"><h3>Sensibilité - marge cible × croissance <span class="hint">$ par action</span></h3><div class="tbl-wrap" id="h2"></div></div>
      </div>

      <div class="grid g-main" style="margin-bottom:14px">
        <div class="panel"><h3>Comparables boursiers <span class="hint">multiples TTM · ${T.esc((val.target || {}).period || "")}</span></h3><div class="tbl-wrap" id="comps"></div>
          <p class="note"><b>Attention :</b> des multiples passés de pairs qui croissent moins vite sous-évaluent mécaniquement une entreprise en forte croissance. À lire comme un repère, pas comme un objectif.</p></div>
        <div class="panel"><h3>Historique valeur vs cours</h3><div class="chart" id="hist" style="height:240px"></div></div>
      </div>

      <div class="panel"><h3>D'où viennent les hypothèses</h3><div class="tbl-wrap" id="srcs"></div></div>`;

    // ---------------- simulator
    const base = JSON.parse(JSON.stringify(I));
    const W = Object.assign({}, I.wacc_detail);
    let sim = JSON.parse(JSON.stringify(I));
    const ctlDefs = [
      ...base.revenue_growth.map((_, i) => [`g${i}`, `Croissance CA année ${i + 1}`, -0.3, 1.2, 0.01, "pct", (s) => s.revenue_growth[i], (s, v) => { s.revenue_growth[i] = v; }]),
      ["mt", "Marge EBIT cible", 0, 0.8, 0.005, "pct", (s) => s.ebit_margin_target, (s, v) => { s.ebit_margin_target = v; }],
      ["my", "Années pour l'atteindre", 1, 10, 1, "int", (s) => s.margin_years_to_target, (s, v) => { s.margin_years_to_target = v; }],
      ["tg", "Croissance terminale", 0, 0.05, 0.0025, "pct", (s) => s.terminal_growth, (s, v) => { s.terminal_growth = v; }],
      ["tx", "Taux d'impôt", 0, 0.35, 0.005, "pct", (s) => s.tax_rate, (s, v) => { s.tax_rate = v; }],
      ["nw", "BFR / CA additionnel", 0, 0.5, 0.01, "pct", (s) => s.nwc_pct_incremental_revenue, (s, v) => { s.nwc_pct_incremental_revenue = v; }],
      ["da", "D&A / CA", 0, 0.2, 0.0025, "pct", (s) => s.d_and_a_pct_revenue, (s, v) => { s.d_and_a_pct_revenue = v; }],
      ["cx", "Capex / CA", 0, 0.3, 0.0025, "pct", (s) => s.capex_pct_revenue, (s, v) => { s.capex_pct_revenue = v; }],
      ["rf", "Taux sans risque", 0, 0.08, 0.0005, "pct", () => W.risk_free, (s, v) => { W.risk_free = v; }],
      ["bt", "Bêta", 0.3, 3, 0.01, "num", () => W.beta, (s, v) => { W.beta = v; }],
      ["erp", "Prime de risque actions", 0.02, 0.08, 0.0025, "pct", () => W.equity_risk_premium, (s, v) => { W.equity_risk_premium = v; }],
    ];
    const ctl = T.$("#ctl");
    const fmtC = (t, v) => (t === "pct" ? F.pct(v, 1) : t === "int" ? F.n(v, 0) : F.n(v, 2));
    function buildCtl() {
      ctl.innerHTML = ctlDefs.map(([id, l, mn, mx, stp, t, get]) => `<div class="ctl" data-id="${id}"><label>${l}<span class="num" id="v_${id}">${fmtC(t, get(sim))}</span></label>
        <input type="range" id="c_${id}" min="${mn}" max="${mx}" step="${stp}" value="${get(sim)}"></div>`).join("");
      ctlDefs.forEach(([id, , , , , t, get, set]) => {
        const inp = T.$("#c_" + id);
        inp.addEventListener("input", () => {
          const v = t === "int" ? parseInt(inp.value, 10) : parseFloat(inp.value);
          set(sim, v);
          T.$("#v_" + id).textContent = fmtC(t, v);
          inp.closest(".ctl").classList.toggle("changed", Math.abs(v - get(base, true)) > 1e-9);
          run();
        });
      });
    }
    let simChart;
    function run() {
      const ww = DCF.wacc(W, sim.tax_rate);
      sim.wacc = W.method === "fixed" ? I.wacc : ww.wacc;
      let res;
      try { res = DCF.dcf(Object.assign({}, sim, { price })); } catch (e) {
        T.$("#simV").textContent = "-"; T.$("#simU").textContent = "WACC ≤ g"; return;
      }
      T.$("#simV").textContent = F.px(res.value_per_share);
      const u = res.upside;
      T.$("#simU").innerHTML = `<span class="${T.cls(u)}">${F.pct(u, 1, true)} vs cours</span>`;
      const rvs = DCF.reverseDcf(Object.assign({}, sim, { price }));
      T.$("#simKv").innerHTML = `<div>WACC</div><div>${F.pct(sim.wacc, 2)}</div>
        <div>Valeur d'entreprise</div><div>${F.usd(res.enterprise_value)}</div>
        <div>Part de la valeur terminale</div><div>${F.pct(res.terminal_value_share_of_ev, 0)}</div>
        <div>VE/EBITDA de sortie implicite</div><div>${F.x(res.implied_exit_ev_ebitda)}</div>
        <div>CA année ${sim.years}</div><div>${F.usd(res.rows[res.rows.length - 1].revenue)}</div>
        <div>Croissance implicite au cours</div><div>${F.pct(rvs && rvs.implied_growth, 1)}</div>`;
      const yrs = res.rows.map((r) => "A" + r.year);
      const opt = {
        legend: { data: ["FCFF", "Valeur actuelle"] },
        tooltip: { trigger: "axis", valueFormatter: (v) => F.n(v, 1) + " Md$" },
        xAxis: T.axis({ type: "category", data: yrs, splitLine: { show: false } }),
        yAxis: T.axis({ type: "value", axisLabel: { color: C().muted, formatter: (v) => F.n(v, 0) } }),
        series: [
          { name: "FCFF", type: "bar", data: res.rows.map((r) => +(r.fcff / 1e9).toFixed(2)), itemStyle: { color: C().series[0], borderRadius: [3, 3, 0, 0] }, barGap: "10%", barMaxWidth: 18 },
          { name: "Valeur actuelle", type: "bar", data: res.rows.map((r) => +(r.pv / 1e9).toFixed(2)), itemStyle: { color: C().series[2], borderRadius: [3, 3, 0, 0] }, barMaxWidth: 18 },
        ],
      };
      if (simChart) simChart.setOption(opt); else simChart = T.ec(T.$("#simChart"), opt);
      T.$("#simTbl").innerHTML = `<table class="t"><thead><tr><th class="lbl">Md$</th>${yrs.map((y) => `<th class="n">${y}</th>`).join("")}</tr></thead><tbody>
        ${[["CA", "revenue", 1e9], ["Croissance", "growth", "pct"], ["Marge EBIT", "ebit_margin", "pct"], ["EBIT", "ebit", 1e9], ["NOPAT", "nopat", 1e9],
           ["+ D&A", "d_and_a", 1e9], ["- Capex", "capex", 1e9], ["- ΔBFR", "delta_nwc", 1e9], ["FCFF", "fcff", 1e9], ["Facteur d'actualisation", "discount_factor", "f"], ["Valeur actuelle", "pv", 1e9]]
          .map(([l, k, d]) => `<tr class="${k === "fcff" ? "total" : ""}"><td class="lbl">${l}</td>${res.rows.map((r) => `<td class="n">${d === "pct" ? F.pct(r[k], 1) : d === "f" ? F.n(r[k], 3) : F.n(r[k] / d, 1)}</td>`).join("")}</tr>`).join("")}
        </tbody></table><p class="note">Valeur terminale ${F.usd(res.terminal_value)} → actualisée ${F.usd(res.pv_terminal_value)}. VE ${F.usd(res.enterprise_value)} + trésorerie et placements ${F.usd(res.cash)} + participations ${F.usd(res.investments)} - dette ${F.usd(res.debt)} = ${F.usd(res.equity_value)} / ${F.n(res.shares / 1e9, 2)} Md actions.</p>`;
    }
    // For the "changed" marker, WACC inputs are compared with the original (pipeline) values
    ctlDefs.forEach((d) => { const g = d[6]; d[6] = (s, isBase) => (isBase && ["rf", "bt", "erp"].includes(d[0]) ? I.wacc_detail[{ rf: "risk_free", bt: "beta", erp: "equity_risk_premium" }[d[0]]] : g(s)); });
    buildCtl(); run();
    T.$("#reset").addEventListener("click", () => { sim = JSON.parse(JSON.stringify(I)); Object.assign(W, I.wacc_detail); buildCtl(); run(); });
    T.$("#yaml").addEventListener("click", async () => {
      const r3 = (x) => +(+x).toFixed(4);
      const same = (a, b) => Math.abs(a - b) < 1e-9;  // untouched slider -> keep "auto" (recomputed each run)
      const y = `dcf:\n  years: ${sim.years}\n  base_revenue: ttm\n  revenue_growth: [${sim.revenue_growth.map(r3).join(", ")}]\n  ebit_margin_start: auto\n  ebit_margin_target: ${r3(sim.ebit_margin_target)}\n  margin_years_to_target: ${sim.margin_years_to_target}\n  tax_rate: ${r3(sim.tax_rate)}\n  d_and_a_pct_revenue: ${same(sim.d_and_a_pct_revenue, I.d_and_a_pct_revenue) ? "auto" : r3(sim.d_and_a_pct_revenue)}\n  capex_pct_revenue: ${same(sim.capex_pct_revenue, I.capex_pct_revenue) ? "auto" : r3(sim.capex_pct_revenue)}\n  nwc_pct_incremental_revenue: ${r3(sim.nwc_pct_incremental_revenue)}\n  terminal_growth: ${r3(sim.terminal_growth)}\n  terminal_roic: ${sim.terminal_roic || "null"}\n  mid_year: ${sim.mid_year}\n  include_equity_investments: ${(I.investments || 0) > 0}\n\nwacc:\n  method: capm\n  risk_free: ${same(W.risk_free, I.wacc_detail.risk_free) ? "auto" : r3(W.risk_free)}\n  beta: ${same(W.beta, I.wacc_detail.beta) ? "auto" : r3(W.beta)}\n  equity_risk_premium: ${r3(W.equity_risk_premium)}\n  pre_tax_cost_of_debt: ${r3(W.pre_tax_cost_of_debt)}\n  debt_weight: auto\n`;
      try { await navigator.clipboard.writeText(y); T.$("#yaml").textContent = "Copié ✓"; }
      catch (e) { window.prompt("Copie ce YAML :", y); }
      setTimeout(() => { T.$("#yaml").textContent = "Copier en YAML"; }, 1800);
    });

    // ---------------- heatmaps
    function heat(id, g, fr, fc) {
      const vals = g.values.flat().filter(T.isNum);
      const span = Math.max(...vals.map((v) => Math.abs(v / price - 1)), 0.01);
      const color = (v) => {
        if (!T.isNum(v)) return "";
        const u = v / price - 1, a = Math.min(1, Math.abs(u) / span) * 0.55 + 0.05;
        return `background:${u >= 0 ? `rgba(57,135,229,${a})` : `rgba(230,103,103,${a})`}`;
      };
      // base case = 0 offset: row 3 of 7 (WACC) / 3 of 5 (margin), column 2 of 5 (g / ×1.0)
      const baseRow = 3, baseCol = 2;
      T.$("#" + id).innerHTML = `<div class="note" style="margin:0 0 6px">Lignes : ${g.row_label.toLowerCase()} · colonnes : ${g.col_label.toLowerCase()}</div><table class="t heat"><thead><tr><th></th>${g.cols.map((c) => `<th class="n">${fc(c)}</th>`).join("")}</tr></thead><tbody>
        ${g.rows.map((rw, i) => `<tr><td class="num">${fr(rw)}</td>${g.values[i].map((v, j) => `<td class="n ${i === baseRow && j === baseCol ? "base" : ""}" style="${color(v)}" title="${T.isNum(v) ? F.pct(v / price - 1, 1, true) + " vs cours" : ""}">${T.isNum(v) ? F.n(v, 0) : "-"}</td>`).join("")}</tr>`).join("")}
        </tbody></table><div class="legend" style="margin-top:8px"><span><i style="background:rgba(57,135,229,.6)"></i>au-dessus du cours</span><span><i style="background:rgba(230,103,103,.6)"></i>en dessous du cours</span><span>case encadrée = scénario base</span></div>`;
    }
    heat("h1", val.sensitivity.wacc_x_g, (x) => F.pct(x, 1), (x) => F.pct(x, 1));
    heat("h2", val.sensitivity.margin_x_growth, (x) => F.pct(x, 0), (x) => "×" + F.n(x, 1));

    // ---------------- comps
    const cm = val.comps.multiples, imp = val.comps.implied;
    T.$("#comps").innerHTML = `<table class="t"><thead><tr><th>Multiple</th><th class="n">${tk}</th><th class="n">Médiane pairs</th><th class="n">Min - max</th><th class="n">Prime / décote</th><th class="n">Valeur implicite / action</th></tr></thead><tbody>
      ${Object.entries(cm).map(([k, m]) => `<tr><td>${T.esc(m.label)}</td><td class="n">${F.x(m.target)}</td><td class="n">${F.x(m.median)}</td>
        <td class="n muted">${F.x(m.low)} - ${F.x(m.high)}</td><td class="n ${T.cls(m.premium_vs_median)}">${F.pct(m.premium_vs_median, 0, true)}</td>
        <td class="n"><b>${F.px(imp[k])}</b> <span class="${T.cls(imp[k] / price - 1)}">${F.pct(imp[k] / price - 1, 0, true)}</span></td></tr>`).join("")}
      </tbody></table>${val.comps.growth_regression ? `<p class="note">Régression VE/CA ~ croissance des pairs (n = ${val.comps.growth_regression.n}) : VE/CA « attendu » pour la croissance de ${tk} = <b>${F.x(val.comps.growth_regression.implied_ev_sales_for_target)}</b> vs ${F.x((cm.ev_sales || {}).target)} réel. ${T.esc(val.comps.growth_regression.warning)}.</p>` : ""}`;

    // ---------------- history
    const h = (val.history || []).filter((x) => T.isNum(x.value_base));
    if (h.length < 2) T.$("#hist").innerHTML = `<div class="empty" style="margin-top:40px">L'historique se construit à chaque exécution du pipeline (${h.length} point${h.length > 1 ? "s" : ""} pour l'instant).</div>`;
    else T.ec(T.$("#hist"), {
      legend: { data: ["Cours", "DCF base", "DCF pondéré"] },
      tooltip: { trigger: "axis", valueFormatter: (v) => F.px(v) },
      xAxis: T.axis({ type: "category", data: h.map((x) => x.date), splitLine: { show: false } }),
      yAxis: T.axis({ type: "value", scale: true }),
      series: [
        { name: "Cours", type: "line", data: h.map((x) => x.price), showSymbol: false, lineStyle: { width: 2, color: C().text }, itemStyle: { color: C().text } },
        { name: "DCF base", type: "line", data: h.map((x) => x.value_base), showSymbol: false, lineStyle: { width: 2, color: C().series[0] }, itemStyle: { color: C().series[0] } },
        { name: "DCF pondéré", type: "line", data: h.map((x) => x.value_weighted), showSymbol: false, lineStyle: { width: 2, color: C().series[2] }, itemStyle: { color: C().series[2] } },
      ],
    });

    // ---------------- sources
    const S = D.sources || {};
    const rowsSrc = [
      ["CA de départ", F.usd(I.base_revenue), S.base_revenue], ["Marge EBIT de départ", F.pct(I.ebit_margin_start, 1), S.ebit_margin_start],
      ["Marge EBIT cible", F.pct(I.ebit_margin_target, 1), "hypothèse"], ["D&A / CA", F.pct(I.d_and_a_pct_revenue, 2), S.d_and_a_pct_revenue],
      ["Capex / CA", F.pct(I.capex_pct_revenue, 2), S.capex_pct_revenue], ["BFR / CA additionnel", F.pct(I.nwc_pct_incremental_revenue, 1), "hypothèse"],
      ["Taux d'impôt", F.pct(I.tax_rate, 1), "hypothèse"], ["Croissance terminale", F.pct(I.terminal_growth, 2), "hypothèse"],
      ["Taux sans risque", F.pct(I.wacc_detail.risk_free, 2), S.risk_free], ["Bêta", F.n(I.wacc_detail.beta, 2), S.beta],
      ["Prime de risque actions", F.pct(I.wacc_detail.equity_risk_premium, 2), "hypothèse"],
      ["Poids de la dette", F.pct(I.wacc_detail.debt_weight, 2), S.debt_weight], ["Trésorerie + placements", F.usd(I.cash), "données (dernier bilan)"],
      ["Participations en actions", F.usd(I.investments), S.investments],
      ["Dette financière", F.usd(I.debt), "données (dernier bilan)"], ["Nombre d'actions", F.n(I.shares / 1e9, 3) + " Md", "SEC (page de garde du dernier dépôt)"],
    ];
    T.$("#srcs").innerHTML = `<table class="t"><thead><tr><th>Paramètre</th><th class="n">Valeur</th><th>Source</th></tr></thead><tbody>
      ${rowsSrc.map(([a, b, c]) => `<tr><td>${a}</td><td class="n">${b}</td><td><span class="src-tag ${/hypoth/.test(c || "") ? "" : "auto"}">${T.esc(c || "-")}</span></td></tr>`).join("")}</tbody></table>
      <p class="note">${T.esc(D.result.terminal_method || "")} · convention mi-année : ${I.mid_year ? "oui" : "non"}.</p>`;
  }

  // ================================================================== Secteur
  async function secteur(el, tk) {
    const [pe, px] = await Promise.all([T.get(`${tk}/peers.json`), T.get(`${tk}/prices.json`)]);
    const all = [pe.target, ...pe.peers];
    const order = all.map((x) => x.ticker);
    order.forEach((t) => T.colorOf(t, order));
    const cols = [
      ["ticker", "Valeur", (x) => `<b>${x.ticker}</b> <span class="muted">${T.esc(x.name)}</span>`],
      ["market_cap", "Capi.", (x) => F.usd(x.market_cap)], ["revenue_ttm", "CA TTM", (x) => F.usd(x.revenue_ttm)],
      ["revenue_growth_ttm", "Croiss.", (x) => `<span class="${T.cls(x.revenue_growth_ttm)}">${F.pct(x.revenue_growth_ttm, 0, true)}</span>`],
      ["gross_margin_ttm", "Marge brute", (x) => F.pct(x.gross_margin_ttm, 0)], ["operating_margin_ttm", "Marge opé.", (x) => F.pct(x.operating_margin_ttm, 0)],
      ["net_margin_ttm", "Marge nette", (x) => F.pct(x.net_margin_ttm, 0)], ["rnd_pct_ttm", "R&D/CA", (x) => F.pct(x.rnd_pct_ttm, 0)],
      ["ev_sales", "VE/CA", (x) => F.x(x.ev_sales)], ["ev_ebitda", "VE/EBITDA", (x) => F.x(x.ev_ebitda)],
      ["pe", "P/E", (x) => F.x(x.pe)], ["p_fcf", "Capi/FCF", (x) => F.x(x.p_fcf)],
    ];
    const st = { sort: "market_cap", dir: -1 };
    el.innerHTML = `<div class="panel" style="margin-bottom:14px"><h3>Pairs <span class="hint">TTM, données SEC · clic sur un en-tête pour trier</span></h3><div class="tbl-wrap" id="pt"></div></div>
      <div class="grid g2">
        <div class="panel"><h3>Valorisation vs croissance <span class="hint">VE/CA (y) · croissance du CA TTM (x)</span></h3><div class="chart" id="sc1"></div></div>
        <div class="panel"><h3>Marge opérationnelle TTM</h3><div class="chart" id="sc2"></div></div>
        <div class="panel"><h3>CA trimestriel <span class="hint">base 100 au premier trimestre commun</span></h3><div class="chart" id="sc3"></div></div>
        <div class="panel"><h3>Performance boursière <span class="hint">base 100 il y a un an</span></h3><div class="chart" id="sc4"></div></div>
      </div>`;
    function drawTable() {
      const rows = all.slice().sort((a, b) => ((a[st.sort] ?? -Infinity) > (b[st.sort] ?? -Infinity) ? 1 : -1) * st.dir);
      T.$("#pt").innerHTML = `<table class="t"><thead><tr>${cols.map(([k, l]) => `<th class="sortable ${k === "ticker" ? "" : "n"}" data-k="${k}">${l}${st.sort === k ? (st.dir < 0 ? " ↓" : " ↑") : ""}</th>`).join("")}</tr></thead><tbody>
        ${rows.map((x) => `<tr class="${x.ticker === tk ? "hl" : ""}">${cols.map(([k, , fn]) => `<td class="${k === "ticker" ? "" : "n"}">${fn(x)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
      T.$$("#pt th").forEach((th) => th.addEventListener("click", () => { st.dir = st.sort === th.dataset.k ? -st.dir : -1; st.sort = th.dataset.k; drawTable(); }));
    }
    drawTable();
    // scatter: highlight target, others neutral, every point labelled (identity not by colour alone)
    T.ec(T.$("#sc1"), {
      grid: { left: 8, right: 30, top: 34, bottom: 24, containLabel: true },
      tooltip: { formatter: (p) => `<b>${p.value[2]}</b><br>Croissance ${F.pct(p.value[0] / 100, 1)}<br>VE/CA ${F.x(p.value[1])}` },
      xAxis: T.axis({ type: "value", name: "croissance %", nameLocation: "middle", nameGap: 22, nameTextStyle: { color: C().muted } }),
      yAxis: T.axis({ type: "value", name: "VE/CA", nameTextStyle: { color: C().muted } }),
      series: [{ type: "scatter", symbolSize: 13,
        data: all.filter((x) => T.isNum(x.ev_sales) && T.isNum(x.revenue_growth_ttm)).map((x) => ({ value: [x.revenue_growth_ttm * 100, x.ev_sales, x.ticker],
          itemStyle: { color: x.ticker === tk ? C().series[0] : C().neutral, borderColor: C().panel, borderWidth: 2 } })),
        label: { show: true, formatter: (p) => p.data.value[2], position: "right", color: C().text2, fontSize: 11 } }],
    });
    const om = all.filter((x) => T.isNum(x.operating_margin_ttm)).sort((a, b) => a.operating_margin_ttm - b.operating_margin_ttm);
    T.ec(T.$("#sc2"), {
      grid: { left: 8, right: 40, top: 10, bottom: 8, containLabel: true },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => F.n(v, 1) + " %" },
      xAxis: T.axis({ type: "value", axisLabel: { color: C().muted, formatter: (v) => v + " %" } }),
      yAxis: T.axis({ type: "category", data: om.map((x) => x.ticker), splitLine: { show: false } }),
      series: [{ type: "bar", data: om.map((x) => ({ value: +(x.operating_margin_ttm * 100).toFixed(1),
        itemStyle: { color: x.ticker === tk ? C().series[0] : C().neutral, borderRadius: x.operating_margin_ttm >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4] } })),
        barMaxWidth: 16, label: { show: true, position: "right", color: C().text2, fontSize: 10.5, fontFamily: "JetBrains Mono", formatter: (p) => F.n(p.value, 0) + " %" } }],
    });
    // revenue indexed, by calendar quarter end
    const series3 = all.map((x) => {
      const q = (x.quarterly || []).filter((r) => T.isNum(r.revenue));
      if (!q.length) return null;
      const b = q[0].revenue;
      return { name: x.ticker, type: "line", showSymbol: false, data: q.map((r) => [r.end, +(r.revenue / b * 100).toFixed(1)]),
        lineStyle: { width: x.ticker === tk ? 2.5 : 1.5, color: T.colorOf(x.ticker) }, itemStyle: { color: T.colorOf(x.ticker) } };
    }).filter(Boolean);
    T.ec(T.$("#sc3"), {
      legend: { data: series3.map((s) => s.name) }, grid: { left: 8, right: 14, top: 30, bottom: 8, containLabel: true },
      tooltip: { trigger: "axis", valueFormatter: (v) => F.n(v, 0) },
      xAxis: T.axis({ type: "time", splitLine: { show: false } }), yAxis: T.axis({ type: "log", logBase: 2, axisLabel: { color: C().muted, formatter: (v) => F.n(v, 0) } }),
      series: series3,
    });
    // 1-year relative performance
    const yearAgo = (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d.toISOString().slice(0, 10); })();
    const closes = { [tk]: px.bars.map((b) => [b.t, b.ac]) };
    pe.peers.forEach((p) => (closes[p.ticker] = p.closes || []));
    const series4 = Object.entries(closes).map(([t, arr]) => {
      const a = arr.filter((x) => x[0] >= yearAgo);
      if (!a.length) return null;
      const b = a[0][1];
      return { name: t, type: "line", showSymbol: false, data: a.map(([d, v]) => [d, +(v / b * 100).toFixed(2)]),
        lineStyle: { width: t === tk ? 2.5 : 1.5, color: T.colorOf(t) }, itemStyle: { color: T.colorOf(t) } };
    }).filter(Boolean);
    T.ec(T.$("#sc4"), {
      legend: { data: series4.map((s) => s.name) }, grid: { left: 8, right: 14, top: 30, bottom: 8, containLabel: true },
      tooltip: { trigger: "axis", valueFormatter: (v) => F.n(v, 1) },
      xAxis: T.axis({ type: "time", splitLine: { show: false } }), yAxis: T.axis({ type: "value", scale: true }),
      series: series4,
    });
  }

  // ================================================================== Performance
  async function performance(el, tk, co, val) {
    const px = await T.get(`${tk}/prices.json`);
    const st = { mode: "candles", range: "1A" };
    const ser = { [tk]: px.bars.map((b) => [b.t, b.ac]), ...px.benchmarks };
    const stats = (arr) => {
      if (!arr || arr.length < 2) return {};
      const last = arr[arr.length - 1];
      const ld = new Date(last[0] + "T00:00:00");
      const since = (fn) => { const d = new Date(ld); fn(d); const s = d.toISOString().slice(0, 10); const b = arr.filter((x) => x[0] <= s).pop(); return b ? last[1] / b[1] - 1 : null; };
      const r = arr.slice(-253);
      const lr = r.slice(1).map((x, i) => Math.log(x[1] / r[i][1]));
      const m = lr.reduce((a, b) => a + b, 0) / lr.length;
      const vol = Math.sqrt(lr.reduce((a, b) => a + (b - m) ** 2, 0) / (lr.length - 1)) * Math.sqrt(252);
      let peak = -Infinity, dd = 0; arr.slice(-756).forEach((x) => { peak = Math.max(peak, x[1]); dd = Math.min(dd, x[1] / peak - 1); });
      return { "1S": since((d) => d.setDate(d.getDate() - 7)), "1M": since((d) => d.setMonth(d.getMonth() - 1)), "3M": since((d) => d.setMonth(d.getMonth() - 3)),
        "YTD": since((d) => d.setMonth(0, 1)), "1A": since((d) => d.setFullYear(d.getFullYear() - 1)), "3A": since((d) => d.setFullYear(d.getFullYear() - 3)),
        "5A": since((d) => d.setFullYear(d.getFullYear() - 5)), vol, dd };
    };
    const S = Object.fromEntries(Object.entries(ser).map(([k, a]) => [k, stats(a)]));
    const periods = ["1S", "1M", "3M", "YTD", "1A", "3A", "5A"];
    el.innerHTML = `<div class="panel" style="margin-bottom:14px"><h3><span class="row">${seg("pmode", [["candles", "Chandeliers"], ["area", "Aire"], ["cmp", "Comparaison %"]], "candles")}</span>
        <span class="row">${seg("prng", [["1M", "1M"], ["3M", "3M"], ["6M", "6M"], ["YTD", "YTD"], ["1A", "1A"], ["3A", "3A"], ["5A", "5A"]], "1A")}</span></h3>
        <div class="legend" id="plg" style="margin-bottom:6px"></div><div class="chart lg" id="pch"></div>
        <p class="note">Source des cours : ${T.esc(px.source)}. Cours de clôture journaliers, ajustés des dividendes pour les rendements et la comparaison.</p></div>
      <div class="grid g2">
        <div class="panel span2"><h3>Rendements</h3><div class="tbl-wrap"><table class="t"><thead><tr><th></th>${periods.map((p) => `<th class="n">${p}</th>`).join("")}<th class="n">Vol. 1 an</th><th class="n">Pire baisse 3 ans</th></tr></thead><tbody>
          ${Object.keys(ser).map((k) => `<tr class="${k === tk ? "hl" : ""}"><td><b>${k}</b> <span class="muted">${T.esc((px.benchmark_names || {})[k] || "")}</span></td>
            ${periods.map((p) => `<td class="n ${T.cls(S[k][p])}">${F.pct(S[k][p], 1, true)}</td>`).join("")}<td class="n">${F.pct(S[k].vol, 0)}</td><td class="n down">${F.pct(S[k].dd, 0)}</td></tr>`).join("")}
          </tbody></table></div></div>
        <div class="panel"><h3>Risque</h3><div class="kv">
          <div>Bêta brut (2 ans hebdo vs SPY)</div><div>${F.n((co.beta || {}).raw, 2)}</div>
          <div>Bêta ajusté (Blume)</div><div>${F.n((co.beta || {}).adjusted, 2)}</div>
          <div>R² de la régression</div><div>${F.n((co.beta || {}).r2, 2)}</div>
          <div>Plus haut / plus bas 52 sem.</div><div>${F.px(co.perf.high_52w)} / ${F.px(co.perf.low_52w)}</div>
          <div>Distance au plus haut</div><div class="${T.cls(co.price / co.perf.high_52w - 1)}">${F.pct(co.price / co.perf.high_52w - 1, 1, true)}</div>
          <div>Volume moyen 3 mois</div><div>${F.n(co.perf.avg_volume_3m / 1e6, 1)} M</div></div>
          <p class="note">Le bêta mesure la sensibilité au marché, pas le risque total : un bêta faible avec un R² faible signifie surtout que le marché explique peu les variations du titre.</p></div>
      </div>`;
    let chart;
    const draw = () => {
      if (chart) { chart.remove(); }
      T.$("#pch").innerHTML = "";
      chart = priceChart(T.$("#pch"), px.bars, { mode: st.mode, range: st.range, benchmarks: px.benchmarks, tk });
      T.$("#plg").innerHTML = st.mode === "cmp" ? [[tk, T.colorOf(tk)], ["SPY", C().neutral], ["SOXX", C().series[5]]].filter(([k]) => ser[k])
        .map(([k, c]) => `<span><i style="background:${c}"></i>${k}</span>`).join("") + '<span class="muted">variation en % depuis le début de la fenêtre</span>' : "";
    };
    onSeg("pmode", (k) => { st.mode = k; draw(); });
    onSeg("prng", (k) => { st.range = k; setRange(chart, px.bars, k); });
    draw();
  }

  // ================================================================== Dépôts
  async function depots(el, tk, co) {
    const fl = co.filings || [];
    el.innerHTML = `<div class="panel"><h3>Dépôts récents à la SEC <span class="hint">10-K, 10-Q, 8-K de résultats et événements</span></h3>
      <div class="tbl-wrap"><table class="t"><thead><tr><th>Déposé le</th><th>Formulaire</th><th>Période</th><th>Rubriques 8-K</th><th></th></tr></thead><tbody>
      ${fl.map((f) => `<tr><td class="num">${F.date(f.filed)}</td><td><b>${T.esc(f.form)}</b>${f.is_results ? ' <span class="src-tag auto">résultats</span>' : ""}</td>
        <td class="num">${F.date(f.report_date)}</td><td class="muted">${T.esc(f.items || "")}</td>
        <td><a href="${T.esc(f.url)}" target="_blank" rel="noopener">Ouvrir ↗</a></td></tr>`).join("") || '<tr><td colspan="5" class="muted">Aucun dépôt.</td></tr>'}
      </tbody></table></div>
      <p class="note">Rubrique 8-K 2.02 = publication de résultats ; 7.01 = Regulation FD ; 8.01 = autre événement. CIK ${co.profile.cik} · exercice clos le ${T.esc((co.profile.fiscal_year_end || "").replace(/(\d\d)(\d\d)/, "$2/$1"))}.</p></div>`;
  }
})();
