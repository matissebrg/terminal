const PA = require("../../docs/assets/portfolio-analytics.js");
const assert = require("assert");
// 30 days, portfolio = 2x SPY daily moves -> beta 2, corr 1
let v = [], p = 100000, s = 500;
const moves = [0.01, -0.005, 0.007, -0.012, 0.004, 0.009, -0.003, 0.002, -0.008, 0.011];
for (let i = 0; i < 31; i++) { const m = i ? moves[i % moves.length] : 0; s *= 1 + m; p *= 1 + 2 * m; v.push({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, value: p, spy_close: s }); }
const st = PA.stats(v);
assert(Math.abs(st.beta - 2) < 1e-9 && Math.abs(st.corr - 1) < 1e-9, "beta");
assert(st.n === 30 && st.reliable);
assert(st.maxDD < 0 && st.maxDD >= -1);
assert(Math.abs(st.total - (p / 100000 - 1)) < 1e-12);
// drawdown known path
const d = PA.stats([{ value: 100 }, { value: 120 }, { value: 90 }, { value: 110 }].map((x, i) => ({ ...x, date: "d" + i })));
assert(Math.abs(d.maxDD - (90 / 120 - 1)) < 1e-12 && Math.abs(d.curDD - (110 / 120 - 1)) < 1e-12);
// ledger
const L = PA.ledger([{ id: 1, ticker: "A", side: "buy", qty: 10, price: 100 }, { id: 2, ticker: "A", side: "buy", qty: 10, price: 120 },
  { id: 3, ticker: "A", side: "sell", qty: 5, price: 130 }, { id: 4, ticker: "B", side: "buy", qty: 1, price: 50 }, { id: 5, ticker: "B", side: "sell", qty: 1, price: 40 }]);
assert(Math.abs(L.realised.A - 100) < 1e-9 && L.realised.B === -10 && L.winRate === 0.5);
const c = PA.concentration([50, 50]); assert(Math.abs(c.nEff - 2) < 1e-12 && c.top3 === 1);
console.log("portfolio analytics: ok", st.sharpe.toFixed(2), st.vol.toFixed(3));
