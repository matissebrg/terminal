// The volatility surface grid: built from OTM quotes only, bad quotes dropped, no extrapolation,
// and total variance (not volatility) interpolated between expiries.
const assert = require("assert");
global.window = { T: { fmt: {} } };
require("../../docs/assets/vol-surface.js");
const VS = window.T.volSurface;
const now = Date.UTC(2026, 10, 11, 21, 0, 0), DAY = 864e5;
const day = (n) => new Date(now + n * DAY).toISOString().slice(0, 10);
const chain = (ivAtm, skew) => [70, 80, 90, 95, 100, 105, 110, 120, 130].map((k) => {
  const iv = ivAtm + skew * (1 - k / 100);
  return { strike: k, c_iv: iv, c_bid: 1, c_ask: 1.1, p_iv: iv, p_bid: 1, p_ask: 1.1 };
});
const o = { spot: 100, asof: "2026-11-11T21:00:00Z", chains: { [day(10)]: chain(0.60, 0.5), [day(40)]: chain(0.50, 0.4), [day(100)]: chain(0.40, 0.3),
  [day(1)]: chain(0.9, 0.5),                                                         // expires tomorrow: ignored (wings are noise)
  [day(20)]: [{ strike: 100, c_iv: 0.5, c_bid: 1, c_ask: 1.1 }] } };               // one quote: not a smile, ignored
const D = VS.build(o, now);
assert.strictEqual(D.rows.length, 3);
assert(Math.abs(D.lo - 0.7) < 1e-9 && Math.abs(D.hi - 1.3) < 1e-9);
const near = (a, b, t = 1e-6) => assert(Math.abs(a - b) < t, `${a} != ${b}`);
near(D.xs[D.atmI], 1); near(D.grid[0].iv[D.atmI], 0.60); near(D.grid[D.grid.length - 1].iv[D.atmI], 0.40);
assert(D.grid[0].iv[0] > D.grid[0].iv[D.xs.length - 1], "puts richer than calls with a positive skew");
// between day 10 (60 %) and day 40 (50 %): total variance is linear in time
const mid = D.grid[1], w = (0.36 * 10 + (0.25 * 40 - 0.36 * 10) * (mid.days - 10) / 30) / mid.days;
assert(!mid.real); near(mid.iv[D.atmI], Math.sqrt(w));
// junk is dropped: no bid, crossed or very wide quotes, absurd IV; the put side is used below spot, the call side above
const bad = JSON.parse(JSON.stringify(o));
bad.chains[day(10)][4] = { strike: 100, c_iv: 9, c_bid: 1, c_ask: 1.1, p_iv: 0.6, p_bid: 1, p_ask: 1.1 };     // absurd call IV at the money
bad.chains[day(10)][1].p_bid = 0;                                                                               // dead quote at 80
bad.chains[day(10)][2].p_ask = 5;                                                                               // 133 % wide at 90
const B = VS.build(bad, now);
assert.strictEqual(B.rows[0].pts.length, 6); assert(B.max < 1, "the absurd quote must not reach the surface");
// an expiry quoted on a narrower range than the others leaves a hole, it is not extrapolated
const rag = JSON.parse(JSON.stringify(o));
rag.chains[day(40)] = rag.chains[day(40)].filter((r) => r.strike >= 90 && r.strike <= 110);
const R = VS.build(rag, now), mid40 = R.grid.find((g) => g.date === day(40));
near(R.lo, 0.7); assert(!mid40.ok[0] && !mid40.ok[R.xs.length - 1] && mid40.ok[R.atmI], "outside its quoted strikes an expiry is empty");
assert(R.grid[0].ok.every(Boolean) && !R.grid[2].ok[0], "the hole narrows gradually between the two expiries");
assert(R.grid[1].ok.filter(Boolean).length > R.grid[2].ok.filter(Boolean).length && R.grid[2].ok.filter(Boolean).length > mid40.ok.filter(Boolean).length);
// too few expiries, or a smile that does not straddle the spot: no surface rather than a made-up one
assert.strictEqual(VS.build({ spot: 100, chains: { [day(10)]: chain(0.6, 0.5), [day(40)]: chain(0.5, 0.4) } }, now), null);
assert.strictEqual(VS.build({ spot: 300, chains: o.chains }, now), null);
console.log("vol surface: ok");
