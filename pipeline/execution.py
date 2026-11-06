"""Paper-trading execution model: how a member's order would really have been filled.

Daily bars only (open, high, low, close, volume), so the model works session by session:

  spread      not observed: estimated from dollar volume, the variable that explains most of the
              cross-section of quoted spreads (Amihud & Mendelson; Corwin & Schultz). Rule used here:
              spread_bps = 10 x (ADV$ / 10 M$)^-0.5, between 1 and 150 bp, never below one cent.
              10 M$ a day -> 10 bp, 1 Md$ -> 1 bp, 100 k$ -> 100 bp.
  impact      square-root law (Almgren et al. 2005; Toth et al. 2011):
              impact = Y x sigma_daily x sqrt(Q / V_day), Y = 0.5
  participation  an order takes at most 10 % of a session's volume; the rest waits for the next session
  market order   executes at the close of the first session whose close was unknown when it was placed,
                 buy at close x (1 + half-spread + impact), sell at close x (1 - half-spread - impact)
  limit order    eligible from the NEXT session (an order placed in the afternoon must not "see" the morning
                 low of the same day), valid 30 days. Buy limit L fills if the session trades strictly below L
                 (touching the price is not enough: others were in the queue first), at L, or at the open if the
                 session opens below L (gap). Mirror for sells. No spread or impact paid: a resting order
                 provides liquidity; the cost is the risk of not being filled.
"""
from __future__ import annotations

import math
from datetime import date, datetime, time
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")
CLOSE = time(16, 0)
OPEN = time(9, 30)
MAX_PARTICIPATION = 0.10
IMPACT_Y = 0.5
SPREAD_MIN_BP, SPREAD_MAX_BP = 1.0, 150.0
TICK = 0.01


def spread_bps(adv_dollars: float | None, price: float | None) -> float:
    if not adv_dollars or adv_dollars <= 0:
        bp = SPREAD_MAX_BP
    else:
        bp = 10.0 * (adv_dollars / 1e7) ** -0.5
    bp = min(SPREAD_MAX_BP, max(SPREAD_MIN_BP, bp))
    if price and price > 0:
        bp = max(bp, TICK / price * 1e4)          # at least one tick
    return bp


def stats(bars: list[dict], n: int = 20) -> dict:
    """Microstructure of the last n sessions: ADV (shares), daily volatility, estimated spread."""
    if not bars:
        return {}
    last = bars[-1]
    tail = bars[-n:]
    vols = [b.get("v") for b in tail if b.get("v")]
    adv = sum(vols) / len(vols) if vols else None
    rets = [math.log(b["c"] / a["c"]) for a, b in zip(bars[-n - 1:-1], bars[-n:]) if a.get("c") and b.get("c")]
    sigma = (sum((r - sum(rets) / len(rets)) ** 2 for r in rets) / (len(rets) - 1)) ** 0.5 if len(rets) >= 5 else None
    adv_d = adv * last["c"] if adv else None
    return {"open": last.get("o"), "high": last.get("h"), "low": last.get("l"), "close": last["c"],
            "prev_close": bars[-2]["c"] if len(bars) >= 2 else None, "volume": last.get("v"),
            "adv_shares": adv, "sigma_d": sigma, "spread_bps": spread_bps(adv_d, last["c"])}


def _ny(dt: datetime) -> datetime:
    return dt.astimezone(NY)


def eligible_bars(bars: list[dict], created_at: datetime, order_type: str) -> list[dict]:
    """Sessions an order can trade in. Market: the first session whose close was unknown when placed
    (same day if placed before 16:00 NY). Limit: sessions strictly after the placement day, unless it was
    placed before the open."""
    ny = _ny(created_at)
    d = ny.date().isoformat()
    if order_type == "limit":
        same_day_ok = ny.time() < OPEN
    else:
        same_day_ok = ny.time() < CLOSE
    return [b for b in bars if b["t"] > d or (b["t"] == d and same_day_ok)]


def market_fill(bar: dict, side: str, qty: float, st: dict) -> dict:
    """Price and quantity for a market order on the session `bar`."""
    vol = bar.get("v") or st.get("adv_shares") or 0
    cap = MAX_PARTICIPATION * vol if vol else qty
    q = min(qty, cap) if cap > 0 else qty
    sp = st.get("spread_bps") or SPREAD_MAX_BP
    half = sp / 2 / 1e4
    sigma = st.get("sigma_d") or 0.02
    impact = IMPACT_Y * sigma * math.sqrt(q / vol) if vol else 0.0
    sign = 1 if side == "buy" else -1
    price = bar["c"] * (1 + sign * (half + impact))
    return {"qty": round(q, 4), "price": round(price, 4), "session": bar["t"], "type": "market",
            "close": bar["c"], "half_spread_bps": round(half * 1e4, 2), "impact_bps": round(impact * 1e4, 2),
            "participation": round(q / vol, 6) if vol else None, "partial": q < qty}


def limit_fill(bar: dict, side: str, qty: float, limit: float) -> dict | None:
    """Fill of a resting limit order on `bar`, or None if the market did not trade through the limit."""
    o, h, l = bar.get("o") or bar["c"], bar.get("h") or bar["c"], bar.get("l") or bar["c"]
    if side == "buy":
        if not l < limit:
            return None
        price = min(limit, o)
    else:
        if not h > limit:
            return None
        price = max(limit, o)
    vol = bar.get("v") or 0
    cap = MAX_PARTICIPATION * vol if vol else qty
    q = min(qty, cap) if cap > 0 else qty
    return {"qty": round(q, 4), "price": round(price, 4), "session": bar["t"], "type": "limit", "limit": limit,
            "gap": price != limit, "half_spread_bps": 0.0, "impact_bps": 0.0,
            "participation": round(q / vol, 6) if vol else None, "partial": q < qty}


def plan(order: dict, bars: list[dict], st: dict, today: date) -> dict:
    """What to do with one pending order: {"fills": [...], "expire": reason | None}.

    Several sessions can be processed at once (catch-up after a missed run); filled_qty already
    executed is taken into account."""
    created = order["created_at"]
    if isinstance(created, str):
        created = datetime.fromisoformat(created.replace("Z", "+00:00"))
    remaining = float(order["qty"]) - float(order.get("filled_qty") or 0)
    last_session = order.get("fill_date")
    out = {"fills": [], "expire": None}
    for b in eligible_bars(bars, created, order.get("order_type") or "market"):
        if remaining <= 1e-9:
            break
        if last_session and b["t"] <= str(last_session):
            continue                                   # session already used by a previous run
        if order.get("order_type") == "limit":
            exp = order.get("expires_on")
            if exp and b["t"] > str(exp):
                break
            f = limit_fill(b, order["side"], remaining, float(order["limit_price"]))
            if f is None:
                continue
        else:
            f = market_fill(b, order["side"], remaining, st)
        out["fills"].append(f)
        remaining -= f["qty"]
    if order.get("order_type") == "limit" and remaining > 1e-9:
        exp = order.get("expires_on")
        if exp and today.isoformat() > str(exp):
            out["expire"] = "ordre à cours limité expiré (30 jours) sans exécution complète"
    return out
