// Order ticket market model must match pipeline/execution.py (values computed by the Python module)
const assert = require("assert");
global.window = { T: { fmt: {} } };
global.document = { addEventListener() {} };
require("../../docs/assets/trade-ticket.js");
const TT = window.TT;
const near = (a, b, tol = 1e-6) => assert(Math.abs(a - b) < tol, `${a} != ${b}`);
[[1e5, 10, 100], [1e7, 50, 10], [1e9, 200, 1], [null, 30, 150], [5e6, 0.5, 200]].forEach(([adv, p, bp]) => near(TT.spreadBps(adv, p), bp));
// execution.market_fill({c: 100, v: 1e6}, "buy", 5e4, {spread_bps: 5, sigma_d: 0.02, adv_shares: 1e6}) -> 100.2486, impact 22.36 bp
const e = TT.estimate({ close: 100, spread_bps: 5, sigma_d: 0.02, adv_shares: 1e6 }, "buy", 5e4);
near(e.price, 100.2486, 1e-4); near(e.impactBps, 22.36, 0.01); near(e.halfBps, 2.5);
assert(e.sessions === 1 && Math.abs(e.participation - 0.05) < 1e-12);
const big = TT.estimate({ close: 100, spread_bps: 5, sigma_d: 0.02, adv_shares: 1e6 }, "sell", 3.5e5);
assert(big.sessions === 4 && big.price < 100);
// touch probability: at the money = 1, symmetric, decreasing with distance
near(TT.touchProb(100, 100, 0.02, 21), 1);
near(TT.touchProb(100, 95, 0.02, 21), TT.touchProb(100, 100 / 0.95, 0.02, 21), 1e-9);
assert(TT.touchProb(100, 90, 0.02, 21) < TT.touchProb(100, 95, 0.02, 21));
console.log("trade ticket: ok");
