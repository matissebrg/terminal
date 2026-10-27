"""Market data: daily prices, risk-free rate, beta.

Sources, tried in order (all free, no API key):
  prices  : yfinance (the standard open-source Yahoo Finance client) -> Yahoo chart endpoint
            -> Stooq CSV -> last cached file
  rf rate : FRED DGS10 CSV -> US Treasury daily par yield curve CSV -> yfinance ^TNX -> assumption

Unofficial endpoints can break or rate-limit without notice. The pipeline never
fails because of prices: it falls back to the previous run's data and flags it as stale.
"""
from __future__ import annotations

import csv
import io
import math
from datetime import date, datetime, timedelta, timezone

from . import http

YAHOO_CHART = "https://query{n}.finance.yahoo.com/v8/finance/chart/{sym}"
STOOQ_CSV = "https://stooq.com/q/d/l/"
FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv"
TREASURY_CSV = ("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
                "daily-treasury-rates.csv/{year}/all")
ETFS = {"SPY", "SOXX", "QQQ", "SMH", "IWM", "DIA"}


def _yfinance(sym: str, rng: str = "5y") -> list[dict]:
    import warnings

    import yfinance as yf  # optional dependency
    warnings.filterwarnings("ignore", module="yfinance")

    df = yf.Ticker(sym).history(period=rng, interval="1d", auto_adjust=False, actions=False)
    if df is None or df.empty:
        raise RuntimeError("yfinance vide")
    out = []
    for idx, row in df.iterrows():
        c = row.get("Close")
        if c is None or c != c:  # NaN
            continue
        ac = row.get("Adj Close", c)
        out.append({"t": idx.date().isoformat(), "o": _r(row.get("Open")), "h": _r(row.get("High")),
                    "l": _r(row.get("Low")), "c": _r(c), "ac": _r(ac if ac == ac else c),
                    "v": int(row.get("Volume") or 0)})
    return _dedupe(out)


def _yahoo(sym: str, rng: str = "5y") -> list[dict]:
    last_exc = None
    for n in (1, 2):
        try:
            r = http.get(YAHOO_CHART.format(n=n, sym=sym), host_key="yahoo", min_interval=0.6, retries=1,
                         headers={"User-Agent": http.PROJECT_UA, "Accept": "application/json"},
                         params={"range": rng, "interval": "1d", "events": "div,splits",
                                 "includeAdjustedClose": "true"})
            res = r.json()["chart"]["result"][0]
            ts = res.get("timestamp") or []
            q = res["indicators"]["quote"][0]
            adj = (res["indicators"].get("adjclose") or [{}])[0].get("adjclose") or q["close"]
            out = []
            for i, t in enumerate(ts):
                c = q["close"][i]
                if c is None:
                    continue
                d = datetime.fromtimestamp(t, tz=timezone.utc).date().isoformat()
                out.append({"t": d, "o": _r(q["open"][i]), "h": _r(q["high"][i]), "l": _r(q["low"][i]),
                            "c": _r(c), "ac": _r(adj[i]) if adj[i] is not None else _r(c),
                            "v": int(q["volume"][i] or 0)})
            if out:
                return _dedupe(out)
        except Exception as exc:  # noqa: BLE001 - any failure -> try next source
            last_exc = exc
    raise RuntimeError(f"Yahoo indisponible pour {sym}: {last_exc}")


def _stooq(sym: str) -> list[dict]:
    s = sym.lower().replace("^", "")
    r = http.get(STOOQ_CSV, host_key="stooq", min_interval=0.6, retries=1, params={"s": f"{s}.us", "i": "d"},
                 headers={"User-Agent": http.PROJECT_UA})
    rows = list(csv.DictReader(io.StringIO(r.text)))
    out = []
    for row in rows:
        try:
            c = float(row["Close"])
        except (KeyError, ValueError):
            continue
        out.append({"t": row["Date"], "o": _r(float(row["Open"])), "h": _r(float(row["High"])),
                    "l": _r(float(row["Low"])), "c": _r(c), "ac": _r(c), "v": int(float(row.get("Volume") or 0))})
    if not out:
        raise RuntimeError(f"Stooq vide pour {sym}: {r.text[:120]!r}")
    cutoff = date.today().replace(year=date.today().year - 5).isoformat()
    return [p for p in out if p["t"] >= cutoff]


SOURCES = (("yfinance", _yfinance), ("yahoo", _yahoo), ("stooq", _stooq))


def daily_prices(sym: str, cached: list[dict] | None = None) -> tuple[list[dict], str]:
    """Returns (bars, source). bars: [{t, o, h, l, c, ac, v}] ascending."""
    for name, fn in SOURCES:
        try:
            bars = fn(sym)
            if len(bars) >= 20:
                return bars, name
            raise RuntimeError(f"seulement {len(bars)} barres")
        except Exception as exc:  # noqa: BLE001
            print(f"  [prix] {sym}: {name} a échoué ({str(exc)[:200]})")
    if cached:
        return cached, "cache"
    return [], "none"


def _treasury_10y() -> tuple[float, str]:
    for year in (date.today().year, date.today().year - 1):
        r = http.get(TREASURY_CSV.format(year=year), host_key="treasury", retries=2, timeout=40,
                     headers={"User-Agent": http.PROJECT_UA},
                     params={"type": "daily_treasury_yield_curve", "field_tdr_date_value": year, "_format": "csv"})
        rows = list(csv.DictReader(io.StringIO(r.text)))
        rows = [x for x in rows if (x.get("10 Yr") or "").strip()]
        if rows:
            latest = max(rows, key=lambda x: datetime.strptime(x["Date"], "%m/%d/%Y"))
            d = datetime.strptime(latest["Date"], "%m/%d/%Y").date().isoformat()
            return float(latest["10 Yr"]) / 100.0, d
    raise RuntimeError("courbe du Trésor vide")


def risk_free_10y(fallback: float) -> tuple[float, str, str | None]:
    """US 10Y Treasury constant-maturity yield, in decimal. Returns (rate, source, as_of)."""
    try:
        r = http.get(FRED_CSV, host_key="fred", params={"id": "DGS10"}, retries=2, timeout=40,
                     headers={"User-Agent": http.PROJECT_UA})
        rows = [row for row in csv.reader(io.StringIO(r.text))][1:]
        for d, v in reversed(rows):
            if v not in (".", ""):
                return float(v) / 100.0, "FRED DGS10", d
    except Exception as exc:  # noqa: BLE001
        print(f"  [rf] FRED a échoué ({exc})")
    try:
        v, d = _treasury_10y()
        return v, "Trésor US (courbe des taux par)", d
    except Exception as exc:  # noqa: BLE001
        print(f"  [rf] Trésor US a échoué ({exc})")
    for name, fn in (("yfinance", _yfinance), ("yahoo", _yahoo)):
        try:
            bars = fn("^TNX", "1mo")
            return bars[-1]["c"] / 100.0, f"{name} ^TNX", bars[-1]["t"]
        except Exception as exc:  # noqa: BLE001
            print(f"  [rf] {name} ^TNX a échoué ({exc})")
    return fallback, "hypothèse (fallback)", None


def beta(stock: list[dict], bench: list[dict], weeks: int = 104) -> dict | None:
    """OLS beta of weekly (Friday-to-Friday) log returns over `weeks` weeks, plus Blume adjustment."""
    def weekly(bars):
        out = {}
        for b in bars:
            d = date.fromisoformat(b["t"])
            iso = d.isocalendar()
            out[(iso[0], iso[1])] = b["ac"]  # last close of each ISO week
        return out
    ws, wb = weekly(stock), weekly(bench)
    keys = sorted(set(ws) & set(wb))[-(weeks + 1):]
    if len(keys) < 30:
        return None
    rs = [math.log(ws[b] / ws[a]) for a, b in zip(keys, keys[1:])]
    rb = [math.log(wb[b] / wb[a]) for a, b in zip(keys, keys[1:])]
    n = len(rs)
    ms, mb = sum(rs) / n, sum(rb) / n
    cov = sum((x - ms) * (y - mb) for x, y in zip(rs, rb)) / (n - 1)
    var = sum((y - mb) ** 2 for y in rb) / (n - 1)
    if var <= 0:
        return None
    raw = cov / var
    corr = cov / math.sqrt(var * (sum((x - ms) ** 2 for x in rs) / (n - 1)))
    return {"raw": round(raw, 3), "adjusted": round(0.67 * raw + 0.33, 3), "r2": round(corr ** 2, 3),
            "n_weeks": n, "benchmark_note": "rendements hebdomadaires log, 2 ans"}


def perf_stats(bars: list[dict]) -> dict:
    """Trailing returns, annualised volatility, max drawdown, 52-week range."""
    if not bars:
        return {}
    last = bars[-1]
    d_last = date.fromisoformat(last["t"])

    def ret_since(days=None, ytd=False):
        if ytd:
            target = date(d_last.year, 1, 1)
        else:
            target = date.fromordinal(d_last.toordinal() - days)
        base = [b for b in bars if date.fromisoformat(b["t"]) <= target]
        if not base:
            return None
        return last["ac"] / base[-1]["ac"] - 1

    rets = [math.log(b["ac"] / a["ac"]) for a, b in zip(bars[-253:], bars[-252:]) if a["ac"] and b["ac"]]
    vol = (sum((r - sum(rets) / len(rets)) ** 2 for r in rets) / (len(rets) - 1)) ** 0.5 * math.sqrt(252) \
        if len(rets) > 20 else None
    peak, mdd = -1e18, 0.0
    for b in bars[-756:]:
        peak = max(peak, b["ac"])
        mdd = min(mdd, b["ac"] / peak - 1)
    yr = bars[-252:]
    return {
        "last": last["c"], "date": last["t"],
        "chg_1d": (last["c"] / bars[-2]["c"] - 1) if len(bars) > 1 else None,
        "r_1w": ret_since(7), "r_1m": ret_since(30), "r_3m": ret_since(91), "r_6m": ret_since(182),
        "r_ytd": ret_since(ytd=True), "r_1y": ret_since(365), "r_3y": ret_since(1095), "r_5y": ret_since(1826),
        "vol_1y": vol, "max_dd_3y": mdd,
        "high_52w": max(b["h"] or b["c"] for b in yr), "low_52w": min(b["l"] or b["c"] for b in yr),
        "avg_volume_3m": sum(b["v"] for b in bars[-63:]) / max(1, len(bars[-63:])),
    }


def _r(x):
    if x is None:
        return None
    x = float(x)
    return None if x != x else round(x, 4)  # NaN -> None (JSON has no NaN)


def _dedupe(bars):
    seen = {}
    for b in bars:
        seen[b["t"]] = b
    return [seen[k] for k in sorted(seen)]
