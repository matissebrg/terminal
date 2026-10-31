"""Clinical trials from ClinicalTrials.gov (API v2, free, no key) and the events they generate.

For each covered drug developer, every study whose lead sponsor matches one of its names (the
company and its subsidiaries) is pulled, reduced to the fields that matter for an investor, and
compared with the previous run:

  * new study registered              -> feed event
  * overall status changed            -> feed event (e.g. RECRUITING -> ACTIVE_NOT_RECRUITING ->
                                         COMPLETED, or TERMINATED / WITHDRAWN / SUSPENDED: red flags)
  * primary completion date moved     -> feed event (a slip is often the first sign of trouble)
  * results posted                    -> feed event

"Expected readouts": industry phase 2/3 studies not finished, with a primary completion date in the
next 18 months. Topline data usually follows primary completion by 1 to 4 months: this is the
calendar the market watches, before the company confirms a date.
"""
from __future__ import annotations

from datetime import date, timedelta

from . import http

API = "https://clinicaltrials.gov/api/v2/studies"
ACTIVE = {"NOT_YET_RECRUITING", "RECRUITING", "ENROLLING_BY_INVITATION", "ACTIVE_NOT_RECRUITING"}
STOPPED = {"TERMINATED", "WITHDRAWN", "SUSPENDED"}
STATUS_FR = {
    "NOT_YET_RECRUITING": "pas encore de recrutement", "RECRUITING": "recrutement en cours",
    "ENROLLING_BY_INVITATION": "inclusion sur invitation", "ACTIVE_NOT_RECRUITING": "en cours, recrutement terminé",
    "COMPLETED": "terminé", "TERMINATED": "arrêté", "WITHDRAWN": "retiré", "SUSPENDED": "suspendu",
    "UNKNOWN": "statut inconnu", "AVAILABLE": "accès élargi disponible", "NO_LONGER_AVAILABLE": "accès élargi fermé",
    "APPROVED_FOR_MARKETING": "approuvé",
}
PHASE_FR = {"EARLY_PHASE1": "Phase 1 précoce", "PHASE1": "Phase 1", "PHASE2": "Phase 2", "PHASE3": "Phase 3",
            "PHASE4": "Phase 4", "NA": "Sans phase"}


def _g(d: dict, *path, default=None):
    for p in path:
        if not isinstance(d, dict):
            return default
        d = d.get(p)
    return default if d is None else d


def slim(study: dict) -> dict:
    """The fields kept from one API v2 study record."""
    ps = study.get("protocolSection", {})
    st = ps.get("statusModule", {})
    phases = _g(ps, "designModule", "phases", default=[]) or []
    return {
        "nct": _g(ps, "identificationModule", "nctId"),
        "title": _g(ps, "identificationModule", "briefTitle"),
        "acronym": _g(ps, "identificationModule", "acronym"),
        "sponsor": _g(ps, "sponsorCollaboratorsModule", "leadSponsor", "name"),
        "sponsor_class": _g(ps, "sponsorCollaboratorsModule", "leadSponsor", "class"),
        "status": st.get("overallStatus"),
        "why_stopped": st.get("whyStopped"),
        "phases": phases,
        "phase": "/".join(PHASE_FR.get(p, p) for p in phases) or "-",
        "conditions": (_g(ps, "conditionsModule", "conditions", default=[]) or [])[:4],
        "interventions": [i.get("name") for i in (_g(ps, "armsInterventionsModule", "interventions", default=[]) or [])
                          if i.get("type") in ("DRUG", "BIOLOGICAL", "GENETIC", "COMBINATION_PRODUCT")][:4],
        "enrollment": _g(ps, "designModule", "enrollmentInfo", "count"),
        "start": _g(st, "startDateStruct", "date"),
        "primary_completion": _g(st, "primaryCompletionDateStruct", "date"),
        "primary_completion_type": _g(st, "primaryCompletionDateStruct", "type"),
        "completion": _g(st, "completionDateStruct", "date"),
        "last_update": _g(st, "lastUpdatePostDateStruct", "date"),
        "first_posted": _g(st, "studyFirstPostDateStruct", "date"),
        "has_results": bool(study.get("hasResults")),
    }


def fetch(sponsors: list[str], max_pages: int = 6) -> list[dict]:
    """Studies whose lead sponsor matches one of `sponsors` (case-insensitive contains)."""
    out: dict[str, dict] = {}
    wanted = [s.lower() for s in sponsors]
    for sp in sponsors:
        token = None
        for _ in range(max_pages):
            params = {"query.spons": sp, "pageSize": 200, "format": "json"}
            if token:
                params["pageToken"] = token
            r = http.get(API, host_key="ctgov", min_interval=0.4, timeout=40, params=params,
                         headers={"User-Agent": http.PROJECT_UA, "Accept": "application/json"})
            data = r.json()
            for s in data.get("studies", []):
                x = slim(s)
                lead = (x["sponsor"] or "").lower()
                if x["nct"] and any(w in lead for w in wanted):   # query.spons also matches collaborators
                    out[x["nct"]] = x
            token = data.get("nextPageToken")
            if not token:
                break
    return sorted(out.values(), key=lambda x: (x["last_update"] or ""), reverse=True)


def _d(s: str | None) -> date | None:
    """'2027-03' or '2027-03-15' -> a date (mid-month when the day is missing)."""
    if not s:
        return None
    try:
        return date.fromisoformat(s if len(s) == 10 else f"{s}-15")
    except ValueError:
        return None


def expected_readouts(studies: list[dict], today: date, months: int = 18) -> list[dict]:
    end = today + timedelta(days=int(months * 30.5))
    out = []
    for s in studies:
        if s["status"] not in ACTIVE or s.get("sponsor_class") not in (None, "INDUSTRY"):
            continue
        if not set(s["phases"]) & {"PHASE2", "PHASE3"}:
            continue
        pc = _d(s["primary_completion"])
        if pc and today - timedelta(days=120) <= pc <= end:
            out.append({**s, "primary_completion_date": pc.isoformat()})
    return sorted(out, key=lambda x: x["primary_completion_date"])


def diff_events(ticker: str, old: list[dict] | None, new: list[dict], today: str, eid) -> list[dict]:
    """Feed events between two runs (nothing on the very first run: everything would be 'new').
    A study only counts as new if ClinicalTrials.gov posted it in the last 60 days: a study that merely
    appears because the sponsor list was widened is not news."""
    if old is None:
        return []
    t0 = _d(today)
    prev = {s["nct"]: s for s in old}
    ev = []

    def push(kind, s, title, detail, sev="info"):
        ev.append({"id": eid(ticker, "trial", s["nct"], kind, s.get("status"), s.get("primary_completion"), today),
                   "date": today, "ticker": ticker, "type": "trial", "severity": sev,
                   "title": title, "detail": detail, "url": f"https://clinicaltrials.gov/study/{s['nct']}",
                   "values": {"nct": s["nct"], "kind": kind}})

    for s in new:
        name = s.get("acronym") or s["nct"]
        p = prev.get(s["nct"])
        if p is None:
            fp = _d(s.get("first_posted"))
            recent = fp is not None and t0 is not None and (t0 - fp).days <= 60
            if recent and s.get("phases") and set(s["phases"]) & {"PHASE2", "PHASE3"}:
                push("new", s, f"{ticker} : nouvel essai {s['phase']} enregistré ({name})", s["title"])
            continue
        if p.get("status") != s.get("status"):
            sev = "warn" if s["status"] in STOPPED else "info"
            why = f" Motif : {s['why_stopped']}." if s.get("why_stopped") else ""
            push("status", s, f"{ticker} : essai {name} {STATUS_FR.get(s['status'], s['status'])}",
                 f"{s['phase']} · {s['title']} (avant : {STATUS_FR.get(p.get('status'), p.get('status'))}).{why}", sev)
        if p.get("primary_completion") and s.get("primary_completion") and p["primary_completion"] != s["primary_completion"]:
            later = (_d(s["primary_completion"]) or date.min) > (_d(p["primary_completion"]) or date.min)
            push("date", s, f"{ticker} : fin principale de {name} {'repoussée' if later else 'avancée'} "
                            f"({p['primary_completion']} → {s['primary_completion']})",
                 f"{s['phase']} · {s['title']}.", "warn" if later else "info")
        if s.get("has_results") and not p.get("has_results"):
            push("results", s, f"{ticker} : résultats publiés sur ClinicalTrials.gov ({name})", f"{s['phase']} · {s['title']}.")
    return ev
