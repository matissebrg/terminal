// The prediction form's file writer (docs/assets/js/predict-core.js): what it writes must be a valid
// registry file for pipeline/predictions.py (checked on the Python side by tests/test_site_predictions.py).
const assert = require("assert");
const P = require("../../docs/assets/js/predict-core.js");

// numbers as typed in French
assert.strictEqual(P.num("1,25"), 1.25);
assert.strictEqual(P.num(" 1 250,5 "), 1250.5);
assert.strictEqual(P.num(""), null);
assert.ok(Number.isNaN(P.num("12a")));
assert.ok(Number.isNaN(P.num("1,2,3")));

const today = "2026-11-20";
const full = {
  ticker: "veev", period: "Q3 FY2027",
  metrics: { revenue: { value: "0,95", low: "0,93", high: "0,97" }, operating_margin: { value: "31,5", low: "", high: "" } },
  events: [{ question: 'CA au-dessus du "haut" de la guidance ?', probability: "60" }],
  price: [{ date: "2027-03-31", value: "300", low: "250", high: "340" }],
  note: "Ligne 1\nLigne 2",
};
assert.deepStrictEqual(P.validate(full, { today, metricsAllowed: true }), []);

const now = new Date("2026-11-20T09:05:00Z");
const y = P.toYaml(full, now);
assert.ok(y.includes("ticker: VEEV\nperiod: Q3 FY2027\n"));
assert.ok(y.includes("  revenue: {value: 0.95, low: 0.93, high: 0.97}\n"));
assert.ok(y.includes("  operating_margin: {value: 31.5}\n"));
assert.ok(y.includes('question: "CA au-dessus du \\"haut\\" de la guidance ?", probability: 60, outcome: null'));
assert.ok(y.includes("  - {date: 2027-03-31, value: 300, low: 250, high: 340}\n"));
assert.ok(y.includes("note: |\n  Ligne 1\n  Ligne 2\n"));
assert.strictEqual(P.fileName(full, now), "config/predictions/VEEV/2026-11-20-0905-q3-fy2027.yaml");

// price / yes-no only: no period, own file name
const px = { ticker: "SNY", period: "", metrics: {}, events: [], price: [{ date: "2027-06-30", value: "105" }], note: "" };
assert.deepStrictEqual(P.validate(px, { today, metricsAllowed: false }), []);
assert.ok(!P.toYaml(px, now).includes("period:"));
assert.strictEqual(P.fileName(px, now), "config/predictions/SNY/2026-11-20-0905-cours-et-questions.yaml");

// errors the form must catch
const errs = (d, o) => P.validate(d, Object.assign({ today, metricsAllowed: true }, o)).join(" | ");
assert.match(errs({ ticker: "VEEV", period: "Q3 FY2027", metrics: {}, events: [], price: [] }), /Rien à enregistrer/);
assert.match(errs({ ticker: "VEEV", period: "T3 2027", metrics: { revenue: { value: "1" } }, events: [], price: [] }), /Période attendue/);
assert.match(errs({ ticker: "VEEV", period: "Q3 FY2027", metrics: { revenue: { value: "1", low: "0,9" } }, events: [], price: [] }), /le bas et le haut/);
assert.match(errs({ ticker: "VEEV", period: "Q3 FY2027", metrics: { revenue: { value: "1,2", low: "0,9", high: "1,1" } }, events: [], price: [] }), /dépasse le haut/);
assert.match(errs({ ticker: "VEEV", period: "Q3 FY2027", metrics: {}, events: [{ question: "x", probability: "120" }], price: [] }), /entre 0 et 100/);
assert.match(errs({ ticker: "VEEV", period: "", metrics: {}, events: [], price: [{ date: "2026-11-01", value: "10" }] }), /date future/);
assert.match(errs({ ticker: "SNY", period: "FY2026", metrics: { revenue: { value: "45" } }, events: [], price: [] }, { metricsAllowed: false }), /pas notés automatiquement/);

// GitHub link: the whole file travels in the URL
const url = P.newFileUrl("matissebrg/terminal", P.fileName(full, now), y);
assert.ok(url.startsWith("https://github.com/matissebrg/terminal/new/main?filename=config%2Fpredictions%2FVEEV%2F"));
assert.strictEqual(decodeURIComponent(url.split("&value=")[1]), y);

// display of raw pipeline values
assert.strictEqual(P.show(954017385, "Md$"), "0,95 Md$");
assert.strictEqual(P.show(0.3157, "%"), "31,6 %");
assert.strictEqual(P.show(-1.5, "$"), "−1,50 $");
assert.strictEqual(P.fr(1234567.891, 1), "1 234 567,9");
assert.strictEqual(P.signedPct(0.0123), "+1,2 %");
assert.strictEqual(P.brierWords(0.18), "mieux qu'une pièce");

console.log("predict_core ok");
