/* rNPV engine, browser twin of pipeline/rnpv.py (same formulas; tests/test_rnpv.py checks parity). */
(function () {
  "use strict";
  const BASE_RATES = {
    all: [0.520, 0.289, 0.578, 0.906], oncology: [0.488, 0.246, 0.477, 0.920], hematology: [0.696, 0.481, 0.768, 0.931],
    metabolic: [0.618, 0.450, 0.636, 0.875], endocrine: [0.433, 0.266, 0.662, 0.863], neurology: [0.477, 0.268, 0.531, 0.867],
    cardiovascular: [0.500, 0.210, 0.552, 0.825], infectious: [0.578, 0.384, 0.640, 0.929], autoimmune: [0.552, 0.314, 0.653, 0.941],
    ophthalmology: [0.716, 0.355, 0.512, 0.911], respiratory: [0.559, 0.219, 0.645, 0.956], psychiatry: [0.527, 0.268, 0.563, 0.912],
    gastroenterology: [0.467, 0.342, 0.571, 0.909], urology: [0.409, 0.150, 0.692, 0.846], allergy: [0.564, 0.283, 0.647, 1.000],
    rare: [0.674, 0.446, 0.604, 0.936], biomarker: [0.524, 0.463, 0.682, 0.960],
  };
  const STAGES = ["phase1", "phase2", "phase3", "filed", "marketed"];
  const DEF = { years_to_peak: 6, post_loe_decline: 0.6, cogs_pct: 0.10, opex_pct: 0.25, share: 1.0, royalty_rate: null, dev_cost: 0, pos: "auto", area: "all" };
  const rates = (area) => BASE_RATES[(area || "all").toLowerCase()] || BASE_RATES.all;
  const posToMarket = (stage, area) => { if (stage === "marketed") return 1; const r = rates(area); let p = 1; for (let k = STAGES.indexOf(stage); k < 4; k++) p *= r[k]; return p; };
  const daysBetween = (a, b) => Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 864e5);
  const parse = (iso) => iso.split("-").map(Number);
  function yearWeights(year, vd) {
    const y0 = vd[0];
    if (year < y0) return [0, 0];
    if (year === y0) { const frac = Math.max(0, daysBetween(vd, [y0 + 1, 1, 1]) / 365.25); return [frac, frac / 2]; }
    return [1, daysBetween(vd, [year, 1, 1]) / 365.25 + 0.5];
  }
  function salesCurve(a, year) {
    const launch = +a.launch_year, peak = +a.peak_sales;
    if (year < launch) return 0;
    const ytp = Math.max(1, Math.trunc(+a.years_to_peak || DEF.years_to_peak));
    let s = peak * Math.min(1, (year - launch + 1) / ytp);
    if (a.loe_year && year >= +a.loe_year) s *= Math.pow(1 - +(a.post_loe_decline ?? DEF.post_loe_decline), year - +a.loe_year + 1);
    return s;
  }
  function resolveAsset(a0) {
    const a = { ...DEF, ...a0 };
    a.stage = String(a.stage || "phase2").toLowerCase();
    const base = posToMarket(a.stage, a.area), auto = a.pos == null || a.pos === "auto";
    a.pos_base = base; a.pos = auto ? base : Math.min(1, Math.max(0, +a.pos)); a.pos_source = auto ? "taux historique" : "hypothèse";
    a.later_p = a.stage !== "marketed" ? posToMarket(STAGES[STAGES.indexOf(a.stage) + 1], a.area) : null;
    a.step_base = a.stage !== "marketed" ? rates(a.area)[STAGES.indexOf(a.stage)] : null;
    a.step_p = a.later_p ? Math.min(1, a.pos / a.later_p) : null;
    return a;
  }
  function assetValue(a, o, pos) {
    const p = pos == null ? a.pos : pos, launch = +a.launch_year;
    const pFile = Math.min(1, p / (a.stage !== "marketed" ? rates(a.area)[3] : 1));
    const devYears = []; for (let y = o.vd[0]; y < launch; y++) if (yearWeights(y, o.vd)[0] > 0) devYears.push(y);
    const devTotal = +(a.dev_cost || 0);
    let rev = 0, dev = 0; const series = [];
    for (let y = o.vd[0]; y <= o.horizon; y++) {
      const [w, t] = yearWeights(y, o.vd); if (w <= 0) continue;
      const df = Math.pow(1 + o.r, -t), sales = salesCurve(a, y) * w;
      let profit = a.royalty_rate ? sales * +a.royalty_rate : sales * +a.share * (1 - +a.cogs_pct - +a.opex_pct);
      profit -= Math.max(0, profit) * o.tax;
      let d = 0;
      if (devTotal && devYears.includes(y)) { const n = devYears.length, i = devYears.indexOf(y); d = -devTotal / n * (n ? Math.pow(pFile, i / n) : 1); }
      rev += profit * p * df; dev += d * df;
      series.push({ year: y, sales, risked_cf: profit * p + d });
    }
    return { rnpv: rev + dev, revenue_pv: rev, dev_pv: dev, series };
  }
  function catalystMath(a, equity, shares, price) {
    const out = { implied_pos: null, implied_step: null, move_up: null, move_down: null, expected_abs_move: null };
    if (!(a.step_p && price && shares)) return out;
    const vSucc = a.value_if_success != null ? a.value_if_success : a.rnpv;
    const base = equity > 0 ? equity : price * shares;
    const up = (vSucc - a.rnpv) / base, down = Math.max(-1, (0 - a.rnpv) / base), p = a.step_p;
    Object.assign(out, { move_up: up, move_down: down, expected_abs_move: p * up + (1 - p) * Math.abs(down) });
    if (a.revenue_pv > 0) {
      const unrisked = a.revenue_pv / a.pos, pMkt = (price * shares - (equity - a.rnpv) - a.dev_pv) / unrisked;
      out.implied_pos = pMkt; out.implied_step = a.later_p ? pMkt / a.later_p : null;
    }
    return out;
  }
  /** cfg = `rnpv:` YAML block; ctx = {net_cash, shares, price, valuation_date: "YYYY-MM-DD"} */
  function value(cfg, ctx) {
    const vd = parse(ctx.valuation_date);
    const o = { r: +(cfg.discount_rate ?? 0.10), tax: +(cfg.tax_rate ?? 0.21), horizon: +(cfg.horizon ?? vd[0] + 20), vd };
    const assets = (cfg.assets || []).map(resolveAsset).map((a) => {
      const v = assetValue(a, o);
      const succ = a.step_p ? assetValue(a, o, a.later_p).rnpv : null;
      return { ...a, rnpv: v.rnpv, revenue_pv: v.revenue_pv, dev_pv: v.dev_pv, value_if_success: succ, value_if_failure: a.step_p ? 0 : null, series: v.series };
    });
    const corp = cfg.corporate || {}, ohCost = +(corp.annual_cost || 0), ohYears = Math.trunc(+(corp.years ?? 10));
    let oh = 0;
    for (let i = 0; i < ohYears; i++) { const [w, t] = yearWeights(vd[0] + i, vd); oh += ohCost * w * (1 - o.tax) * Math.pow(1 + o.r, -t); }
    const other = +(cfg.other_value || 0), pipe = assets.reduce((s, a) => s + a.rnpv, 0);
    const equity = pipe - oh + ctx.net_cash + other, ps = ctx.shares ? equity / ctx.shares : null;
    assets.forEach((a) => { a.per_share = ctx.shares ? a.rnpv / ctx.shares : null; Object.assign(a, catalystMath(a, equity, ctx.shares, ctx.price)); });
    return { discount_rate: o.r, tax_rate: o.tax, horizon: o.horizon, assets, pipeline_value: pipe, overhead_pv: -oh, net_cash: ctx.net_cash,
      other_value: other, equity_value: equity, shares: ctx.shares, value_per_share: ps, upside: ps != null && ctx.price ? ps / ctx.price - 1 : null };
  }
  const api = { value, posToMarket, rates, BASE_RATES, STAGES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.RNPV = api;   // core.js creates window.T later: views read window.RNPV
})();
