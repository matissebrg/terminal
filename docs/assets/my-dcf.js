/* The visitor's own DCF. The site publishes no DCF value: this module turns the calculator of the
 * Valorisation tab into a personal model.
 *
 *   start(I, price)      neutral starting point: the constant revenue growth that makes the model equal
 *                        today's price (reverse DCF), every other input taken from the accounts. When it
 *                        cannot be solved, the inputs are returned as they are.
 *   fields(I)            the adjustable inputs (sliders): id, label, bounds, getter, setter
 *   apply(st, saved)     put saved slider values back on a state
 *   compute(st, price)   run the DCF engine (dcf.js) on a state
 *   sensitivity(inputs)  the two grids of the page, same axes as pipeline/valuation.py::sensitivity
 *   load / save / clear  one model per ticker, kept in this browser (localStorage)
 *   mine(tk, I, price)   value of the saved model on today's data, or null
 *
 * Only the slider values are stored. Revenue, cash, debt and share count always come from the latest data,
 * so a saved model follows new filings. Tested by tests/js/my_dcf.test.js. */
(function (root) {
  "use strict";
  const DCF = root.DCF || (typeof require !== "undefined" ? require("./dcf.js") : null);
  const isNum = (x) => typeof x === "number" && isFinite(x);
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const KEY = (tk) => "archer-dcf-" + tk;

  /** The calculator needs revenue, a share count and a growth path. */
  function usable(I) {
    return !!I && I.base_revenue > 0 && I.shares > 0 && Array.isArray(I.revenue_growth) && I.revenue_growth.length > 0
      && !!I.wacc_detail;
  }

  function waccOf(st, I) {
    return st.W.method === "fixed" ? I.wacc : DCF.wacc(st.W, st.s.tax_rate).wacc;
  }

  function start(I, price) {
    const st = { s: clone(I), W: Object.assign({}, I.wacc_detail), implied: null };
    st.s.wacc = waccOf(st, I);
    if (price > 0) {
      const r = DCF.reverseDcf(Object.assign({}, st.s, { price }));
      if (r && isNum(r.implied_growth)) {
        st.implied = r.implied_growth;
        st.s.revenue_growth = st.s.revenue_growth.map(() => r.implied_growth);
      }
    }
    return st;
  }

  function fields(I) {
    const f = [];
    I.revenue_growth.forEach((_, i) => f.push({ id: "g" + i, label: `Croissance CA année ${i + 1}`, min: -0.3, max: 1.2, step: 0.01, type: "pct",
      get: (st) => st.s.revenue_growth[i], set: (st, v) => { st.s.revenue_growth[i] = v; } }));
    const s = (id, label, min, max, step, type, key) => f.push({ id, label, min, max, step, type, get: (st) => st.s[key], set: (st, v) => { st.s[key] = v; } });
    const w = (id, label, min, max, step, type, key) => f.push({ id, label, min, max, step, type, get: (st) => st.W[key], set: (st, v) => { st.W[key] = v; } });
    s("mt", "Marge EBIT cible", -0.2, 0.8, 0.005, "pct", "ebit_margin_target");
    s("my", "Années pour l'atteindre", 1, 10, 1, "int", "margin_years_to_target");
    s("tg", "Croissance terminale", 0, 0.05, 0.0025, "pct", "terminal_growth");
    s("tx", "Taux d'impôt", 0, 0.35, 0.005, "pct", "tax_rate");
    s("nw", "BFR / CA additionnel", 0, 0.5, 0.01, "pct", "nwc_pct_incremental_revenue");
    s("da", "D&A / CA", 0, 0.2, 0.0025, "pct", "d_and_a_pct_revenue");
    s("cx", "Capex / CA", 0, 0.3, 0.0025, "pct", "capex_pct_revenue");
    if (I.capex_pct_revenue_target != null) {
      s("cxt", "Capex / CA cible", 0, 0.3, 0.0025, "pct", "capex_pct_revenue_target");
      s("cxy", "Années pour l'atteindre (capex)", 1, 10, 1, "int", "capex_years_to_target");
    }
    w("rf", "Taux sans risque", 0, 0.08, 0.0005, "pct", "risk_free");
    w("bt", "Bêta", 0.3, 3, 0.01, "num", "beta");
    w("erp", "Prime de risque actions", 0.02, 0.08, 0.0025, "pct", "equity_risk_premium");
    return f;
  }

  /** Saved slider values -> state. Unknown ids and non-numbers are ignored (the model may be older than the data). */
  function apply(st, I, saved) {
    const v = (saved && saved.v) || {};
    fields(I).forEach((f) => { if (isNum(v[f.id])) f.set(st, f.type === "int" ? Math.round(v[f.id]) : v[f.id]); });
    return st;
  }

  function values(st, I) {
    const out = {};
    fields(I).forEach((f) => { out[f.id] = f.get(st); });
    return out;
  }

  function compute(st, I, price) {
    st.s.wacc = waccOf(st, I);
    const inp = Object.assign({}, st.s, { price });
    try { return { ok: true, res: DCF.dcf(inp), wacc: st.s.wacc, reverse: DCF.reverseDcf(inp), inputs: inp }; }
    catch (e) { return { ok: false, error: "WACC ≤ g", wacc: st.s.wacc, inputs: inp }; }
  }

  function sensitivity(r) {
    const wVals = [-0.015, -0.01, -0.005, 0, 0.005, 0.01, 0.015].map((x) => r.wacc + x);
    const gVals = [-0.01, -0.005, 0, 0.005, 0.01].map((x) => r.terminal_growth + x);
    const tgt = Math.abs(r.ebit_margin_target) || 0.1;
    const d = (s) => Math.abs(Math.log(s / (tgt * 0.1)));
    const step = [0.0025, 0.005, 0.01, 0.02, 0.05].reduce((b, s) => (d(s) < d(b) ? s : b));
    const mVals = [-3 * step, -2 * step, -step, 0, step].map((x) => r.ebit_margin_target + x);
    const kVals = [0.6, 0.8, 1.0, 1.2, 1.4];
    return {
      wacc_x_g: { rows: wVals, cols: gVals, row_label: "WACC", col_label: "Croissance terminale",
        values: wVals.map((wv) => gVals.map((gv) => DCF.valueOnly(Object.assign({}, r, { wacc: wv, terminal_growth: gv })))) },
      margin_x_growth: { rows: mVals, cols: kVals, row_label: "Marge EBIT cible", col_label: "Multiplicateur de croissance explicite",
        values: mVals.map((mv) => kVals.map((k) => DCF.valueOnly(Object.assign({}, r, { ebit_margin_target: mv, revenue_growth: r.revenue_growth.map((x) => x * k) })))) },
    };
  }

  // ------------------------------------------------------------------ storage (this browser only)
  const ls = () => { try { return root.localStorage || null; } catch (e) { return null; } };
  function load(tk) {
    const s = ls(); if (!s) return null;
    try { const o = JSON.parse(s.getItem(KEY(tk)) || "null"); return o && o.v && typeof o.v === "object" ? o : null; } catch (e) { return null; }
  }
  function save(tk, st, I, now) {
    const s = ls(); if (!s) return null;
    const o = { v: values(st, I), at: (now || new Date()).toISOString() };
    try { s.setItem(KEY(tk), JSON.stringify(o)); return o; } catch (e) { return null; }
  }
  function clear(tk) { const s = ls(); if (s) try { s.removeItem(KEY(tk)); } catch (e) { /* private mode */ } }

  function mine(tk, I, price) {
    const saved = load(tk);
    if (!saved || !usable(I)) return null;
    const c = compute(apply(start(I, price), I, saved), I, price);
    if (!c.ok || !isNum(c.res.value_per_share)) return null;
    return { value: c.res.value_per_share, upside: c.res.upside, at: saved.at };
  }

  const api = { usable, start, fields, apply, values, compute, sensitivity, load, save, clear, mine };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MyDCF = api;
})(typeof window !== "undefined" ? window : globalThis);
