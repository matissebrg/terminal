"""Orchestrator: fetch -> normalize -> ratios -> valuation -> feed -> JSON for the site.

Usage:
    python -m pipeline.build                       # live data (SEC + market)
    python -m pipeline.build --fixtures tests/fixtures   # offline, synthetic demo data
"""
from __future__ import annotations

import argparse
import json
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

import yaml

from . import feed, market, normalize, ratios, sec, valuation

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "data"


# --------------------------------------------------------------------------- data sources
class LiveSource:
    mode = "live"

    def __init__(self, known_ciks: dict | None = None):
        self._tickers = None
        self._known = {k.upper(): int(v) for k, v in (known_ciks or {}).items() if v}
        self._cache: dict = {}

    def cik(self, ticker: str) -> int:
        if ticker.upper() in self._known:
            return self._known[ticker.upper()]
        if self._tickers is None:
            self._tickers = sec.ticker_map()
        return self._tickers[ticker.upper()]

    def facts(self, ticker):
        k = ("facts", ticker)
        if k not in self._cache:
            self._cache[k] = sec.company_facts(self.cik(ticker))
        return self._cache[k]

    def submissions(self, ticker):
        k = ("subs", ticker)
        if k not in self._cache:
            self._cache[k] = sec.submissions(self.cik(ticker))
        return self._cache[k]

    def prices(self, sym, cached):
        return market.daily_prices(sym, cached)

    def risk_free(self, fallback):
        return market.risk_free_10y(fallback)


class FixtureSource:
    """Reads synthetic files written by tests/fixtures/make_fixtures.py (no network)."""
    mode = "fixture"

    def __init__(self, folder: Path):
        self.folder = folder

    def _j(self, name):
        return json.loads((self.folder / name).read_text())

    def facts(self, ticker):
        return self._j(f"facts_{ticker}.json")

    def submissions(self, ticker):
        return self._j(f"subs_{ticker}.json")

    def prices(self, sym, cached):
        return self._j(f"prices_{sym}.json"), "fixture"

    def risk_free(self, fallback):
        return 0.0425, "fixture", "2026-10-26"


# --------------------------------------------------------------------------- helpers
def write(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":"), default=_json_default))


def _json_default(o):
    if isinstance(o, float):
        return round(o, 6)
    return str(o)


def latest_shares(fin: dict) -> float | None:
    so = fin.get("shares_outstanding") or []
    if so:
        return so[-1]["shares"]
    return fin["ttm"].get("diluted_shares")


def load_cached_prices(sym: str) -> list[dict] | None:
    p = OUT / "_prices" / f"{sym}.json"
    try:
        return json.loads(p.read_text())["bars"]
    except (FileNotFoundError, json.JSONDecodeError, KeyError):
        return None


def get_prices(src, sym: str, status: dict) -> list[dict]:
    bars, source = src.prices(sym, load_cached_prices(sym))
    status["prices"][sym] = {"source": source, "last": bars[-1]["t"] if bars else None, "n": len(bars)}
    if bars and source != "cache":
        write(OUT / "_prices" / f"{sym}.json", {"symbol": sym, "source": source, "bars": bars})
    return bars


def peer_quarterly(fin: dict, n: int = 12) -> list[dict]:
    q = fin["periods"]["quarterly"][-n:]
    L = fin["lines"]
    out = []
    for p in q:
        lab = p["label"]
        rev = L["revenue"]["quarterly"].get(lab)
        oi = L["operating_income"]["quarterly"].get(lab)
        gp = L["gross_profit"]["quarterly"].get(lab)
        out.append({"label": lab, "end": p["end"], "revenue": rev,
                    "operating_margin": (oi / rev) if rev and oi is not None else None,
                    "gross_margin": (gp / rev) if rev and gp is not None else None})
    return out


# --------------------------------------------------------------------------- main
def run(src, only: list[str] | None = None) -> int:
    universe = yaml.safe_load((ROOT / "config" / "universe.yaml").read_text())
    now = datetime.now(timezone.utc)
    today = now.date().isoformat()
    status = {"generated_at": now.isoformat(timespec="seconds"), "mode": src.mode, "prices": {},
              "coverage": {}, "errors": [], "risk_free": None}
    meta = {"generated_at": status["generated_at"], "mode": src.mode}

    bench_bars = {}
    for b in universe.get("benchmarks", {}):
        bench_bars[b] = get_prices(src, b, status)

    all_events, index = [], []
    tickers = [t for t in universe["tickers"] if not only or t in only]
    for t in tickers:
        cfg = universe["tickers"][t]
        print(f"== {t}")
        try:
            assump = yaml.safe_load((ROOT / "config" / "assumptions" / f"{t}.yaml").read_text())
            rf = src.risk_free(float(assump["wacc"].get("risk_free_fallback", 0.044)))
            status["risk_free"] = {"value": rf[0], "source": rf[1], "as_of": rf[2]}

            facts = src.facts(t)
            subs = src.submissions(t)
            fin = normalize.normalize(facts)
            status["coverage"][t] = fin["coverage"]
            rat = ratios.compute(fin)
            bars = get_prices(src, t, status)
            perf = market.perf_stats(bars)
            price = perf.get("last")
            shares = latest_shares(fin)
            mcap = price * shares if price and shares else None
            b = market.beta(bars, bench_bars.get(universe.get("beta_benchmark", "SPY"), []))
            mkt = {"price": price, "shares": shares, "mcap": mcap, "rf": list(rf), "beta": b}

            resolved = valuation.resolve(assump, fin, mkt)
            base = valuation.dcf(resolved)
            sens = valuation.sensitivity(resolved)
            rev_dcf = valuation.reverse_dcf(resolved)
            scen = valuation.scenarios(assump, fin, mkt)

            # ---- comparables
            target_snap = valuation.company_snapshot(t, cfg["name"], fin, price, shares)
            peers_out = []
            for p in (assump.get("comps", {}).get("peers") or cfg.get("peers") or []):
                try:
                    pfin = normalize.normalize(src.facts(p))
                    pbars = get_prices(src, p, status)
                    pprice = pbars[-1]["c"] if pbars else None
                    snap = valuation.company_snapshot(p, universe.get("peer_names", {}).get(p, p), pfin,
                                                      pprice, latest_shares(pfin))
                    snap["quarterly"] = peer_quarterly(pfin)
                    snap["perf"] = {k: v for k, v in market.perf_stats(pbars).items()
                                    if k.startswith("r_") or k in ("last", "date", "chg_1d")}
                    snap["closes"] = [[x["t"], x["ac"]] for x in pbars[-1260:]]
                    peers_out.append(snap)
                except Exception as exc:  # noqa: BLE001 - a broken peer must not kill the run
                    status["errors"].append(f"pair {p}: {exc}")
                    print(f"  ! pair {p}: {exc}")
            comp = valuation.comps(target_snap, peers_out)

            # ---- filings & profile
            filings = sec.recent_filings(subs)
            prof = sec.profile(subs)

            # ---- history, feed, bridge
            value_base = base["value_per_share"]

            def recompute(a, m):
                try:
                    return valuation.dcf(valuation.resolve(a, fin, m))["value_per_share"]
                except Exception:  # noqa: BLE001
                    return None

            snapshot = {
                "price": price, "value_base": value_base, "value_weighted": scen["weighted_value_per_share"],
                "comps_median": (comp.get("implied_summary") or {}).get("median"),
                "scenarios": {k: v["value_per_share"] for k, v in scen["cases"].items()},
                "wacc": resolved["wacc"], "assumptions": assump,
                "assumptions_hash": feed.assumptions_hash(assump), "market": mkt,
                "latest_period": fin["periods"]["quarterly"][-1]["label"] if fin["periods"]["quarterly"] else None,
            }
            events = feed.update(ticker=t, today=today, hist_path=OUT / t / "history.json",
                                 snapshot=snapshot, filings=filings, perf=perf, recompute=recompute)
            all_events += events
            hist = feed.load_json(OUT / t / "history.json", {"snapshots": []})["snapshots"]

            # ---- write site data
            write(OUT / t / "company.json", {
                "meta": meta, "ticker": t, "name": cfg["name"], "sector": cfg.get("sector"),
                "industry": cfg.get("industry"), "profile": prof, "thesis": assump.get("thesis"),
                "price": price, "shares": shares, "market_cap": mcap, "perf": perf, "beta": b,
                "filings": filings[:30], "latest_period": snapshot["latest_period"],
            })
            write(OUT / t / "financials.json", {"meta": meta, **{k: fin[k] for k in (
                "periods", "lines", "ttm", "sources", "labels", "statement", "kinds", "shares_outstanding")},
                "cik": prof["cik"]})
            write(OUT / t / "ratios.json", {"meta": meta, **rat})
            write(OUT / t / "prices.json", {"meta": meta, "symbol": t, "source": status["prices"][t]["source"],
                                            "bars": bars, "benchmarks": {
                                                k: [[x["t"], x["ac"]] for x in v] for k, v in bench_bars.items()},
                                            "benchmark_names": universe.get("benchmarks", {})})
            write(OUT / t / "valuation.json", {
                "meta": meta, "ticker": t, "price": price,
                "dcf": {"inputs": {k: v for k, v in resolved.items() if not k.startswith("_")},
                        "sources": resolved["_sources"], "result": base, "growth_path": valuation.growth_path(resolved)},
                "sensitivity": sens, "reverse_dcf": rev_dcf, "scenarios": scen,
                "comps": comp, "target": target_snap,
                "assumptions_raw": assump,
                "football_field": _football(base, scen, sens, comp, perf),
                "history": [{"date": s["date"], "price": s.get("price"), "value_base": s.get("value_base"),
                             "value_weighted": s.get("value_weighted"), "comps_median": s.get("comps_median")}
                            for s in hist],
            })
            write(OUT / t / "peers.json", {"meta": meta, "target": {**target_snap,
                                                                    "quarterly": peer_quarterly(fin)},
                                           "peers": peers_out})
            index.append({"ticker": t, "name": cfg["name"], "sector": cfg.get("sector"), "price": price,
                          "chg_1d": perf.get("chg_1d"), "market_cap": mcap, "value_base": value_base,
                          "value_weighted": scen["weighted_value_per_share"],
                          "upside": (value_base / price - 1) if value_base and price else None,
                          "upside_weighted": (scen["weighted_value_per_share"] / price - 1)
                          if scen["weighted_value_per_share"] and price else None,
                          "spark": [x["c"] for x in bars[-60:]], "latest_period": snapshot["latest_period"]})
            print(f"  valeur DCF {value_base:.2f} $ | pondérée {scen['weighted_value_per_share']:.2f} $ | "
                  f"cours {price}")
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            status["errors"].append(f"{t}: {exc}")

    benches = {}
    for b_sym, bars in bench_bars.items():
        p = market.perf_stats(bars)
        benches[b_sym] = {"name": universe["benchmarks"][b_sym], "last": p.get("last"), "chg_1d": p.get("chg_1d"),
                          "r_ytd": p.get("r_ytd"), "r_1y": p.get("r_1y"), "spark": [x["c"] for x in bars[-60:]]}
    write(OUT / "universe.json", {"meta": meta, "tickers": index, "benchmarks": benches,
                                  "risk_free": status["risk_free"]})
    feed.merge_feed(OUT / "feed.json", all_events)
    write(OUT / "status.json", status)
    if status["errors"]:
        print("Erreurs :", *status["errors"], sep="\n  ")
    # Fail the job only if no ticker could be built at all
    return 0 if index else 1


def _football(base, scen, sens, comp, perf):
    """Ranges for the 'football field' chart (classic banker summary of a valuation)."""
    rows = []
    cases = scen["cases"]
    vals = [v["value_per_share"] for v in cases.values() if v.get("value_per_share")]
    if vals:
        rows.append({"label": "DCF — scénarios bear → bull", "low": min(vals), "high": max(vals),
                     "mid": scen["weighted_value_per_share"]})
    g = sens["wacc_x_g"]["values"]
    core = [v for row in g[1:6] for v in row[1:4] if v]
    if core:
        rows.append({"label": "DCF base — WACC ±1 pt, g ±0,5 pt", "low": min(core), "high": max(core),
                     "mid": base["value_per_share"]})
    s = comp.get("implied_summary")
    if s:
        rows.append({"label": "Comparables — multiples médians des pairs", "low": s["low"], "high": s["high"],
                     "mid": s["median"]})
    if perf.get("low_52w"):
        rows.append({"label": "Cours — plus bas / plus haut 52 semaines", "low": perf["low_52w"],
                     "high": perf["high_52w"], "mid": None})
    return rows


def main(argv=None):
    global OUT
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, help="dossier de sortie (défaut : docs/data)")
    ap.add_argument("--fixtures", type=Path, help="dossier de données synthétiques (mode hors-ligne)")
    ap.add_argument("--tickers", nargs="*")
    args = ap.parse_args(argv)
    if args.out:
        OUT = args.out
    universe = yaml.safe_load((ROOT / "config" / "universe.yaml").read_text())
    src = FixtureSource(args.fixtures) if args.fixtures else LiveSource(universe.get("ciks"))
    return run(src, args.tickers)


if __name__ == "__main__":
    sys.exit(main())
