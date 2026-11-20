// The visitor's own DCF (docs/assets/my-dcf.js): the starting point reproduces today's price, saved slider
// values are re-applied on fresh data, and the sensitivity grids are centred on the model.
const assert = require("assert");
const store = {};
global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
const DCF = require("../../docs/assets/dcf.js");
const MD = require("../../docs/assets/my-dcf.js");
const near = (a, b, t = 1e-6) => assert(Math.abs(a - b) < t, `${a} != ${b}`);

const I = { years: 10, base_revenue: 302.969e9, revenue_growth: [0.5, 0.2, 0.12, 0.08, 0.06], ebit_margin_start: 0.652, ebit_margin_target: 0.55,
  margin_years_to_target: 7, tax_rate: 0.17, d_and_a_pct_revenue: 0.0122, capex_pct_revenue: 0.0243, nwc_pct_incremental_revenue: 0.15,
  terminal_growth: 0.03, terminal_roic: null, mid_year: true, capex_pct_revenue_target: null, capex_years_to_target: 5, wacc: 0.1188,
  wacc_detail: { risk_free: 0.051, beta: 1.522, equity_risk_premium: 0.045, pre_tax_cost_of_debt: 0.05, debt_weight: 0.0084, method: "capm" },
  cash: 56.586e9, debt: 33.366e9, investments: 90.681e9, minority: 0, shares: 24.1e9 };
const price = 162.85;

// ---- usable: needs revenue, shares, a growth path
assert(MD.usable(I));
assert(!MD.usable(Object.assign({}, I, { base_revenue: 0 })));       // pre-revenue biotech
assert(!MD.usable(Object.assign({}, I, { shares: null })));
assert(!MD.usable(null));

// ---- the starting point is the price itself: one constant growth, nothing else touched
const st = MD.start(I, price);
assert(st.implied > 0 && st.implied < 0.5);
assert(st.s.revenue_growth.every((g) => g === st.implied) && st.s.revenue_growth.length === 5);
assert.strictEqual(st.s.ebit_margin_target, I.ebit_margin_target);
const c0 = MD.compute(st, I, price);
assert(c0.ok);
near(c0.res.value_per_share, price, 1e-6);
near(c0.res.upside, 0, 1e-8);
near(c0.reverse.implied_growth, st.implied, 1e-9);
assert.deepStrictEqual(I.revenue_growth, [0.5, 0.2, 0.12, 0.08, 0.06]);   // the inputs are not mutated
// the WACC is rebuilt from its parts (CAPM), not read from the file
near(c0.wacc, DCF.wacc(I.wacc_detail, I.tax_rate).wacc, 1e-12);

// ---- no solution (margins too low for any growth to reach the price): inputs kept as they are
const bad = Object.assign({}, I, { ebit_margin_start: -0.4, ebit_margin_target: -0.7 });
const sb = MD.start(bad, price);
assert.strictEqual(sb.implied, null);
assert.deepStrictEqual(sb.s.revenue_growth, bad.revenue_growth);
assert.strictEqual(MD.start(I, null).implied, null);

// ---- fields: one slider per explicit year, capex target only when the company has one
const ids = MD.fields(I).map((f) => f.id);
assert.deepStrictEqual(ids, ["g0", "g1", "g2", "g3", "g4", "mt", "my", "tg", "tx", "nw", "da", "cx", "rf", "bt", "erp"]);
assert(MD.fields(Object.assign({}, I, { capex_pct_revenue_target: 0.06 })).some((f) => f.id === "cxt"));

// ---- a higher margin or a lower beta raises the value; the change shows as a gap to the price
const up = MD.start(I, price);
MD.fields(I).find((f) => f.id === "mt").set(up, 0.6);
MD.fields(I).find((f) => f.id === "bt").set(up, 1.2);
const c1 = MD.compute(up, I, price);
assert(c1.res.value_per_share > price * 1.1 && c1.res.upside > 0.1 && c1.wacc < c0.wacc);

// ---- WACC below terminal growth: reported, not thrown
const brk = MD.start(I, price);
brk.W.risk_free = 0; brk.W.beta = 0.3; brk.W.equity_risk_premium = 0.02; brk.s.terminal_growth = 0.05;
assert.strictEqual(MD.compute(brk, I, price).ok, false);

// ---- save / load / mine: only slider values are stored, and they follow new data
assert.strictEqual(MD.mine("NVDA", I, price), null);                       // nothing saved yet
const saved = MD.save("NVDA", up, I, new Date("2026-11-16T10:00:00Z"));
assert.strictEqual(saved.at, "2026-11-16T10:00:00.000Z");
assert.deepStrictEqual(Object.keys(saved.v), ids);
assert(!("base_revenue" in saved.v) && !("cash" in saved.v));
const m = MD.mine("NVDA", I, price);
near(m.value, c1.res.value_per_share, 1e-9); near(m.upside, c1.res.upside, 1e-12);
assert.strictEqual(m.at, saved.at);
assert.strictEqual(MD.mine("AMZN", I, price), null);                       // one model per ticker
// next quarter: more revenue, more cash, another price -> same assumptions, another value
const I2 = Object.assign({}, I, { base_revenue: I.base_revenue * 1.1, cash: I.cash * 1.2 });
const m2 = MD.mine("NVDA", I2, 170);
assert(m2.value > m.value);
near(m2.upside, m2.value / 170 - 1, 1e-12);
// a model saved when the company had no capex target still loads once it has one (unknown ids are skipped)
assert(MD.mine("NVDA", Object.assign({}, I, { capex_pct_revenue_target: 0.03 }), price).value > 0);
// corrupted storage is ignored
store["mangrove-dcf-XOM"] = "{not json"; assert.strictEqual(MD.load("XOM"), null);
store["mangrove-dcf-XOM"] = JSON.stringify({ v: { mt: "0.9", g0: null } });
near(MD.mine("XOM", I, price).value, price, 1e-6);                         // non-numbers skipped -> starting point
MD.clear("NVDA");
assert.strictEqual(MD.load("NVDA"), null); assert.strictEqual(MD.mine("NVDA", I, price), null);

// ---- sensitivity: same axes as pipeline/valuation.py::sensitivity, centre = the model itself
const g = MD.sensitivity(c1.inputs);
assert.strictEqual(g.wacc_x_g.rows.length, 7); assert.strictEqual(g.wacc_x_g.cols.length, 5);
assert.strictEqual(g.margin_x_growth.rows.length, 5); assert.strictEqual(g.margin_x_growth.cols.length, 5);
near(g.wacc_x_g.values[3][2], c1.res.value_per_share, 1e-9);
near(g.margin_x_growth.values[3][2], c1.res.value_per_share, 1e-9);
near(g.margin_x_growth.rows[4] - g.margin_x_growth.rows[3], 0.05, 1e-12);  // 60 % margin -> 5-point steps
near(MD.sensitivity(Object.assign({}, c1.inputs, { ebit_margin_target: 0.05 })).margin_x_growth.rows[4] - 0.05, 0.005, 1e-12);
assert(g.wacc_x_g.values[0][2] > g.wacc_x_g.values[6][2]);                 // lower WACC, higher value
assert(g.wacc_x_g.values[3][4] > g.wacc_x_g.values[3][0]);                 // higher terminal growth, higher value

// ---- without storage (private mode) nothing breaks
delete global.localStorage;
assert.strictEqual(MD.load("NVDA"), null); assert.strictEqual(MD.save("NVDA", up, I), null); MD.clear("NVDA");
console.log("my_dcf ok");
