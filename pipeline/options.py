"""Listed options: implied volatility, term structure, smile, open interest, implied earnings move.

Data: Yahoo option chains via yfinance (delayed, free). Yahoo's own IV column is noisy on illiquid
strikes, so implied volatility is recomputed here from the bid/ask mid with Black-Scholes
(no dividend: NVIDIA's yield is ~0.5 %, a negligible bias; American exercise is ignored, which is
standard for liquid calls and slightly understates deep in-the-money put values).

Implied earnings move
---------------------
* Straddle move: ATM call + ATM put for the first expiry after the earnings date, divided by spot.
  It is the market price of the total move up to that expiry (earnings + normal days).
* Earnings shock: the variance of the post-earnings expiry minus the "normal" variance measured on
  the expiry just before earnings:  sigma_e^2 = T2 * (iv2^2 - iv1^2). Expected absolute move on the
  day = sigma_e * sqrt(2 / pi). This isolates what the market prices for the announcement itself.
"""
from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone

SQRT2PI = math.sqrt(2 * math.pi)


# --------------------------------------------------------------------------- Black-Scholes
def _ncdf(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def bs_price(S, K, T, r, sigma, call=True):
    if T <= 0 or sigma <= 0:
        return max(0.0, (S - K) if call else (K - S))
    d1 = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    if call:
        return S * _ncdf(d1) - K * math.exp(-r * T) * _ncdf(d2)
    return K * math.exp(-r * T) * _ncdf(-d2) - S * _ncdf(-d1)


def bs_delta(S, K, T, r, sigma, call=True):
    if T <= 0 or sigma <= 0:
        return (1.0 if S > K else 0.0) if call else (-1.0 if S < K else 0.0)
    d1 = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * math.sqrt(T))
    return _ncdf(d1) if call else _ncdf(d1) - 1


def implied_vol(price, S, K, T, r, call=True) -> float | None:
    """Bisection on [1 %, 500 %]. None when the price is outside no-arbitrage bounds."""
    if price is None or price <= 0 or T <= 0:
        return None
    intrinsic = max(0.0, (S - K * math.exp(-r * T)) if call else (K * math.exp(-r * T) - S))
    if price <= intrinsic + 1e-6 or price >= (S if call else K):
        return None
    lo, hi = 0.01, 5.0
    for _ in range(100):
        mid = (lo + hi) / 2
        if bs_price(S, K, T, r, mid, call) > price:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2


# --------------------------------------------------------------------------- fetching
def fetch_raw(sym: str, max_expiries: int = 12) -> dict:
    """Raw chains: {'expirations': [...], 'chains': {exp: {'calls': [...], 'puts': [...]}}}."""
    import yfinance as yf
    t = yf.Ticker(sym)
    exps = list(t.options or [])
    if not exps:
        raise RuntimeError("aucune échéance d'options")
    chosen = _choose_expiries(exps, max_expiries)
    chains = {}
    cols = ("strike", "bid", "ask", "lastPrice", "volume", "openInterest", "impliedVolatility")
    for e in chosen:
        oc = t.option_chain(e)
        chains[e] = {side: [{c: _f(row.get(c)) for c in cols}
                            for row in getattr(oc, side).to_dict("records")] for side in ("calls", "puts")}
    return {"expirations": exps, "chains": chains}


def _choose_expiries(exps: list[str], n: int) -> list[str]:
    """All expiries within ~45 days (weeklies around earnings), then spread out to ~1 year."""
    today = date.today()
    ds = [(e, (date.fromisoformat(e) - today).days) for e in exps]
    near = [e for e, d in ds if d <= 45]
    far = [e for e, d in ds if 45 < d <= 400]
    picked = near[:8]
    room = max(0, n - len(picked))
    if far and room:
        step = max(1, len(far) // room)
        picked += far[::step][:room]
    return sorted(set(picked))


def _f(x):
    try:
        v = float(x)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


# --------------------------------------------------------------------------- analysis
def _year_frac(exp: str, now: datetime) -> float:
    # options stop trading at 16:00 New York ≈ 20:00/21:00 UTC; 20:30 UTC is close enough
    t_exp = datetime.combine(date.fromisoformat(exp), datetime.min.time(), tzinfo=timezone.utc) + timedelta(hours=20.5)
    return max((t_exp - now).total_seconds() / (365.0 * 86400), 1 / 365 / 24)


def _mid(row):
    b, a = row.get("bid"), row.get("ask")
    if b and a and a >= b > 0:
        return (a + b) / 2
    return row.get("lastPrice") or None


def analyze(raw: dict, spot: float, rf: float, now: datetime | None = None,
            earnings_date: str | None = None, band: float = 0.3) -> dict:
    now = now or datetime.now(timezone.utc)
    expiries, chains = [], {}
    tot = {"call_oi": 0.0, "put_oi": 0.0, "call_vol": 0.0, "put_vol": 0.0}
    for exp in sorted(raw["chains"]):
        T = _year_frac(exp, now)
        ch = raw["chains"][exp]
        by_k: dict[float, dict] = {}
        for side, call in (("calls", True), ("puts", False)):
            for row in ch.get(side) or []:
                K = row.get("strike")
                if not K:
                    continue
                m = _mid(row)
                iv = implied_vol(m, spot, K, T, rf, call) if m else None
                if iv is None and row.get("impliedVolatility") and row["impliedVolatility"] > 0.02:
                    iv = row["impliedVolatility"]  # fallback: Yahoo's IV
                p = "c" if call else "p"
                d = by_k.setdefault(K, {"strike": K})
                d.update({f"{p}_bid": row.get("bid"), f"{p}_ask": row.get("ask"), f"{p}_mid": m, f"{p}_iv": iv,
                          f"{p}_oi": row.get("openInterest") or 0, f"{p}_vol": row.get("volume") or 0,
                          f"{p}_delta": bs_delta(spot, K, T, rf, iv, call) if iv else None})
                tot[f"{'call' if call else 'put'}_oi"] += row.get("openInterest") or 0
                tot[f"{'call' if call else 'put'}_vol"] += row.get("volume") or 0
        rows = [by_k[k] for k in sorted(by_k)]
        atm_iv = _atm_iv(rows, spot)
        k_atm = min(rows, key=lambda r: abs(r["strike"] - spot))["strike"] if rows else None
        atm = by_k.get(k_atm, {})
        straddle = (atm.get("c_mid") or 0) + (atm.get("p_mid") or 0) if atm.get("c_mid") and atm.get("p_mid") else None
        expiries.append({
            "date": exp, "dte": round(T * 365, 1), "T": T, "atm_iv": atm_iv, "atm_strike": k_atm,
            "straddle": straddle, "implied_move": straddle / spot if straddle else None,
            "call_oi": sum(r.get("c_oi", 0) for r in rows), "put_oi": sum(r.get("p_oi", 0) for r in rows),
            "call_vol": sum(r.get("c_vol", 0) for r in rows), "put_vol": sum(r.get("p_vol", 0) for r in rows),
        })
        chains[exp] = [r for r in rows if (1 - band) * spot <= r["strike"] <= (1 + band) * spot]
    out = {"asof": now.isoformat(timespec="seconds"), "spot": spot, "rf": rf, "expiries": expiries, "chains": chains,
           "put_call_oi": tot["put_oi"] / tot["call_oi"] if tot["call_oi"] else None,
           "put_call_volume": tot["put_vol"] / tot["call_vol"] if tot["call_vol"] else None,
           "iv30": _interp_iv(expiries, 30), "iv90": _interp_iv(expiries, 90)}
    out["earnings"] = earnings_move(expiries, earnings_date) if earnings_date else None
    return out


def _atm_iv(rows: list[dict], spot: float) -> float | None:
    """Average call/put IV, linearly interpolated between the two strikes around spot."""
    def iv(r):
        v = [x for x in (r.get("c_iv"), r.get("p_iv")) if x]
        return sum(v) / len(v) if v else None
    below = [r for r in rows if r["strike"] <= spot and iv(r)]
    above = [r for r in rows if r["strike"] >= spot and iv(r)]
    if not below or not above:
        cands = [r for r in rows if iv(r)]
        return iv(min(cands, key=lambda r: abs(r["strike"] - spot))) if cands else None
    a, b = below[-1], above[0]
    if a["strike"] == b["strike"]:
        return iv(a)
    w = (spot - a["strike"]) / (b["strike"] - a["strike"])
    return iv(a) * (1 - w) + iv(b) * w


def _interp_iv(expiries: list[dict], days: float) -> float | None:
    """Constant-maturity IV by linear interpolation of total variance."""
    pts = [(e["dte"], e["atm_iv"]) for e in expiries if e["atm_iv"]]
    if not pts:
        return None
    if days <= pts[0][0]:
        return pts[0][1]
    if days >= pts[-1][0]:
        return pts[-1][1]
    for (d1, v1), (d2, v2) in zip(pts, pts[1:]):
        if d1 <= days <= d2:
            w1, w2 = v1 * v1 * d1, v2 * v2 * d2
            w = w1 + (w2 - w1) * (days - d1) / (d2 - d1)
            return math.sqrt(w / days)
    return None


def earnings_move(expiries: list[dict], earnings_date: str) -> dict | None:
    ed = date.fromisoformat(earnings_date)
    # results after the close -> the first expiry that captures the reaction is strictly after the date
    after = [e for e in expiries if date.fromisoformat(e["date"]) > ed and e["atm_iv"]]
    before = [e for e in expiries if date.fromisoformat(e["date"]) <= ed and e["atm_iv"]]
    if not after:
        return None
    e2 = after[0]
    res = {"date": earnings_date, "expiry": e2["date"], "straddle_move": e2["implied_move"]}
    if before:
        e1 = before[-1]
        var_e = e2["T"] * (e2["atm_iv"] ** 2 - e1["atm_iv"] ** 2)
        if var_e > 0:
            sd = math.sqrt(var_e)
            res.update({"shock_sd": sd, "shock_expected_abs": sd * math.sqrt(2 / math.pi),
                        "base_expiry": e1["date"], "base_iv": e1["atm_iv"], "event_iv": e2["atm_iv"]})
    return res


def earnings_reactions(filings: list[dict], bars: list[dict], n: int = 12) -> list[dict]:
    """Share price reaction around past results (8-K item 2.02): close of the day before the
    filing -> close of the trading day after it (2 sessions, covers both pre-open and post-close releases)."""
    days = [b["t"] for b in bars]
    out = []
    for f in filings:
        if f.get("form") != "8-K" or "2.02" not in (f.get("items") or ""):
            continue
        d = f["filed"]
        i = next((k for k, t in enumerate(days) if t >= d), None)
        if i is None or i < 1 or i + 1 >= len(days):
            continue
        p0, p1 = bars[i - 1]["c"], bars[i + 1]["c"]
        out.append({"date": d, "from": days[i - 1], "to": days[i + 1], "move": p1 / p0 - 1})
        if len(out) >= n:
            break
    return out


# --------------------------------------------------------------------------- synthetic (tests / offline preview)
def synthetic_raw(spot: float, rf: float, today: date, earnings_date: str | None = None) -> dict:
    """Fake but internally consistent chains (skewed smile, earnings bump) for offline testing."""
    exps, d = [], today
    while len(exps) < 12:
        d += timedelta(days=1)
        if d.weekday() == 4 and ((d - today).days <= 45 or d.day <= 7 or len(exps) < 8):
            exps.append(d.isoformat())
    chains = {}
    ed = date.fromisoformat(earnings_date) if earnings_date else None
    now = datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc) + timedelta(hours=14)
    for e in exps:
        T = _year_frac(e, now)
        base = 0.42 + 0.04 * math.exp(-T * 6)
        if ed and date.fromisoformat(e) > ed:
            base = math.sqrt(base ** 2 + 0.07 ** 2 / T)  # one earnings shock of ~7 %
        calls, puts = [], []
        k = round(spot * 0.6 / 5) * 5
        while k <= spot * 1.5:
            m = math.log(k / spot)
            iv = base * (1 - 0.35 * m + 0.9 * m * m)
            for lst, call in ((calls, True), (puts, False)):
                pr = bs_price(spot, k, T, rf, iv, call)
                oi = int(20000 * math.exp(-abs(m) * 8) * (1.3 if (k % 50 == 0) else 1))
                lst.append({"strike": float(k), "bid": round(pr * 0.98, 2), "ask": round(pr * 1.02 + 0.01, 2),
                            "lastPrice": round(pr, 2), "volume": oi // 7, "openInterest": oi,
                            "impliedVolatility": iv})
            k += 5
        chains[e] = {"calls": calls, "puts": puts}
    return {"expirations": exps, "chains": chains}
