/* DCF engine - JavaScript twin of pipeline/valuation.py (dcf, growth_path, value_only,
 * reverse_dcf). Used by the interactive valuation page. tests/test_dcf_parity.py checks
 * that both implementations return the same numbers. Keep them in sync. */
(function (root) {
  "use strict";

  function growthPath(r) {
    const n = r.years, tg = r.terminal_growth;
    const ex = (r.revenue_growth || []).slice(0, n);
    const e = ex.length;
    if (e === 0) return Array(n).fill(tg);
    const last = ex[e - 1];
    const path = ex.slice();
    for (let t = e + 1; t <= n; t++) path.push(last + (tg - last) * (t - e) / (n - e));
    return path;
  }

  function dcf(r) {
    const n = r.years, w = r.wacc, g = r.terminal_growth;
    if (w <= g + 0.0025) throw new Error("WACC doit être supérieur à la croissance terminale");
    const gp = growthPath(r);
    const m0 = r.ebit_margin_start, m1 = r.ebit_margin_target, my = Math.max(1, r.margin_years_to_target);
    const rows = [];
    let revPrev = r.base_revenue, pvSum = 0;
    for (let t = 1; t <= n; t++) {
      const rev = revPrev * (1 + gp[t - 1]);
      const m = m0 + (m1 - m0) * Math.min(t, my) / my;
      const ebit = rev * m;
      const nopat = ebit * (1 - r.tax_rate);
      const da = rev * r.d_and_a_pct_revenue;
      const capex = rev * r.capex_pct_revenue;
      const dnwc = (rev - revPrev) * r.nwc_pct_incremental_revenue;
      const fcff = nopat + da - capex - dnwc;
      const expo = r.mid_year ? t - 0.5 : t;
      const df = 1 / Math.pow(1 + w, expo);
      const pv = fcff * df;
      pvSum += pv;
      rows.push({ year: t, revenue: rev, growth: gp[t - 1], ebit_margin: m, ebit, nopat, d_and_a: da, capex,
                  delta_nwc: dnwc, fcff, discount_factor: df, pv });
      revPrev = rev;
    }
    const last = rows[rows.length - 1];
    let fcffNext;
    if (r.terminal_roic) fcffNext = last.nopat * (1 + g) * (1 - g / r.terminal_roic);
    else fcffNext = last.fcff * (1 + g);
    const tv = fcffNext / (w - g);
    const pvTv = tv / Math.pow(1 + w, r.mid_year ? n - 0.5 : n);
    const ev = pvSum + pvTv;
    const investments = r.investments || 0;
    const minority = r.minority || 0;
    const equity = ev + r.cash + investments - r.debt - minority;
    const perShare = r.shares ? equity / r.shares : null;
    const ebitdaN = last.ebit + last.d_and_a;
    return {
      rows, sum_pv_fcff: pvSum, terminal_value: tv, pv_terminal_value: pvTv,
      terminal_value_share_of_ev: ev ? pvTv / ev : null,
      implied_exit_ev_ebitda: ebitdaN > 0 ? tv / ebitdaN : null,
      enterprise_value: ev, cash: r.cash, investments, debt: r.debt, minority, equity_value: equity, shares: r.shares,
      value_per_share: perShare,
      upside: perShare && r.price ? perShare / r.price - 1 : null,
    };
  }

  function valueOnly(r) {
    try { return dcf(r).value_per_share; } catch (e) { return null; }
  }

  function reverseDcf(r) {
    const price = r.price, e = Math.max(1, (r.revenue_growth || []).length);
    if (!price) return null;
    const f = (c) => { const v = valueOnly(Object.assign({}, r, { revenue_growth: Array(e).fill(c) }));
                       return v === null ? null : v - price; };
    let lo = -0.5, hi = 2.0;
    const flo = f(lo), fhi = f(hi);
    if (flo === null || fhi === null || flo > 0 || fhi < 0) return { implied_growth: null, years: e };
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2, fm = f(mid);
      if (fm === null) break;
      if (fm > 0) hi = mid; else lo = mid;
    }
    const c = (lo + hi) / 2;
    return { implied_growth: c, years: e, implied_revenue_year_n: r.base_revenue * Math.pow(1 + c, e) };
  }

  function wacc(d, taxRate) {
    const ke = d.risk_free + d.beta * d.equity_risk_premium;
    return { cost_of_equity: ke,
             wacc: (1 - d.debt_weight) * ke + d.debt_weight * d.pre_tax_cost_of_debt * (1 - taxRate) };
  }

  const api = { growthPath, dcf, valueOnly, reverseDcf, wacc };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DCF = api;
})(typeof window !== "undefined" ? window : globalThis);
