/* Portfolio analytics: risk / return statistics, allocation, contribution and trading record.
   Pure functions (T.PA.stats, T.PA.ledger) are tested in node; T.PA.render draws the panels. */
(function () {
  "use strict";
  const G = typeof window !== "undefined" ? window : globalThis;
  const T = G.T || (G.T = {});
  const PA = (T.PA = {});
  const RF = 0.04;          // same risk-free convention as the Sharpe achievement
  const DAYS = 252;
  PA.MIN_OBS = 20;          // fewer daily returns than this: statistics are shown as indicative

  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const sd = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

  /** values: [{date, value, spy_close}] sorted by date. */
  PA.stats = (values, rf = RF) => {
    const v = values.filter((x) => +x.value > 0);
    const out = { n: Math.max(0, v.length - 1), start: v[0] && v[0].date, end: v.length ? v[v.length - 1].date : null };
    if (v.length < 2) return out;
    const r = [], rb = [];
    for (let i = 1; i < v.length; i++) {
      const ri = +v[i].value / +v[i - 1].value - 1;
      r.push(ri);
      const b0 = +v[i - 1].spy_close, b1 = +v[i].spy_close;
      rb.push(b0 > 0 && b1 > 0 ? b1 / b0 - 1 : null);
    }
    out.total = +v[v.length - 1].value / +v[0].value - 1;
    const sb = v.find((x) => +x.spy_close > 0), eb = [...v].reverse().find((x) => +x.spy_close > 0);
    out.bench = sb && eb && sb !== eb ? +eb.spy_close / +sb.spy_close - 1 : null;
    out.excess = out.bench != null ? out.total - out.bench : null;
    const s = sd(r);
    out.vol = s != null ? s * Math.sqrt(DAYS) : null;
    const rfd = rf / DAYS;
    out.sharpe = s ? ((mean(r) - rfd) / s) * Math.sqrt(DAYS) : null;
    const down = r.map((x) => Math.min(0, x - rfd));
    const dd = Math.sqrt(down.reduce((a, x) => a + x * x, 0) / r.length);
    out.sortino = dd > 0 ? ((mean(r) - rfd) / dd) * Math.sqrt(DAYS) : null;
    // drawdown
    let peak = -Infinity, mdd = 0, cur = 0; const ddSeries = [];
    v.forEach((x) => { peak = Math.max(peak, +x.value); cur = +x.value / peak - 1; mdd = Math.min(mdd, cur); ddSeries.push(cur); });
    out.maxDD = mdd; out.curDD = cur; out.ddSeries = ddSeries;
    // beta / correlation vs SPY over the days where both exist
    const pairs = r.map((x, i) => [x, rb[i]]).filter((p) => p[1] != null);
    if (pairs.length >= 3) {
      const ma = mean(pairs.map((p) => p[0])), mb = mean(pairs.map((p) => p[1]));
      let cov = 0, vb = 0, va = 0;
      pairs.forEach(([a, b]) => { cov += (a - ma) * (b - mb); vb += (b - mb) ** 2; va += (a - ma) ** 2; });
      out.beta = vb > 0 ? cov / vb : null;
      out.corr = va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : null;
      const te = sd(pairs.map(([a, b]) => a - b));
      out.trackingError = te != null ? te * Math.sqrt(DAYS) : null;
    }
    out.best = Math.max(...r); out.worst = Math.min(...r);
    out.upDays = r.filter((x) => x > 0).length / r.length;
    out.reliable = out.n >= PA.MIN_OBS;
    return out;
  };

  /** Average-cost ledger: realised P&L per ticker and closed-trade record. trades sorted by id. */
  PA.ledger = (trades) => {
    const pos = {}, realised = {}, closes = [];
    let bought = 0, sold = 0;
    trades.slice().sort((a, b) => a.id - b.id).forEach((t) => {
      const p = pos[t.ticker] || (pos[t.ticker] = { qty: 0, cost: 0 });
      const q = +t.qty, px = +t.price;
      if (t.side === "buy") { p.cost += q * px; p.qty += q; bought += q * px; }
      else {
        const avg = p.qty ? p.cost / p.qty : 0;
        const pnl = (px - avg) * q;
        realised[t.ticker] = (realised[t.ticker] || 0) + pnl;
        closes.push({ ticker: t.ticker, pnl, ret: avg ? px / avg - 1 : null, date: t.price_date });
        p.qty -= q; p.cost -= avg * q; sold += q * px;
      }
    });
    const wins = closes.filter((c) => c.pnl > 0), losses = closes.filter((c) => c.pnl < 0);
    return {
      realised, closes, bought, sold,
      winRate: closes.length ? wins.length / closes.length : null,
      avgWin: wins.length ? mean(wins.map((c) => c.ret)) : null,
      avgLoss: losses.length ? mean(losses.map((c) => c.ret)) : null,
    };
  };

  /** Concentration: weights (fractions of the invested book) -> {hhi, effective N, top3}. */
  PA.concentration = (weights) => {
    const w = weights.filter((x) => x > 0), tot = w.reduce((a, x) => a + x, 0);
    if (!tot) return { hhi: null, nEff: null, top3: null };
    const n = w.map((x) => x / tot).sort((a, b) => b - a);
    const hhi = n.reduce((a, x) => a + x * x, 0);
    return { hhi, nEff: 1 / hhi, top3: n.slice(0, 3).reduce((a, x) => a + x, 0) };
  };

  const FAMILY = { tech: "Technologie", conso: "Consommation", sante: "Santé et biotech", finance: "Finance",
    energie: "Énergie", industrie: "Industrie", autre: "Autres" };
  PA.familyLabel = (f) => FAMILY[f] || FAMILY.autre;

  /** ctx: {values, trades, rows, orows, px, total, cash, universe} -> HTML + draws charts */
  PA.render = (el, ctx) => {
    const F = T.fmt, C = () => T.C;
    const st = PA.stats(ctx.values);
    const led = PA.ledger(ctx.trades);
    const uni = Object.fromEntries(((ctx.universe || {}).tickers || []).map((t) => [t.ticker, t]));
    const book = ctx.rows.filter((r) => r.val > 0);
    const optVal = ctx.orows.reduce((a, r) => a + (r.val || 0), 0);
    const conc = PA.concentration(book.map((r) => r.val));
    // DCF upside of the covered holdings, weighted by position value
    const cov = book.filter((r) => uni[r.tk] && T.isNum(uni[r.tk].upside_weighted) && uni[r.tk].value_weighted > 0);
    const covVal = cov.reduce((a, r) => a + r.val, 0);
    const upside = covVal ? cov.reduce((a, r) => a + r.val * uni[r.tk].upside_weighted, 0) / covVal : null;
    // sector allocation (cash and options as their own lines)
    const alloc = {};
    book.forEach((r) => { const f = PA.familyLabel((ctx.px[r.tk] || {}).family); alloc[f] = (alloc[f] || 0) + r.val; });
    if (optVal > 0) alloc["Options (valeur de marché)"] = optVal;
    if (ctx.cash > 0) alloc["Liquidités"] = ctx.cash;
    const allocRows = Object.entries(alloc).sort((a, b) => b[1] - a[1]);
    // contribution: unrealised + realised, per ticker
    const contrib = {};
    ctx.rows.forEach((r) => { contrib[r.tk] = (contrib[r.tk] || 0) + (r.pnl || 0); });
    Object.entries(led.realised).forEach(([tk, p]) => { contrib[tk] = (contrib[tk] || 0) + p; });
    ctx.orows.forEach((r) => { const k = `${r.ticker} options`; contrib[k] = (contrib[k] || 0) + (r.pnl || 0); });
    const contribRows = Object.entries(contrib).filter(([, x]) => Math.abs(x) > 0.5).sort((a, b) => b[1] - a[1]);
    const ind = st.reliable ? "" : ' <span class="hint">indicatif</span>';
    const k = (l, v, s, cls = "") => `<div class="kpi"><div class="l">${l}</div><div class="v ${cls}">${v}</div><div class="s">${s}</div></div>`;
    el.innerHTML = `<div class="panel"><h3>Analyse du portefeuille <span class="hint">${st.n} séance(s) de données${st.start ? ` depuis le ${F.date(st.start)}` : ""} · taux sans risque ${F.pct(RF, 0)}</span></h3>
      ${st.n < PA.MIN_OBS ? `<p class="note">Moins de ${PA.MIN_OBS} séances : volatilité, Sharpe et bêta sont très bruités. Une valeur est ajoutée à chaque mise à jour du soir.</p>` : ""}
      <div class="kpis kpis-4">
        ${k("Performance", F.pct(st.total, 2, true), st.bench != null ? `S&P 500 ${F.pct(st.bench, 2, true)}` : "S&P 500 : n/d", T.cls(st.total))}
        ${k("Surperformance", st.excess != null ? F.pct(st.excess, 2, true) : "-", "vs S&P 500 sur la période", T.cls(st.excess))}
        ${k("Volatilité annualisée" + ind, F.pct(st.vol, 1), st.trackingError != null ? `écart de suivi ${F.pct(st.trackingError, 1)}` : "écart-type des rendements journaliers")}
        ${k("Sharpe" + ind, T.isNum(st.sharpe) ? F.n(st.sharpe, 2) : "-", T.isNum(st.sortino) ? `Sortino ${F.n(st.sortino, 2)}` : "annualisé")}
        ${k("Bêta vs S&P 500" + ind, T.isNum(st.beta) ? F.n(st.beta, 2) : "-", T.isNum(st.corr) ? `corrélation ${F.n(st.corr, 2)}` : "régression des rendements journaliers")}
        ${k("Perte max. (drawdown)", F.pct(st.maxDD, 1), T.isNum(st.curDD) ? `actuel ${F.pct(st.curDD, 1)}` : "", T.cls(st.maxDD))}
        ${k("Potentiel DCF pondéré", upside != null ? F.pct(upside, 1, true) : "-", covVal ? `${F.pct(covVal / (book.reduce((a, r) => a + r.val, 0) || 1), 0)} du portefeuille couvert` : "aucune valeur couverte", T.cls(upside))}
        ${k("Lignes effectives", conc.nEff ? F.n(conc.nEff, 1) : "-", conc.top3 != null ? `concentration · top 3 : ${F.pct(conc.top3, 0)} des actions` : "1 / somme des poids²")}
      </div></div>
      <div class="grid g2" style="margin-top:14px">
        <div class="panel"><h3>Performance vs S&P 500 <span class="hint">base 100</span></h3><div class="chart" id="pa_perf" style="height:220px"></div>
          <div class="chart" id="pa_dd" style="height:90px"></div></div>
        <div class="panel"><h3>Répartition <span class="hint">% de la valeur totale</span></h3>
          ${allocRows.map(([l, x]) => `<div class="alloc-row"><span>${T.esc(l)}</span><span class="bar"><span style="width:${(x / ctx.total) * 100}%"></span></span><span class="num">${F.pct(x / ctx.total, 1)}</span></div>`).join("") || '<div class="muted">-</div>'}
          <h3 style="margin-top:16px">Contribution au résultat <span class="hint">latent + réalisé, $</span></h3>
          ${contribRows.length ? (() => { const m = Math.max(...contribRows.map(([, x]) => Math.abs(x))); return contribRows.map(([l, x]) => `<div class="alloc-row contrib"><span>${T.esc(l)}</span><span class="bar mid"><span style="${x >= 0 ? "left:50%" : `left:${50 - (Math.abs(x) / m) * 50}%`};width:${(Math.abs(x) / m) * 50}%;background:${x >= 0 ? C().up : C().down}"></span></span><span class="num ${T.cls(x)}">${F.n(x, 0)}</span></div>`).join(""); })() : '<div class="muted">Pas encore de résultat.</div>'}
        </div>
      </div>
      <div class="panel" style="margin-top:14px"><h3>Historique de trading</h3>
        <div class="kpis kpis-5">
          ${k("Transactions", F.n(ctx.trades.length, 0), `${F.n(led.bought, 0)} $ achetés · ${F.n(led.sold, 0)} $ vendus`)}
          ${k("Rotation", ctx.total ? F.pct(Math.min(led.bought, led.sold) / ctx.total, 0) : "-", "min(achats, ventes) / valeur")}
          ${k("Ventes gagnantes", led.winRate != null ? F.pct(led.winRate, 0) : "-", `${led.closes.length} vente(s)`)}
          ${k("Gain moyen / perte moyenne", led.avgWin != null || led.avgLoss != null ? `${led.avgWin != null ? F.pct(led.avgWin, 1, true) : "-"} / ${led.avgLoss != null ? F.pct(led.avgLoss, 1, true) : "-"}` : "-", "par vente, vs prix moyen")}
          ${k("Meilleure / pire séance", T.isNum(st.best) ? `${F.pct(st.best, 1, true)} / ${F.pct(st.worst, 1, true)}` : "-", T.isNum(st.upDays) ? `${F.pct(st.upDays, 0)} de séances en hausse` : "")}
        </div></div>`;
    const v = ctx.values.filter((x) => +x.value > 0);
    if (v.length >= 2) {
      const b0 = (v.find((x) => +x.spy_close > 0) || {}).spy_close;
      T.ec(T.$("#pa_perf"), {
        tooltip: { trigger: "axis", valueFormatter: (x) => F.n(x, 1) },
        legend: { data: ["Portefeuille", "S&P 500"], top: 0, textStyle: { color: C().text2 } },
        grid: { top: 28 },
        xAxis: T.axis({ type: "category", data: v.map((x) => x.date), splitLine: { show: false } }),
        yAxis: T.axis({ type: "value", scale: true }),
        series: [
          { name: "Portefeuille", type: "line", showSymbol: false, data: v.map((x) => +(100 * +x.value / +v[0].value).toFixed(2)), lineStyle: { width: 2, color: C().series[0] }, itemStyle: { color: C().series[0] } },
          { name: "S&P 500", type: "line", showSymbol: false, data: v.map((x) => (b0 && +x.spy_close > 0 ? +(100 * +x.spy_close / +b0).toFixed(2) : null)), lineStyle: { width: 1.5, color: C().neutral, type: "dashed" }, itemStyle: { color: C().neutral } }],
      });
      T.ec(T.$("#pa_dd"), {
        tooltip: { trigger: "axis", valueFormatter: (x) => F.pct(x, 1) },
        grid: { top: 6, bottom: 18 }, legend: { show: false },
        xAxis: T.axis({ type: "category", data: v.map((x) => x.date), axisLabel: { show: false }, splitLine: { show: false } }),
        yAxis: T.axis({ type: "value", max: 0, splitNumber: 2, axisLabel: { color: C().muted, fontSize: 10, formatter: (x) => F.pct(x, Math.abs(st.maxDD) < 0.05 ? 1 : 0) } }),
        series: [{ name: "Drawdown", type: "line", showSymbol: false, data: st.ddSeries, lineStyle: { width: 1, color: C().down }, areaStyle: { color: "rgba(242,54,69,.15)" } }],
      });
    } else {
      T.$("#pa_perf").innerHTML = '<div class="empty" style="margin-top:40px">La courbe se construit à chaque mise à jour du soir.</div>';
      T.$("#pa_dd").style.display = "none";
    }
  };
  if (typeof module !== "undefined") module.exports = PA;
})();
