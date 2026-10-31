"""Event feed + valuation history (the 'database' of the terminal).

Every run appends a dated snapshot to docs/data/<T>/history.json. Comparing the
new snapshot with the previous one produces feed events:

  * filing     - a new 10-K / 10-Q / results 8-K appeared on EDGAR
  * valuation  - the DCF value moved, with a bridge explaining *why*:
                   data effect        new financials, same assumptions, same market inputs
                   assumption effect  you edited config/assumptions/<T>.yaml
                   market effect      risk-free rate, beta, market-weighted cost of capital
  * price      - a daily move of ±5 % or more
  * cross      - the price crossed the DCF value (upside changed sign)
  * coverage   - first run for a ticker
"""
from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, timezone
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


def now_ts() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def close_ts(day: str) -> str:
    """US close (16:00 New York) of a session, in UTC - approximate, DST-aware enough for ordering."""
    m = int(day[5:7])
    return f"{day}T{'20' if 3 < m < 11 else '21'}:00:00Z"


def rel_change(v0: float, v1: float) -> float:
    """Relative change that keeps its sign when the base is negative (-116 -> -142 is -22 %)."""
    return (v1 - v0) / abs(v0) if v0 else 0.0


def update(*, ticker: str, today: str, hist_path: Path, snapshot: dict, filings: list[dict],
           perf: dict, recompute: Callable[[dict, dict], float | None], ts: str | None = None) -> list[dict]:
    """snapshot: {price, value_base, value_weighted, assumptions, assumptions_hash, market,
                  data_asof, latest_period}
    recompute(assumptions, market) -> value per share using the *current* financials."""
    store = load_json(hist_path, {"snapshots": [], "seen_filings": []})
    snaps = store["snapshots"]
    seen = set(store.get("seen_filings", []))
    events: list[dict] = []
    ts = ts or now_ts()
    prev = next((s for s in reversed(snaps) if s["date"] < today), None) or (snaps[-1] if snaps else None)

    if not snaps:
        events.append({
            "id": _eid(ticker, "coverage", today), "date": today, "ts": ts, "ticker": ticker, "type": "coverage",
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
                "ts": f.get("accepted") or f"{f['filed']}T12:00:00Z",
                "title": f"{ticker} a publié son {kind}",
                "detail": f"Période close le {f.get('report_date') or '-'}.",
                "url": f["url"], "values": {"form": f["form"], "accession": f["accession"]},
            })
    seen |= {f["accession"] for f in filings}

    # ---- valuation change + bridge
    if prev and prev.get("value_base") and snapshot.get("value_base"):
        v0, v3 = prev["value_base"], snapshot["value_base"]
        chg = rel_change(v0, v3)
        assump_changed = prev.get("assumptions_hash") != snapshot["assumptions_hash"]
        threshold = VALUE_EVENT_THRESHOLD_CAUSED if (filing_caused or assump_changed) else VALUE_EVENT_THRESHOLD
        label = "rNPV" if snapshot.get("method") == "rnpv" else "DCF"
        switched = (prev.get("method") or "dcf") != (snapshot.get("method") or "dcf")
        if switched:
            events.append({
                "id": _eid(ticker, "valuation", today), "date": today, "ts": ts, "ticker": ticker, "type": "valuation",
                "title": f"{ticker} : valorisation passée en {label} ({fr(v3)} $ par action)",
                "detail": (f"Changement de méthode (avant : {fr(v0)} $). Cours {fr(snapshot['price'])} $, potentiel "
                           f"{frp(v3 / snapshot['price'] - 1)}.") if snapshot.get("price") else "Changement de méthode.",
                "bridge": [], "values": {"from": v0, "to": v3, "change": chg, "price": snapshot.get("price"), "method": label},
            })
        elif abs(chg) >= threshold:
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
            main = max(bridge, key=lambda b: abs(b["delta"]))["label"] if bridge else "-"
            events.append({
                # one valuation event per ticker and day: a later run the same day replaces it
                "id": _eid(ticker, "valuation", today), "date": today, "ts": ts, "ticker": ticker,
                "type": "valuation",
                "title": f"{ticker} : valeur {label} {fr(v0)} $ → {fr(v3)} $ ({frp(chg)})",
                "detail": (f"Moteur principal : {main}. Cours {fr(snapshot['price'])} $, potentiel "
                           f"{frp(v3 / snapshot['price'] - 1)}.") if snapshot.get("price") and v3 > 0 else
                (f"Valeur {label} négative : le modèle ne capte pas cette société (pré-rentable ?)." if v3 <= 0 else ""),
                "bridge": [{**b, "delta": round(b["delta"], 4)} for b in bridge],
                "values": {"from": v0, "to": v3, "change": chg, "price": snapshot.get("price")},
            })

        # price crossing the value
        if prev.get("price") and snapshot.get("price") and not switched:
            up_prev = prev["value_base"] - prev["price"]
            up_now = snapshot["value_base"] - snapshot["price"]
            if up_prev * up_now < 0:
                above = up_now < 0
                events.append({
                    "id": _eid(ticker, "cross", today), "date": today, "ts": ts, "ticker": ticker, "type": "cross",
                    "title": f"{ticker} : le cours passe {'au-dessus' if above else 'en dessous'} de la valeur {label}",
                    "detail": f"Cours {fr(snapshot['price'])} $ vs valeur {label} {fr(snapshot['value_base'])} $.",
                    "values": {"price": snapshot["price"], "value": snapshot["value_base"]},
                })

    # ---- big daily move
    if perf.get("chg_1d") is not None and abs(perf["chg_1d"]) >= PRICE_EVENT_THRESHOLD:
        events.append({
            "id": _eid(ticker, "price", perf["date"]), "date": perf["date"], "ts": close_ts(perf["date"]),
            "ticker": ticker, "type": "price",
            "title": f"{ticker} {frp(perf['chg_1d'])} sur la séance",
            "detail": f"Clôture à {fr(perf['last'])} $.", "values": {"change": perf["chg_1d"], "close": perf["last"]},
        })

    # ---- persist snapshot (one per day; a re-run the same day replaces it)
    snaps = [s for s in snaps if s["date"] != today] + [{"date": today, **snapshot}]
    store = {"snapshots": snaps[-2000:], "seen_filings": sorted(seen)}
    hist_path.parent.mkdir(parents=True, exist_ok=True)
    hist_path.write_text(json.dumps(store, separators=(",", ":"), default=str))
    return events


def sort_key(e: dict) -> str:
    """Newest first by timestamp; events from before timestamps existed sort at noon of their day."""
    return e.get("ts") or f"{e['date']}T12:00:00Z"


def merge_feed(feed_path: Path, new_events: list[dict], cap: int = 400,
               accepted: dict[str, str] | None = None) -> list[dict]:
    """accepted: {accession: UTC acceptance time} to timestamp filing events written before timestamps existed."""
    feed = load_json(feed_path, {"events": []})["events"]
    for e in feed:
        if e.get("ts"):
            continue
        if e.get("type") == "price":
            e["ts"] = close_ts(e["date"])
        elif e.get("type") == "filing" and accepted and accepted.get((e.get("values") or {}).get("accession")):
            e["ts"] = accepted[e["values"]["accession"]]
    new_ids = {e["id"] for e in new_events}
    replaceable = {"valuation", "cross"}   # recomputed on every run: the newest version wins
    keep_old = []
    for e in feed:
        if e["id"] in new_ids and e["type"] in replaceable:
            continue
        keep_old.append(e)
    ids = {e["id"] for e in keep_old}
    feed = keep_old + [e for e in new_events if e["id"] not in ids]
    feed = dedupe_same_day_valuations(feed, _snapshot_values(feed_path.parent, feed))
    feed.sort(key=sort_key, reverse=True)
    feed = feed[:cap]
    feed_path.write_text(json.dumps({"events": feed, "updated": date.today().isoformat()},
                                    ensure_ascii=False, indent=1, default=str))
    return feed


def _snapshot_values(data_dir: Path, feed: list[dict]) -> dict[tuple, float]:
    """{(ticker, date): base DCF value kept in history.json} - the value that day ended with."""
    out = {}
    for tk in {e["ticker"] for e in feed if e.get("type") == "valuation"}:
        for snp in load_json(data_dir / tk / "history.json", {"snapshots": []}).get("snapshots", []):
            if snp.get("value_base") is not None:
                out[(tk, snp["date"])] = snp["value_base"]
    return out


def dedupe_same_day_valuations(feed: list[dict], final: dict | None = None) -> list[dict]:
    """Legacy clean-up: older runs wrote one valuation event per run. Keep one per ticker and day: the one
    matching the value the day ended with (history.json), else the last one written. The % is recomputed
    with a signed base."""
    final = final or {}
    best: dict[tuple, int] = {}
    for i, e in enumerate(feed):
        if e.get("type") != "valuation":
            continue
        k = (e["ticker"], e["date"])
        target = final.get(k)
        if k not in best or target is None:
            best[k] = i
        else:
            cur = feed[best[k]].get("values", {}).get("to")
            new = e.get("values", {}).get("to")
            if new is not None and (cur is None or abs(new - target) <= abs(cur - target)):
                best[k] = i
    out = []
    for i, e in enumerate(feed):
        if e.get("type") == "valuation" and best[(e["ticker"], e["date"])] != i:
            continue
        if e.get("type") == "valuation" and e.get("values", {}).get("from") is not None:
            v = e["values"]
            if v["from"] < 0 and v.get("to") is not None:
                chg = rel_change(v["from"], v["to"])
                e = {**e, "values": {**v, "change": chg},
                     "title": f"{e['ticker']} : valeur DCF {fr(v['from'])} $ → {fr(v['to'])} $ ({frp(chg)})"}
        out.append(e)
    return out
