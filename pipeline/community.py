"""Members' space: sync the daily pipeline with the Supabase database.

Runs only when SUPABASE_URL and SUPABASE_SERVICE_KEY are set (GitHub secrets). Uses the PostgREST
API with the service key (bypasses row-level security; never exposed to the browser).

Each run:
  1. periods        next quarter (expected release, deadline) + recent reported quarters (actual release)
  2. latest_prices  last close of every tracked symbol (the tradable universe of paper portfolios)
  3. orders         pending orders filled at the first close AFTER the order (never a known price)
  4. predictions    members' predictions resolved against SEC figures, from the version recorded
                    before the FINAL deadline (prediction_history), with naive / guidance / analysts /
                    community benchmarks and auto-resolved yes/no questions (Brier)
  5. crowd          community consensus per metric once the deadline has passed
  6. portfolios     daily value of every paper portfolio
"""
from __future__ import annotations

import math
import os
import re
import statistics
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

from . import http
from . import predictions as P

QUESTIONS = {
    "rev_above_guidance_high": "CA au-dessus du haut de la fourchette de guidance",
    "rev_above_analysts": "CA au-dessus du consensus des analystes",
    "rev_above_crowd": "CA au-dessus du consensus de la communauté",
    "gm_above_guidance": "Marge brute au-dessus de la guidance",
    "price_up_after": "Cours en hausse après la publication (veille → lendemain)",
}
MARKET_CLOSE_NY = time(16, 0)


# --------------------------------------------------------------------------- REST client
def clean_key(raw: str) -> str:
    """API keys never contain whitespace: drop stray spaces / line breaks from a pasted secret, and keep
    only the key itself if a label was copied with it (e.g. "backend_api sb_secret_...")."""
    joined = "".join((raw or "").split()).strip("\"'`")
    m = re.search(r"(sb_secret_[A-Za-z0-9_\-]+|eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+)", joined)
    return m.group(1) if m else joined


def describe_key(raw: str) -> str:
    """Shape of the secret, safe to print in public logs (never the value)."""
    raw = raw or ""
    k = clean_key(raw)
    kind = "sb_secret_" if k.startswith("sb_secret_") else "JWT (ancienne clé)" if k.startswith("eyJ") else \
        "sb_publishable_ (clé PUBLIQUE, pas la secrète !)" if k.startswith("sb_publishable_") else "préfixe inconnu"
    notes = []
    if any(c.isspace() for c in raw.strip()):
        notes.append("espaces / retours à la ligne internes retirés")
    if raw != raw.strip():
        notes.append("espaces en début / fin retirés")
    if "•" in raw or "*" in raw:
        notes.append("contient des caractères masqués (•) : la clé a été recopiée depuis l'affichage masqué")
    if not k.isascii():
        notes.append("caractères non ASCII")
    return f"{kind}, {len(k)} caractères" + (f" ({'; '.join(notes)})" if notes else "")


def public_url(path: Path | None = None) -> str:
    """supabaseUrl from docs/assets/config.js (public by design)."""
    path = path or Path(__file__).resolve().parent.parent / "docs" / "assets" / "config.js"
    try:
        m = re.search(r'supabaseUrl\s*:\s*"([^"]*)"', path.read_text())
    except OSError:
        return ""
    return m.group(1).strip() if m else ""


class Supa:
    def __init__(self, url: str, key: str):
        self.base = url.rstrip("/") + "/rest/v1"
        self.headers = {"apikey": key, "Content-Type": "application/json"}
        if key.startswith("eyJ"):  # legacy JWT service_role key
            self.headers["Authorization"] = f"Bearer {key}"

    @classmethod
    def from_env(cls):
        """Service client from SUPABASE_SERVICE_KEY (GitHub secret) and the project URL, taken from
        SUPABASE_URL or, failing that, from the public site config (docs/assets/config.js)."""
        key = clean_key(os.environ.get("SUPABASE_SERVICE_KEY", ""))
        url = os.environ.get("SUPABASE_URL", "").strip() or public_url()
        return cls(url, key) if url and key else None

    def select(self, table: str, params: dict | None = None) -> list[dict]:
        out, start, step = [], 0, 1000
        while True:
            r = http.session().get(f"{self.base}/{table}", params={"select": "*", **(params or {})},
                                   headers={**self.headers, "Range-Unit": "items", "Range": f"{start}-{start + step - 1}"},
                                   timeout=60)
            r.raise_for_status()
            rows = r.json()
            out += rows
            if len(rows) < step:
                return out
            start += step

    def upsert(self, table: str, rows: list[dict], on_conflict: str) -> None:
        for i in range(0, len(rows), 500):
            r = http.session().post(f"{self.base}/{table}", params={"on_conflict": on_conflict},
                                    json=rows[i:i + 500], timeout=60,
                                    headers={**self.headers, "Prefer": "resolution=merge-duplicates,return=minimal"})
            if r.status_code >= 400:
                raise RuntimeError(f"upsert {table}: {r.status_code} {r.text[:300]}")

    def rpc(self, fn: str, args: dict):
        r = http.session().post(f"{self.base}/rpc/{fn}", json=args, headers=self.headers, timeout=60)
        if r.status_code >= 400:
            raise RuntimeError(f"rpc {fn}: {r.status_code} {r.text[:300]}")
        return r.json() if r.content else None


# --------------------------------------------------------------------------- helpers
def _ts(s) -> datetime:
    if isinstance(s, datetime):
        return s if s.tzinfo else s.replace(tzinfo=timezone.utc)
    return datetime.fromisoformat(str(s).replace("Z", "+00:00"))


def fill_bar(bars: list[dict], created_at: datetime) -> dict | None:
    """First daily bar whose close was unknown when the order was placed."""
    ny = created_at.astimezone(P.NY)
    d = ny.date().isoformat()
    before_close = ny.time() < MARKET_CLOSE_NY
    for b in bars:
        if b["t"] > d or (b["t"] == d and before_close):
            return b
    return None


def option_rows(ticker: str, opt: dict, quote_date: str, evening: bool, now: datetime) -> list[dict]:
    """Flatten the analysed chain (options.analyze) into one row per contract for option_quotes."""
    rows = []
    for exp, chain in (opt.get("chains") or {}).items():
        for r in chain:
            for p, typ in (("c", "C"), ("p", "P")):
                mid = r.get(f"{p}_mid")
                if not mid and not r.get(f"{p}_ask"):
                    continue
                rows.append({"ticker": ticker, "expiry": exp, "strike": r["strike"], "type": typ,
                             "bid": r.get(f"{p}_bid") or None, "ask": r.get(f"{p}_ask") or None, "mid": mid,
                             "iv": r.get(f"{p}_iv"), "underlying": opt.get("spot"), "quote_date": quote_date,
                             "quoted_at": now.isoformat(), "evening": evening})
    return rows


def option_fill_price(q: dict, side: str) -> float | None:
    """Buy at the ask, sell at the bid (the spread is a real cost); mid only if no quote on that side."""
    v = q.get("ask") if side == "buy" else q.get("bid")
    if v and v > 0:
        return float(v)
    return float(q["mid"]) if q.get("mid") and q["mid"] > 0 else None


def _sync_options(client, chains: dict, bars: dict, now: datetime):
    ny = now.astimezone(P.NY)
    today = ny.date().isoformat()
    quotes: dict[tuple, dict] = {}
    n_quotes = 0
    for t, opt in chains.items():
        trading_day = bool(bars.get(t)) and bars[t][-1]["t"] == today
        evening = trading_day and ny.time() >= MARKET_CLOSE_NY and ny.weekday() < 5
        rows = option_rows(t, opt, today, evening, now)
        for i in range(0, len(rows), 500):
            client.upsert("option_quotes", rows[i:i + 500], "ticker,expiry,strike,type")
        n_quotes += len(rows)
        for r in rows:
            quotes[(t, r["expiry"], float(r["strike"]), r["type"])] = r
    # fills: only with an evening snapshot, for orders placed before that session's close
    evening_tickers = {k[0] for k, v in quotes.items() if v["evening"]}
    filled = rejected = waiting = 0
    for o in client.select("option_orders", {"status": "eq.pending", "order": "id.asc"}):
        created = _ts(o["created_at"]).astimezone(P.NY)
        cd = created.date().isoformat()
        if o["ticker"] not in evening_tickers or not (cd < today or (cd == today and created.time() < MARKET_CLOSE_NY)):
            waiting += 1
            continue
        q = quotes.get((o["ticker"], str(o["expiry"]), float(o["strike"]), o["type"]))
        price = option_fill_price(q, o["side"]) if q else None       # no quote tonight: rejected
        res = client.rpc("fill_option_order", {"p_order": o["id"], "p_price": price, "p_date": today}) or {}
        if res.get("status") == "filled":
            filled += 1
        else:
            rejected += 1
    # expiries: settle at intrinsic value with the underlying's close on the expiry date
    trades = client.select("option_trades")
    settled = 0
    for t, exp in sorted({(tr["ticker"], str(tr["expiry"])) for tr in trades}):
        b = bars.get(t) or []
        if not b or b[-1]["t"] < exp:
            continue                                        # expiry close not known yet
        close = [x for x in b if x["t"] <= exp][-1]["c"]
        settled += client.rpc("settle_expired_options", {"p_ticker": t, "p_expiry": exp, "p_underlying": close}) or 0
    if settled:
        trades = client.select("option_trades")
    # marks for portfolio values: quote mid, else intrinsic value
    pos: dict[tuple, int] = {}
    for tr in trades:
        k = (tr["portfolio_id"], tr["ticker"], str(tr["expiry"]), float(tr["strike"]), tr["type"])
        pos[k] = pos.get(k, 0) + (tr["qty"] if tr["side"] == "buy" else -tr["qty"])
    marks = {}
    for k, q in pos.items():
        if q <= 0:
            continue
        _, t, exp, strike, typ = k
        quote = quotes.get((t, exp, strike, typ))
        if quote and quote.get("mid"):
            mark = float(quote["mid"])
        else:
            s_ = (bars.get(t) or [{}])[-1].get("c") or 0
            mark = max(0.0, (s_ - strike) if typ == "C" else (strike - s_))
        marks[k] = (q, mark)
    return {"quotes": n_quotes, "filled": filled, "rejected": rejected, "waiting": waiting, "settled": settled}, marks


def _quantiles(xs: list[float]) -> dict:
    xs = sorted(xs)
    n = len(xs)
    if n == 0:
        return {}
    q = statistics.quantiles(xs, n=4, method="inclusive") if n >= 2 else [xs[0]] * 3
    return {"n": n, "median": statistics.median(xs), "mean": sum(xs) / n, "p25": q[0], "p75": q[2]}


def _price_reaction(bars: list[dict], release: date) -> float | None:
    days = [b["t"] for b in bars]
    d = release.isoformat()
    i = next((k for k, t in enumerate(days) if t >= d), None)
    if i is None or i < 1 or i + 1 >= len(days):
        return None
    return bars[i + 1]["c"] / bars[i - 1]["c"] - 1


# --------------------------------------------------------------------------- main
def sync(client, *, fins: dict, filings: dict, bars: dict, guidance: dict, consensus: dict,
         next_earnings: dict, names: dict, now: datetime | None = None, families: dict | None = None,
         option_chains: dict | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    summary = {}

    # 1. periods ----------------------------------------------------------------------------
    period_rows = []
    for t, fin in fins.items():
        for p in fin["periods"]["quarterly"][-6:]:
            rel = P.release_date(fin, filings.get(t, []), p["label"])
            period_rows.append({"ticker": t, "period": p["label"], "period_end": p["end"], "expected_release": None,
                                "release_date": rel.isoformat() if rel else None,
                                "deadline": P.deadline_for(rel).isoformat() if rel else None,
                                "estimated": False, "status": "closed" if rel else "open",
                                "updated_at": now.isoformat()})
        ne, nq = next_earnings.get(t) or {}, P.next_quarter(fin)
        if nq and ne.get("period") == nq["label"]:
            period_rows.append({"ticker": t, "period": nq["label"], "period_end": nq["end_estimate"],
                                "expected_release": ne.get("date"), "release_date": None,
                                "deadline": ne.get("deadline"), "estimated": bool(ne.get("estimated", True)),
                                "status": "open", "updated_at": now.isoformat()})
    if period_rows:
        client.upsert("periods", period_rows, "ticker,period")
    summary["periods"] = len(period_rows)

    # 2. latest prices ----------------------------------------------------------------------
    families = families or {}
    price_rows = [{"ticker": s, "name": names.get(s, s), "family": families.get(s), "close": b[-1]["c"], "price_date": b[-1]["t"],
                   "updated_at": now.isoformat()} for s, b in bars.items() if b]
    if price_rows:
        client.upsert("latest_prices", price_rows, "ticker")
    summary["prices"] = len(price_rows)

    # 3. pending orders ---------------------------------------------------------------------
    filled = rejected = waiting = 0
    for o in client.select("orders", {"status": "eq.pending", "order": "id.asc"}):
        b = fill_bar(bars.get(o["ticker"]) or [], _ts(o["created_at"]))
        if b is None:
            waiting += 1
            continue
        res = client.rpc("fill_order", {"p_order": o["id"], "p_price": b["c"], "p_date": b["t"]}) or {}
        if res.get("status") == "filled":
            filled += 1
        else:
            rejected += 1
    summary["orders"] = {"filled": filled, "rejected": rejected, "waiting": waiting}

    # 3b. options: quotes, fills at the evening snapshot, expiries ---------------------------
    opt_marks: dict[tuple, float] = {}
    try:
        summary["options"], opt_marks = _sync_options(client, option_chains or {}, bars, now)
    except Exception as exc:  # noqa: BLE001 - database without migration 0005 yet
        summary["options"] = f"indisponible ({str(exc)[:80]})"

    # 4-5. predictions & community consensus -------------------------------------------------
    preds = client.select("predictions")
    history = client.select("prediction_history", {"order": "recorded_at.asc"})
    by_pred: dict[str, list] = {}
    for h in history:
        by_pred.setdefault(h["prediction_id"], []).append(h)
    periods = {(r["ticker"], r["period"]): r for r in client.select("periods")}

    groups: dict[tuple, list] = {}
    for p in preds:
        groups.setdefault((p["ticker"], p["period"]), []).append(p)

    results, crowd_rows = [], []
    for (t, label), plist in groups.items():
        per = periods.get((t, label)) or {}
        deadline = _ts(per["deadline"]) if per.get("deadline") else None
        if deadline is None or now < deadline:
            continue  # still open: nothing revealed, nothing scored
        fin = fins.get(t)
        valid = {}
        for p in plist:
            snaps = [h for h in by_pred.get(p["id"], []) if _ts(h["recorded_at"]) < deadline]
            if snaps:
                valid[p["id"]] = snaps[-1]["snapshot"]
        # community consensus per metric (raw units), from versions recorded before the deadline
        crowd = {}
        for k in P.METRICS:
            vals = [P.to_raw(k, (s.get("metrics") or {}).get(k, {}).get("value")) for s in valid.values()]
            vals = [v for v in vals if v is not None]
            if vals:
                crowd[k] = _quantiles(vals)
                crowd_rows.append({"ticker": t, "period": label, "metric": k, **crowd[k], "computed_at": now.isoformat()})
        rel = date.fromisoformat(per["release_date"]) if per.get("release_date") else None
        if not rel or fin is None or P.period_end(fin, label) is None:
            continue  # deadline passed but figures not published yet
        gd = (guidance.get(t) or {}).get(label, {})
        analysts = P._frozen_consensus(consensus.get(t) or [], label, rel)
        reaction = _price_reaction(bars.get(t) or [], rel)
        for p in plist:
            snap = valid.get(p["id"])
            if snap is None:
                results.append({"prediction_id": p["id"], "user_id": p["user_id"], "ticker": t, "period": label,
                                "status": "late", "results": {}, "score": {}, "resolved_at": now.isoformat()})
                continue
            others = [s for pid, s in valid.items() if pid != p["id"]]
            res, score = _score(snap, others, fin, label, gd, analysts, crowd, reaction, bars.get(t) or [])
            used_at = max(_ts(h["recorded_at"]) for h in by_pred[p["id"]] if _ts(h["recorded_at"]) < deadline)
            results.append({"prediction_id": p["id"], "user_id": p["user_id"], "ticker": t, "period": label,
                            "status": res.pop("_status"), "scored_version_at": used_at.isoformat(),
                            "results": res, "score": score, "resolved_at": now.isoformat()})
    if crowd_rows:
        client.upsert("crowd_consensus", crowd_rows, "ticker,period,metric")
    if results:
        client.upsert("prediction_results", results, "prediction_id")
    summary["predictions"] = {"total": len(preds), "scored": len(results), "crowd_metrics": len(crowd_rows)}

    # 6. portfolio values -------------------------------------------------------------------
    pfs = client.select("portfolios")
    trades = client.select("trades")
    last = {s: b[-1]["c"] for s, b in bars.items() if b}
    rows = []
    for pf in pfs:
        pos: dict[str, float] = {}
        for tr in trades:
            if tr["portfolio_id"] == pf["id"]:
                q = float(tr["qty"])
                pos[tr["ticker"]] = pos.get(tr["ticker"], 0.0) + (q if tr["side"] == "buy" else -q)
        value = float(pf["cash"]) + sum(q * last.get(s, 0.0) for s, q in pos.items())
        value += sum(100 * q * mark for (pid, *_c), (q, mark) in opt_marks.items() if pid == pf["id"])
        rows.append({"portfolio_id": pf["id"], "date": now.date().isoformat(), "value": round(value, 2),
                     "cash": float(pf["cash"]), "spy_close": last.get("SPY")})   # benchmark for « Alpha »
    if rows:
        client.upsert("portfolio_values", rows, "portfolio_id,date")
    summary["portfolios"] = len(rows)

    # 7. achievements earned from verified results and portfolio values (each one notifies its holder)
    try:
        summary["badges"] = client.rpc("grant_auto_badges", {})
    except Exception as exc:  # noqa: BLE001 - database without migration 0002 yet
        summary["badges"] = f"indisponible ({str(exc)[:80]})"
    return summary


def _score(snap, others, fin, label, gd, analysts, crowd, reaction, bars):
    """Resolve one member's prediction (snapshot recorded before the deadline)."""
    res = {"metrics": [], "questions": [], "price_targets": []}
    score = {"interval_n": 0, "interval_hit": 0, "brier_sum": 0.0, "brier_n": 0}
    done = True
    for k, spec in (snap.get("metrics") or {}).items():
        if k not in P.METRICS:
            continue
        pred, lo, hi = (P.to_raw(k, spec.get(f)) for f in ("value", "low", "high"))
        act = P.actual(fin, label, k)
        m = {"key": k, "label": P.METRICS[k][0], "unit": P.METRICS[k][1], "kind": P.METRICS[k][3],
             "value": pred, "low": lo, "high": hi, "actual": act}
        if act is None or pred is None:
            done = False
            res["metrics"].append(m)
            continue
        e = P._err(k, pred, act)
        m.update({x: v for x, v in e.items() if x != "value"})
        if lo is not None and hi is not None:
            m["in_interval"] = lo <= act <= hi
            score["interval_n"] += 1
            score["interval_hit"] += int(m["in_interval"])
        loo = [P.to_raw(k, (o.get("metrics") or {}).get(k, {}).get("value")) for o in others]
        loo = [v for v in loo if v is not None]
        bench = {"naive": P.naive(fin, label, k),
                 "guidance": P.to_raw(k, gd.get(k)) if gd.get(k) is not None else None,
                 "analysts": analysts.get("revenue_avg") if (analysts and k == "revenue") else None,
                 "crowd": statistics.median(loo) if len(loo) >= 2 else None}
        m["benchmarks"] = {b: v for b, v in bench.items() if v is not None}
        m["vs"] = {}
        for b, bv in m["benchmarks"].items():
            be = P._err(k, bv, act)
            m["vs"][b] = {"error": be.get("error_pct", be.get("error_pts")), "abs": be["abs"],
                          "you_win": e["abs"] < be["abs"]}
        if k == "revenue":
            score["rev_abs_err"] = e["abs"]
            score["rev_err"] = e["error_pct"]
            for b in ("crowd", "analysts", "naive"):
                if b in m["vs"]:
                    score[f"beat_{b}"] = m["vs"][b]["you_win"]
        res["metrics"].append(m)

    act_rev, act_gm = P.actual(fin, label, "revenue"), P.actual(fin, label, "gross_margin")
    crowd_rev = (crowd.get("revenue") or {}).get("median")
    for q in snap.get("questions") or []:
        qid, p = q.get("id"), q.get("p")
        outcome = None
        if qid == "rev_above_guidance_high" and act_rev is not None and gd.get("revenue_high") is not None:
            outcome = act_rev > float(gd["revenue_high"]) * 1e9
        elif qid == "rev_above_analysts" and act_rev is not None and analysts and analysts.get("revenue_avg"):
            outcome = act_rev > analysts["revenue_avg"]
        elif qid == "rev_above_crowd" and act_rev is not None and crowd_rev is not None:
            outcome = act_rev > crowd_rev
        elif qid == "gm_above_guidance" and act_gm is not None and gd.get("gross_margin") is not None:
            outcome = act_gm > float(gd["gross_margin"]) / 100
        elif qid == "price_up_after" and reaction is not None:
            outcome = reaction > 0
        item = {"id": qid, "question": QUESTIONS.get(qid, qid), "p": p, "outcome": outcome}
        if outcome is not None and isinstance(p, (int, float)):
            item["brier"] = (p / 100 - (1.0 if outcome else 0.0)) ** 2
            score["brier_sum"] += item["brier"]
            score["brier_n"] += 1
        else:
            done = False
        res["questions"].append(item)

    for pt in snap.get("price_targets") or []:
        d = str(pt.get("date"))
        hit = next((b for b in bars if b["t"] >= d), None)
        item = {**pt, "actual": None}
        if hit and bars and d <= bars[-1]["t"]:
            v = P._num(pt.get("value"))
            item.update({"actual": hit["c"], "actual_date": hit["t"],
                         "error_pct": (v - hit["c"]) / hit["c"] if v is not None else None})
            lo, hi = P._num(pt.get("low")), P._num(pt.get("high"))
            if lo is not None and hi is not None:
                item["in_interval"] = lo <= hit["c"] <= hi
        else:
            done = False
        res["price_targets"].append(item)
    res["_status"] = "resolved" if done else "partial"
    score = {k: (round(v, 6) if isinstance(v, float) and math.isfinite(v) else v) for k, v in score.items()}
    return res, score
