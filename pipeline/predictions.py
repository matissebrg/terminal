"""Prediction registry: pre-registered forecasts, resolved against reported figures.

How a prediction is recorded
----------------------------
One YAML file per prediction set, in config/predictions/<TICKER>/. The file is committed to git,
and **the git commit time is the proof of registration**: only the latest version committed before
the deadline counts. Edits made after the deadline are kept for the record but never scored.

    ticker: NVDA
    period: Q3 FY2027          # quarter "Qn FYyyyy" or fiscal year "FYyyyy"
    note: why I think so
    metrics:                   # money in $bn, margins in %, EPS in $
      revenue: {value: 110.5, low: 107, high: 114}     # low/high = your 80 % interval (optional)
      gross_margin: {value: 73.8}
    benchmarks:                # optional, what you knew when you predicted
      consensus: {revenue: 109.2}
    price:                     # optional: share price at a date
      - {date: 2026-12-31, value: 240, low: 200, high: 280}
    events:                    # optional: yes/no questions with a probability (Brier score)
      - {id: beat-guidance, question: "Revenue above the top of guidance?", probability: 65, outcome: null}

Deadline
--------
The release date of the period is the first results filing (8-K item 2.02, 10-Q or 10-K) filed after
the period end. The deadline is 00:00 New York time on that day: a prediction must be committed the
day before at the latest. That is conservative (some companies publish after the close), but it can
never let a prediction made after the numbers count.

Benchmarks used to judge a prediction
-------------------------------------
* naive     : last value × last sequential growth (margins: last value). Beating it is the minimum.
* guidance  : company guidance, from config/assumptions/<T>.yaml (section `guidance`) or the file.
* consensus : the analysts' consensus frozen on the last snapshot before the release day (Yahoo,
              collected daily by this pipeline), or the value typed in the file. Yahoo's EPS consensus
              is usually non-GAAP: it is shown but never scored against a GAAP EPS.
"""
from __future__ import annotations

import math
import re
import subprocess
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

import yaml

try:
    from zoneinfo import ZoneInfo
    NY = ZoneInfo("America/New_York")
except Exception:  # noqa: BLE001 - tzdata missing: fixed UTC-5
    NY = timezone(timedelta(hours=-5))

# key: (label, unit shown, scale from shown unit to raw, kind)
METRICS = {
    "revenue": ("Chiffre d'affaires", "Md$", 1e9, "money"),
    "gross_margin": ("Marge brute", "%", 0.01, "margin"),
    "operating_income": ("Résultat opérationnel", "Md$", 1e9, "money"),
    "operating_margin": ("Marge opérationnelle", "%", 0.01, "margin"),
    "net_income": ("Résultat net", "Md$", 1e9, "money"),
    "eps_diluted": ("BPA dilué (GAAP)", "$", 1.0, "money"),
    "fcf": ("Free cash flow", "Md$", 1e9, "money"),
}
BENCHMARKS = ("naive", "guidance", "consensus")
PERIOD_RE = re.compile(r"^\s*(?:Q([1-4])\s*)?FY\s*(\d{4})\s*$", re.I)


# --------------------------------------------------------------------------- periods
def parse_period(label: str) -> tuple[str, int, int | None]:
    m = PERIOD_RE.match(str(label or ""))
    if not m:
        raise ValueError(f"période invalide « {label} » (attendu : « Q3 FY2027 » ou « FY2027 »)")
    q, fy = m.group(1), int(m.group(2))
    return ("quarterly", fy, int(q)) if q else ("annual", fy, None)


def period_label(freq: str, fy: int, q: int | None) -> str:
    return f"Q{q} FY{fy}" if freq == "quarterly" else f"FY{fy}"


def next_quarter(fin: dict) -> dict | None:
    """The next quarter to be reported, with an estimated period end."""
    qs = fin["periods"]["quarterly"]
    if not qs:
        return None
    last = qs[-1]
    fy, q = (last["fy"], last["q"] + 1) if last["q"] < 4 else (last["fy"] + 1, 1)
    end = date.fromisoformat(last["end"]) + timedelta(days=91)
    return {"label": period_label("quarterly", fy, q), "fy": fy, "q": q, "end_estimate": end.isoformat()}


def _period_index(fin: dict, freq: str) -> list[str]:
    return [p["label"] for p in fin["periods"][freq]]


def period_end(fin: dict, label: str) -> date | None:
    freq, *_ = parse_period(label)
    for p in fin["periods"][freq]:
        if p["label"] == label:
            return date.fromisoformat(p["end"])
    return None


# --------------------------------------------------------------------------- figures
def actual(fin: dict, label: str, metric: str) -> float | None:
    freq, *_ = parse_period(label)
    L = fin["lines"]
    g = lambda n: L.get(n, {}).get(freq, {}).get(label)  # noqa: E731
    if metric == "gross_margin":
        return g("gross_profit") / g("revenue") if g("gross_profit") is not None and g("revenue") else None
    if metric == "operating_margin":
        return g("operating_income") / g("revenue") if g("operating_income") is not None and g("revenue") else None
    return g(metric)


NAIVE_METHODS = {
    "sequential": "dernier trimestre × dernière croissance séquentielle (marges : dernière valeur)",
    "seasonal": "même trimestre de l'an dernier × dernière croissance sur un an (marges : même trimestre "
                "de l'an dernier + dernière variation sur un an)",
}


def naive(fin: dict, label: str, metric: str, method: str | None = None) -> float | None:
    """The benchmark any forecast must beat, using only earlier periods.

    sequential (default): last value × last sequential growth. Right for steady growers (NVIDIA).
    seasonal: same quarter last year × last year-on-year growth. Right for seasonal businesses
    (retail: Walmart's Q4 holiday quarter), where a sequential rule extrapolates the season."""
    method = method or fin.get("naive_method") or "sequential"
    freq, *_ = parse_period(label)
    idx = _period_index(fin, freq)
    if label in idx:
        i = idx.index(label)
    else:  # not reported yet: it is the period right after the last one
        i = len(idx)
    if i < 1:
        return None
    v1 = actual(fin, idx[i - 1], metric)
    if v1 is None:
        return None
    margin = METRICS[metric][3] == "margin"
    if method == "seasonal" and freq == "quarterly" and i >= 5:
        v4, v5 = actual(fin, idx[i - 4], metric), actual(fin, idx[i - 5], metric)
        if v4 is not None and v5 is not None:
            if margin:
                return v4 + (v1 - v5)
            if v4 > 0 and v5 > 0 and v1 > 0:
                return v4 * (v1 / v5)
    if margin or i < 2:
        return v1
    v2 = actual(fin, idx[i - 2], metric)
    if v2 is None or v1 <= 0 or v2 <= 0:
        return v1
    return v1 * (v1 / v2)


def naive_backtest(fin: dict, metric: str = "revenue", n: int = 8) -> dict:
    """Mean absolute % error of each naive rule over the last n reported quarters."""
    labels = [p["label"] for p in fin["periods"]["quarterly"]][-n:]
    out = {}
    for m in NAIVE_METHODS:
        errs = []
        for l in labels:
            a, f = actual(fin, l, metric), naive(fin, l, metric, m)
            if a and f is not None:
                errs.append(abs(f / a - 1))
        out[m] = sum(errs) / len(errs) if errs else None
    return out


def release_date(fin: dict, filings: list[dict], label: str) -> date | None:
    end = period_end(fin, label)
    if end is None:
        return None
    cands = [date.fromisoformat(f["filed"]) for f in filings
             if f.get("is_results") and date.fromisoformat(f["filed"]) > end]
    return min(cands) if cands else None


def typical_lag_days(fin: dict, filings: list[dict]) -> int | None:
    lags = []
    for p in fin["periods"]["quarterly"][-8:]:
        rd = release_date(fin, filings, p["label"])
        if rd:
            lags.append((rd - date.fromisoformat(p["end"])).days)
    return sorted(lags)[len(lags) // 2] if lags else None


def deadline_for(release: date) -> datetime:
    return datetime.combine(release, time(0, 0), tzinfo=NY).astimezone(timezone.utc)


# --------------------------------------------------------------------------- git versions
def git_versions(path: Path, root: Path) -> list[dict]:
    """All committed versions of a file, oldest first: [{commit, time, content}]."""
    rel = path.relative_to(root).as_posix()
    try:
        out = subprocess.run(["git", "-C", str(root), "log", "--follow", "--format=%H%x09%cI", "--", rel],
                             capture_output=True, text=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        return []
    versions = []
    for line in reversed([x for x in out.splitlines() if x.strip()]):
        h, t = line.split("\t")
        try:
            raw = subprocess.run(["git", "-C", str(root), "show", f"{h}:{rel}"], capture_output=True, text=True,
                                 check=True).stdout
            content = yaml.safe_load(raw) or {}
        except (subprocess.CalledProcessError, yaml.YAMLError):
            continue
        versions.append({"commit": h, "time": datetime.fromisoformat(t).astimezone(timezone.utc), "content": content})
    return versions


def load_versions(path: Path, root: Path, now: datetime) -> tuple[list[dict], bool]:
    """Committed versions, plus the working copy if it differs (unverified, local runs only)."""
    versions = git_versions(path, root)
    try:
        current = yaml.safe_load(path.read_text()) or {}
    except yaml.YAMLError as exc:
        raise ValueError(f"YAML invalide : {exc}") from exc
    if not versions:
        return [{"commit": None, "time": now, "content": current}], False
    if versions[-1]["content"] != current:
        versions.append({"commit": None, "time": now, "content": current})
        return versions, False
    return versions, True


# --------------------------------------------------------------------------- scoring helpers
def _num(x) -> float | None:
    if x is None or x == "":
        return None
    if isinstance(x, str):
        x = x.replace(",", ".").replace(" ", "").replace(" ", "")
    v = float(x)
    return v if math.isfinite(v) else None


def to_raw(metric: str, shown) -> float | None:
    v = _num(shown)
    return None if v is None else v * METRICS[metric][2]


def _prob(p) -> float | None:
    v = _num(p)
    if v is None:
        return None
    return v / 100.0 if v > 1 else v


def _err(metric: str, pred: float | None, act: float | None) -> dict | None:
    if pred is None or act is None:
        return None
    if METRICS[metric][3] == "margin":
        pts = (pred - act) * 100
        return {"value": pred, "error_pts": pts, "abs": abs(pts)}
    pct = (pred - act) / abs(act) if act else None
    return {"value": pred, "error": pred - act, "error_pct": pct, "abs": abs(pct) if pct is not None else None}


# --------------------------------------------------------------------------- main
def evaluate(*, root: Path, fins: dict, filings: dict, bars: dict, guidance: dict, consensus: dict,
             next_earnings: dict, now: datetime | None = None) -> dict:
    """fins/filings/bars: {ticker: ...}; guidance: {ticker: {period: {metric: shown}}};
    consensus: {ticker: [snapshots]}; next_earnings: {ticker: {date, estimated, period}}."""
    now = now or datetime.now(timezone.utc)
    folder = root / "config" / "predictions"
    files = sorted(list(folder.rglob("*.yaml")) + list(folder.rglob("*.yml"))) if folder.exists() else []
    records, errors, events = [], [], []
    for path in files:
        if path.name.startswith("_"):
            continue  # templates
        try:
            rec = _evaluate_file(path, root, fins, filings, bars, guidance, consensus, next_earnings, now)
            records.append(rec)
            events += _feed_events(rec)
        except Exception as exc:  # noqa: BLE001 - one bad file must not hide the others
            errors.append(f"{path.relative_to(root).as_posix()} : {exc}")
    records.sort(key=lambda r: (r["status"] != "pending", r.get("release_date") or r.get("expected_release") or "",
                                r["registered_at"] or ""), reverse=False)
    return {"generated_at": now.isoformat(timespec="seconds"), "metrics": {k: {"label": v[0], "unit": v[1], "kind": v[3]}
                                                                           for k, v in METRICS.items()},
            "predictions": records, "summary": summarize(records), "errors": errors}, events


def _evaluate_file(path, root, fins, filings, bars, guidance, consensus, next_earnings, now) -> dict:
    versions, verified = load_versions(path, root, now)
    latest = versions[-1]["content"]
    ticker = str(latest.get("ticker") or path.parent.name).upper()
    label = latest.get("period")
    fin = fins.get(ticker)
    rec = {"id": path.relative_to(root).as_posix(), "ticker": ticker, "period": label, "verified": verified,
           "first_registered_at": versions[0]["time"].isoformat(timespec="seconds"),
           "versions": len(versions), "status": "pending", "metrics": [], "price": [], "events": []}

    rel_date = expected = None
    if label:
        parse_period(label)  # validates
        if fin is None:
            raise ValueError(f"{ticker} n'est pas suivi par le terminal (config/universe.yaml)")
        rel_date = release_date(fin, filings.get(ticker, []), label)
        ne = next_earnings.get(ticker) or {}
        if rel_date is None and ne.get("period") == label:
            expected = ne.get("date")
            rec["expected_estimated"] = ne.get("estimated", True)
    deadline = deadline_for(rel_date) if rel_date else None
    rec["release_date"] = rel_date.isoformat() if rel_date else None
    rec["expected_release"] = expected
    rec["deadline"] = deadline.isoformat(timespec="seconds") if deadline else (
        deadline_for(date.fromisoformat(expected)).isoformat(timespec="seconds") if expected else None)

    valid = [v for v in versions if deadline is None or v["time"] < deadline]
    if not valid:
        rec["status"] = "late"
        rec["registered_at"] = versions[0]["time"].isoformat(timespec="seconds")
        rec["note"] = latest.get("note")
        return rec
    used = valid[-1]
    c = used["content"]
    rec["registered_at"] = used["time"].isoformat(timespec="seconds")
    rec["commit"] = used["commit"]
    rec["edited_after_deadline"] = bool(deadline and versions[-1]["time"] >= deadline
                                        and versions[-1]["content"] != c)
    rec["note"] = c.get("note")

    # ---------------- metrics
    gd = (guidance.get(ticker) or {}).get(label, {}) if label else {}
    bm = c.get("benchmarks") or {}
    cons = _frozen_consensus(consensus.get(ticker) or [], label, rel_date) if label else None
    resolved_any = False
    for key, spec in (c.get("metrics") or {}).items():
        if key not in METRICS:
            raise ValueError(f"métrique inconnue « {key} » (possibles : {', '.join(METRICS)})")
        spec = spec if isinstance(spec, dict) else {"value": spec}
        pred = to_raw(key, spec.get("value"))
        low, high = to_raw(key, spec.get("low")), to_raw(key, spec.get("high"))
        act = actual(fin, label, key) if (fin and rel_date) else None
        m = {"key": key, "label": METRICS[key][0], "unit": METRICS[key][1], "kind": METRICS[key][3],
             "value": pred, "low": low, "high": high, "actual": act}
        bench_vals = {
            "naive": naive(fin, label, key) if fin else None,
            "guidance": to_raw(key, (bm.get("guidance") or {}).get(key, gd.get(key))),
            "consensus": None,
        }
        cons_src = None
        if (bm.get("consensus") or {}).get(key) is not None:
            bench_vals["consensus"], cons_src = to_raw(key, bm["consensus"][key]), "saisi"
        elif cons and key == "revenue" and cons.get("revenue_avg"):
            bench_vals["consensus"], cons_src = cons["revenue_avg"], f"Yahoo au {cons['date']}"
        m["consensus_source"] = cons_src
        if cons and key == "eps_diluted" and cons.get("eps_avg") and cons_src is None:
            m["consensus_eps_non_gaap"] = cons["eps_avg"]  # informative only
        m["benchmarks"] = {k: v for k, v in bench_vals.items() if v is not None}
        if act is not None and pred is not None:
            resolved_any = True
            e = _err(key, pred, act)
            m.update({k: v for k, v in e.items() if k != "value"})
            if low is not None and high is not None:
                m["in_interval"] = low <= act <= high
            m["vs"] = {}
            for b, bv in m["benchmarks"].items():
                be = _err(key, bv, act)
                m["vs"][b] = {"error": be.get("error_pct", be.get("error_pts")), "abs": be["abs"],
                              "you_win": e["abs"] is not None and be["abs"] is not None and e["abs"] < be["abs"]}
            if "consensus" in m["benchmarks"]:
                cv = m["benchmarks"]["consensus"]
                if pred != cv and act != cv:
                    m["surprise_call"] = {"you": "au-dessus" if pred > cv else "en dessous",
                                          "actual": "au-dessus" if act > cv else "en dessous",
                                          "correct": (pred > cv) == (act > cv)}
        rec["metrics"].append(m)

    # ---------------- price targets
    for p in c.get("price") or []:
        d = date.fromisoformat(str(p["date"]))
        tk = str(p.get("ticker") or ticker).upper()
        pr = {"ticker": tk, "date": d.isoformat(), "value": _num(p.get("value")), "low": _num(p.get("low")),
              "high": _num(p.get("high")), "actual": None}
        b = bars.get(tk) or []
        hit = next((x for x in b if x["t"] >= d.isoformat()), None)
        if hit and d <= date.fromisoformat(b[-1]["t"]):
            pr["actual"], pr["actual_date"] = hit["c"], hit["t"]
            pr["error_pct"] = (pr["value"] - hit["c"]) / hit["c"] if pr["value"] is not None else None
            if pr["low"] is not None and pr["high"] is not None:
                pr["in_interval"] = pr["low"] <= hit["c"] <= pr["high"]
            resolved_any = True
        pr["horizon_days"] = (d - used["time"].date()).days
        rec["price"].append(pr)

    # ---------------- events (probability from the registered version, outcome from the latest one)
    latest_out = {str(e.get("id") or e.get("question")): e.get("outcome") for e in latest.get("events") or []}
    for e in c.get("events") or []:
        eid = str(e.get("id") or e.get("question"))
        prob = _prob(e.get("probability"))
        out = latest_out.get(eid, e.get("outcome"))
        ev = {"id": eid, "question": e.get("question") or eid, "probability": prob,
              "outcome": None if out is None else bool(out)}
        if ev["outcome"] is not None and prob is not None:
            ev["brier"] = (prob - (1.0 if ev["outcome"] else 0.0)) ** 2
            resolved_any = True
        rec["events"].append(ev)

    all_done = (all(m.get("actual") is not None for m in rec["metrics"])
                and all(p.get("actual") is not None for p in rec["price"])
                and all(e.get("outcome") is not None for e in rec["events"]))
    rec["status"] = "resolved" if all_done and resolved_any else ("partial" if resolved_any else "pending")
    return rec


def _frozen_consensus(snaps: list[dict], label: str | None, rel: date | None) -> dict | None:
    """Last consensus snapshot for this period taken strictly before the release day."""
    c = [s for s in snaps if s.get("period") == label and (rel is None or date.fromisoformat(s["date"]) < rel)]
    return c[-1] if c else None


# --------------------------------------------------------------------------- aggregates
def summarize(records: list[dict]) -> dict:
    by_metric: dict[str, dict] = {}
    briers, cal_bins = [], [[0, 0.0, 0] for _ in range(10)]
    price_errs, price_cov = [], []
    for r in records:
        if r["status"] == "late":
            continue
        for m in r["metrics"]:
            if m.get("actual") is None or m.get("abs") is None:
                continue
            s = by_metric.setdefault(m["key"], {"label": m["label"], "kind": m["kind"], "n": 0, "abs": [], "signed": [],
                                                "cov_n": 0, "cov_hit": 0, "vs": {}, "calls_n": 0, "calls_ok": 0})
            s["n"] += 1
            s["abs"].append(m["abs"])
            s["signed"].append(m.get("error_pct", m.get("error_pts")))
            if "in_interval" in m:
                s["cov_n"] += 1
                s["cov_hit"] += int(m["in_interval"])
            for b, v in (m.get("vs") or {}).items():
                t = s["vs"].setdefault(b, {"n": 0, "wins": 0})
                t["n"] += 1
                t["wins"] += int(v["you_win"])
            if "surprise_call" in m:
                s["calls_n"] += 1
                s["calls_ok"] += int(m["surprise_call"]["correct"])
        for p in r["price"]:
            if p.get("actual") is not None and p.get("error_pct") is not None:
                price_errs.append(abs(p["error_pct"]))
                if "in_interval" in p:
                    price_cov.append(int(p["in_interval"]))
        for e in r["events"]:
            if "brier" in e:
                briers.append(e["brier"])
                b = min(9, int(e["probability"] * 10))
                cal_bins[b][0] += 1
                cal_bins[b][1] += e["probability"]
                cal_bins[b][2] += int(e["outcome"])
    out = {}
    for k, s in by_metric.items():
        out[k] = {"label": s["label"], "kind": s["kind"], "n": s["n"],
                  "mean_abs_error": sum(s["abs"]) / s["n"],          # % (fraction) or points
                  "bias": sum(s["signed"]) / s["n"],                 # > 0 : trop optimiste
                  "interval": {"n": s["cov_n"], "hit": s["cov_hit"],
                               "rate": s["cov_hit"] / s["cov_n"] if s["cov_n"] else None, "target": 0.8},
                  "vs": {b: {**t, "rate": t["wins"] / t["n"]} for b, t in s["vs"].items()},
                  "surprise_calls": {"n": s["calls_n"], "correct": s["calls_ok"],
                                     "rate": s["calls_ok"] / s["calls_n"] if s["calls_n"] else None}}
    ev = None
    if briers:
        bs = sum(briers) / len(briers)
        ev = {"n": len(briers), "brier": bs, "brier_ref": 0.25, "skill": 1 - bs / 0.25,
              "calibration": [{"bin": f"{i * 10}-{i * 10 + 10} %", "n": n, "mean_prob": sp / n, "freq": h / n}
                              for i, (n, sp, h) in enumerate(cal_bins) if n]}
    counts = {s: sum(1 for r in records if r["status"] == s) for s in ("pending", "partial", "resolved", "late")}
    return {"by_metric": out, "events": ev, "counts": counts,
            "price": {"n": len(price_errs), "mean_abs_error": sum(price_errs) / len(price_errs) if price_errs else None,
                      "interval_rate": sum(price_cov) / len(price_cov) if price_cov else None}}


# --------------------------------------------------------------------------- feed
def _feed_events(rec: dict) -> list[dict]:
    from .feed import fr, frp  # local import: avoid a cycle at module load
    out = []
    reg = rec["first_registered_at"][:10]
    out.append({"id": f"pred-new-{rec['id']}", "date": reg, "ticker": rec["ticker"], "type": "prediction",
                "title": f"{rec['ticker']} : prédiction enregistrée pour {rec['period'] or 'le cours'}",
                "detail": "Horodatée par le commit Git." if rec["verified"] else "Non encore commitée.",
                "values": {"file": rec["id"]}})
    if rec["status"] in ("resolved", "partial"):
        parts = []
        for m in rec["metrics"]:
            if m.get("actual") is None:
                continue
            if m["kind"] == "margin":
                parts.append(f"{m['label']} : prévu {fr(m['value'] * 100, 1)} %, réel {fr(m['actual'] * 100, 1)} % "
                             f"({'+' if m['error_pts'] > 0 else ''}{fr(m['error_pts'], 1)} pt)")
            else:
                sc = 1e9 if m["unit"] == "Md$" else 1
                parts.append(f"{m['label']} : prévu {fr(m['value'] / sc, 2)} {m['unit']}, réel "
                             f"{fr(m['actual'] / sc, 2)} {m['unit']} ({frp(m['error_pct'])})")
        if parts:
            out.append({"id": f"pred-res-{rec['id']}-{rec['status']}", "date": rec.get("release_date") or reg,
                        "ticker": rec["ticker"], "type": "prediction",
                        "title": f"{rec['ticker']} : ta prédiction {rec['period']} est vérifiée",
                        "detail": " · ".join(parts[:3]), "values": {"file": rec["id"]}})
    return out
