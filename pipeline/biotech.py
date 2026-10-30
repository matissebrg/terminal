"""Biotech layer: rNPV of the pipeline, catalyst calendar with market-implied odds, clinical trials.

Driven by optional blocks of config/assumptions/<T>.yaml:

  rnpv:        programmes (stage, indication area, peak sales, launch, LOE, costs...) -> rnpv.py
  catalysts:   dated events (PDUFA, readout, AdCom, filing...) linked to a programme
  trials:      {sponsors: [names of the company and its subsidiaries on ClinicalTrials.gov]}

Writes docs/data/<T>/biotech.json and returns the feed events; build.py writes the cross-ticker
calendar docs/data/biotech.json.
"""
from __future__ import annotations

from datetime import date
from pathlib import Path

from . import feed, rnpv, trials

KIND_FR = {"pdufa": "Décision FDA (PDUFA)", "readout": "Résultats d'essai", "adcom": "Comité consultatif FDA",
           "filing": "Dépôt de dossier", "launch": "Lancement", "ema": "Avis EMA / CHMP", "data": "Présentation de données",
           "other": "Événement"}
OUTCOME_FR = {"success": "succès", "failure": "échec", "mixed": "mitigé"}


def net_cash_from(fin: dict, cfg: dict) -> tuple[float, str]:
    ov = cfg.get("net_cash", "auto")
    if ov not in (None, "auto"):
        return float(ov), "hypothèse"
    T = fin["ttm"]
    nc = (T.get("cash") or 0) + (T.get("short_term_investments") or 0) - (T.get("total_debt") or 0)
    return nc, f"bilan {fin['periods']['quarterly'][-1]['label'] if fin['periods']['quarterly'] else ''} (trésorerie + placements - dette)"


def enrich_catalysts(items: list[dict], res: dict | None, opt: dict | None, price: float | None,
                     today: date) -> list[dict]:
    assets = {(a["name"] or "").lower(): a for a in (res or {}).get("assets", [])}
    out = []
    for c in items or []:
        d = date.fromisoformat(str(c["date"]))
        a = assets.get(str(c.get("asset") or "").lower())
        outcome = c.get("outcome")
        status = OUTCOME_FR.get(outcome, outcome) if outcome else ("à venir" if d >= today else "résultat attendu")
        x = {
            "id": c.get("id") or f"{c.get('asset', 'x')}-{c.get('kind', 'event')}-{d.isoformat()}".lower().replace(" ", "-"),
            "date": d.isoformat(), "days": (d - today).days, "kind": c.get("kind", "other"),
            "kind_label": KIND_FR.get(c.get("kind", "other"), c.get("kind")), "title": c.get("title"),
            "asset": c.get("asset"), "confirmed": bool(c.get("confirmed", False)), "source": c.get("source"),
            "outcome": outcome, "status": status, "note": c.get("note"),
        }
        if a:
            x.update({"stage": a["stage"], "stage_label": a["stage_label"], "area_label": a["area_label"],
                      "p_base": a["step_base"], "p_model": a["step_p"], "p_market": a.get("implied_step"),
                      "move_up": a.get("move_up"), "move_down": a.get("move_down"),
                      "expected_abs_move": a.get("expected_abs_move"),
                      "asset_per_share": a.get("per_share"),
                      "value_if_success_ps": (a["value_if_success"] / res["shares"]) if a.get("value_if_success") is not None and res.get("shares") else None})
        im = rnpv.implied_move(opt, x["date"], price) if not outcome and d >= today else None
        if im:
            x["options"] = im
            ref = im["event_move"] if im.get("event_move") is not None else im["straddle_move"]
            if x.get("expected_abs_move") is not None and ref is not None:
                x["vol_edge"] = x["expected_abs_move"] - ref
        out.append(x)
    return sorted(out, key=lambda x: x["date"])


def build(*, ticker: str, assump: dict, fin: dict, price: float | None, shares: float | None, opt: dict | None,
          today: str, src, out_dir: Path, family: str | None, company_name: str, status: dict) -> dict | None:
    """Returns {"rnpv": ..., "catalysts": [...], "trials": {...}, "events": [...]} or None if not a biotech."""
    cfg_r, cfg_c, cfg_t = assump.get("rnpv"), assump.get("catalysts"), assump.get("trials")
    if not (cfg_r or cfg_c or cfg_t or family == "sante"):
        return None
    t0 = date.fromisoformat(today)
    res = None
    if cfg_r and shares:
        nc, nc_src = net_cash_from(fin, cfg_r)
        res = rnpv.value(cfg_r, net_cash=nc, shares=shares, price=price, valuation_date=t0)
        res["net_cash_source"] = nc_src
        res["primary"] = bool(cfg_r.get("primary", True))
    cats = enrich_catalysts(cfg_c or [], res, opt, price, t0)

    # ---- ClinicalTrials.gov (best effort, cached)
    sponsors = (cfg_t or {}).get("sponsors") or [company_name.replace(",", "").replace(" Inc.", "").replace(" Inc", "").strip()]
    path = out_dir / ticker / "trials.json"
    prev = feed.load_json(path, None)
    tr_events, studies, tr_src = [], (prev or {}).get("studies"), "cache"
    if (cfg_t or {}).get("enabled", True) is not False and hasattr(src, "trials"):
        try:
            studies = src.trials(sponsors)
            tr_src = "ClinicalTrials.gov"
            tr_events = trials.diff_events(ticker, (prev or {}).get("studies"), studies, today, feed._eid)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(__import__("json").dumps({"asof": today, "sponsors": sponsors, "studies": studies},
                                                     ensure_ascii=False, separators=(",", ":")))
        except Exception as exc:  # noqa: BLE001 - trials never block a run
            print(f"  [essais] {ticker}: {exc}")
            status["errors"].append(f"{ticker}: ClinicalTrials.gov indisponible ({str(exc)[:80]})")
    studies = studies or []
    readouts = trials.expected_readouts(studies, t0)
    by_status: dict[str, int] = {}
    for s in studies:
        by_status[s.get("status") or "UNKNOWN"] = by_status.get(s.get("status") or "UNKNOWN", 0) + 1
    tr = {"source": tr_src, "sponsors": sponsors, "count": len(studies), "by_status": by_status,
          "active_phase23": [s for s in studies if s.get("status") in trials.ACTIVE and set(s.get("phases") or []) & {"PHASE2", "PHASE3"}][:60],
          "stopped_recent": [s for s in studies if s.get("status") in trials.STOPPED][:15],
          "expected_readouts": readouts[:30]}

    # ---- catalyst events (7 days ahead, then on the day)
    events = list(tr_events)
    for c in cats:
        if c["outcome"] is None and 0 <= c["days"] <= 7:
            events.append({"id": feed._eid(ticker, "catalyst-soon", c["id"]), "date": today, "ticker": ticker,
                           "type": "catalyst", "title": f"{ticker} : {c['kind_label']} dans {c['days']} j ({c.get('asset') or ''})",
                           "detail": c.get("title") or "", "url": c.get("source"), "values": {"catalyst": c["id"]}})
        if c["outcome"]:
            events.append({"id": feed._eid(ticker, "catalyst-outcome", c["id"]), "date": c["date"], "ticker": ticker,
                           "type": "catalyst", "title": f"{ticker} : {c['kind_label']} {c.get('asset') or ''} : {c['status']}",
                           "detail": c.get("title") or "", "url": c.get("source"), "values": {"catalyst": c["id"]}})
    out = {"ticker": ticker, "asof": today, "price": price, "rnpv": res, "catalysts": cats, "trials": tr}
    return {**out, "events": events}
