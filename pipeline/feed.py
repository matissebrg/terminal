"""Event feed + valuation history (the 'database' of the terminal).

Every run appends a dated snapshot to docs/data/<T>/history.json. Comparing the
new snapshot with the previous one produces feed events:

  * filing     — a new 10-K / 10-Q / results 8-K appeared on EDGAR
  * valuation  — the DCF value moved, with a bridge explaining *why*:
                   data effect        new financials, same assumptions, same market inputs
                   assumption effect  you edited config/assumptions/<T>.yaml
                   market effect      risk-free rate, beta, market-weighted cost of capital
  * price      — a daily move of ±5 % or more
  * cross      — the price crossed the DCF value (upside changed sign)
  * coverage   — first run for a ticker
"""
from __future__ import annotations

import hashlib
import json
from datetime import date
from pathlib import Path
from typing import Callable

VALUE_EVENT_THRESHOLD = 0.01        # 1 % move in DCF value -> event
VALUE_EVENT_THRESHOLD_CAUSED = 0.001  # when a filing or an assumption edit explains it
PRICE_EVENT_THRESHOLD = 0.05


def fr(x: float, d: int = 2) -> str:
    """French number formatting: 1 234,56"""
    return f"{x:,.{d}f}".replace(",", "\u202f").replace(".", ",")


def frp(x: float, d: int = 1) -> str:
    return ("+" if x > 0 else "") + fr(x * 100, d) + " %"


def assumptions_hash(a: dict) -> str:
    return hashlib.sha1(json.dumps(a, sort_keys=True, default=str).encode()).hexdigest()[:10]


def _eid(*parts) -> str:
    return hashlib.sha1("|".join(map(str, parts)).encode()).hexdigest()[:12]


def load_json(path: Path, default):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def update(*, ticker: str, today: str, hist_path: Path, snapshot: dict, filings: list[dict],
           perf: dict, recompute: Callable[[dict, dict], float | None]) -> list[dict]:
    """snapshot: {price, value_base, value_weighted, assumptions, assumptions_hash, market,
                  data_asof, latest_period}
    recompute(assumptions, market) -> value per share using the *current* financials."""
    store = load_json(hist_path, {"snapshots": [], "seen_filings": []})
    snaps = store["snapshots"]
    seen = set(store.get("seen_filings", []))
    events: list[dict] = []
    prev = next((s for s in reversed(snaps) if s["date"] < today), None) or (snaps[-1] if snaps else None)

    if not snaps:
        events.append({
            "id": _eid(ticker, "coverage", today), "date": today, "ticker": ticker, "type": "coverage",
            "title": f"{ticker} : couverture initiée",
            "detail": "Premier calcul de valorisation à partir des données SEC.",
            "values": {"price": snapshot["price"], "value_base": snapshot["value_base"],
                       "value_weighted": snapshot["value_weighted"]},
        })

    # ---- new filings (on the first run, just mark everything as seen)
    new_filings = [f for f in filings if f["accession"] not in seen]
    filing_caused = False
    if snaps:
        for f in sorted(new_filings, key=lambda x: x["filed"]):
            if not f.get("is_results") and f["form"] not in ("10-K", "10-Q"):
                continue
            filing_caused = filing_caused or f["form"] in ("10-K", "10-Q", "20-F")
            kind = {"10-K": "rapport annuel (10-K)", "10-Q": "rapport trimestriel (10-Q)",
                    "8-K": "communiqué de résultats (8-K 2.02)"}.get(f["form"], f["form"])
            events.append({
                "id": _eid(ticker, f["accession"]), "date": f["filed"], "ticker": ticker, "type": "filing",
                "title": f"{ticker} a publié son {kind}",
                "detail": f"Période close le {f.get('report_date') or '—'}.",
                "url": f["url"], "values": {"form": f["form"], "accession": f["accession"]},
            })
    seen |= {f["accession"] for f in filings}

    # ---- valuation change + bridge
    if prev and prev.get("value_base") and snapshot.get("value_base"):
        v0, v3 = prev["value_base"], snapshot["value_base"]
        chg = v3 / v0 - 1
        assump_changed = prev.get("assumptions_hash") != snapshot["assumptions_hash"]
        threshold = VALUE_EVENT_THRESHOLD_CAUSED if (filing_caused or assump_changed) else VALUE_EVENT_THRESHOLD
        if abs(chg) >= threshold:
            prev_market = {**prev["market"], "shares": snapshot["market"]["shares"]}
            v1 = recompute(prev["assumptions"], prev_market)          # new data only
            v2 = recompute(snapshot["assumptions"], prev_market)      # + new assumptions
            bridge = []
            if v1 is not None and v2 is not None:
                bridge = [
                    {"label": "Nouvelles données financières", "delta": v1 - v0},
                    {"label": "Hypothèses modifiées", "delta": v2 - v1},
                    {"label": "Paramètres de marché (taux sans risque, bêta, poids)", "delta": v3 - v2},
                ]
            main = max(bridge, key=lambda b: abs(b["delta"]))["label"] if bridge else "—"
            events.append({
                "id": _eid(ticker, "valuation", today, round(v3, 2)), "date": today, "ticker": ticker,
                "type": "valuation",
                "title": f"{ticker} : valeur DCF {fr(v0)} $ → {fr(v3)} $ ({frp(chg)})",
                "detail": (f"Moteur principal : {main}. Cours {fr(snapshot['price'])} $, potentiel "
                           f"{frp(v3 / snapshot['price'] - 1)}.") if snapshot.get("price") else "",
                "bridge": [{**b, "delta": round(b["delta"], 4)} for b in bridge],
                "values": {"from": v0, "to": v3, "change": chg, "price": snapshot.get("price")},
            })

        # price crossing the value
        if prev.get("price") and snapshot.get("price"):
            up_prev = prev["value_base"] - prev["price"]
            up_now = snapshot["value_base"] - snapshot["price"]
            if up_prev * up_now < 0:
                above = up_now < 0
                events.append({
                    "id": _eid(ticker, "cross", today), "date": today, "ticker": ticker, "type": "cross",
                    "title": f"{ticker} : le cours passe {'au-dessus' if above else 'en dessous'} de la valeur DCF",
                    "detail": f"Cours {fr(snapshot['price'])} $ vs valeur DCF {fr(snapshot['value_base'])} $.",
                    "values": {"price": snapshot["price"], "value": snapshot["value_base"]},
                })

    # ---- big daily move
    if perf.get("chg_1d") is not None and abs(perf["chg_1d"]) >= PRICE_EVENT_THRESHOLD:
        events.append({
            "id": _eid(ticker, "price", perf["date"]), "date": perf["date"], "ticker": ticker, "type": "price",
            "title": f"{ticker} {frp(perf['chg_1d'])} sur la séance",
            "detail": f"Clôture à {fr(perf['last'])} $.", "values": {"change": perf["chg_1d"], "close": perf["last"]},
        })

    # ---- persist snapshot (one per day; a re-run the same day replaces it)
    snaps = [s for s in snaps if s["date"] != today] + [{"date": today, **snapshot}]
    store = {"snapshots": snaps[-2000:], "seen_filings": sorted(seen)}
    hist_path.parent.mkdir(parents=True, exist_ok=True)
    hist_path.write_text(json.dumps(store, separators=(",", ":"), default=str))
    return events


def merge_feed(feed_path: Path, new_events: list[dict], cap: int = 400) -> list[dict]:
    feed = load_json(feed_path, {"events": []})["events"]
    ids = {e["id"] for e in feed}
    feed += [e for e in new_events if e["id"] not in ids]
    feed.sort(key=lambda e: (e["date"], e["type"] != "valuation"), reverse=True)
    feed = feed[:cap]
    feed_path.write_text(json.dumps({"events": feed, "updated": date.today().isoformat()},
                                    ensure_ascii=False, indent=1, default=str))
    return feed
