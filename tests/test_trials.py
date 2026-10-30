"""ClinicalTrials.gov records -> slim rows, expected readouts, feed events."""
from datetime import date

from pipeline import feed, trials


def rec(nct, status="RECRUITING", phases=("PHASE3",), pc="2027-03", pc_type="ESTIMATED", results=False,
        sponsor="QED Therapeutics, Inc.", cls="INDUSTRY", why=None):
    return {"protocolSection": {
        "identificationModule": {"nctId": nct, "briefTitle": f"Study {nct}", "acronym": nct[-3:]},
        "statusModule": {"overallStatus": status, "whyStopped": why,
                         "primaryCompletionDateStruct": {"date": pc, "type": pc_type},
                         "lastUpdatePostDateStruct": {"date": "2026-10-01"}},
        "sponsorCollaboratorsModule": {"leadSponsor": {"name": sponsor, "class": cls}},
        "conditionsModule": {"conditions": ["Achondroplasia"]},
        "designModule": {"phases": list(phases), "enrollmentInfo": {"count": 110}},
        "armsInterventionsModule": {"interventions": [{"type": "DRUG", "name": "Infigratinib"}, {"type": "OTHER", "name": "Placebo"}]}},
        "hasResults": results}


def test_slim_and_readouts():
    s = trials.slim(rec("NCT00000001"))
    assert s["nct"] == "NCT00000001" and s["phase"] == "Phase 3" and s["interventions"] == ["Infigratinib"]
    rows = [trials.slim(r) for r in (rec("NCT1"), rec("NCT2", phases=("PHASE1",)), rec("NCT3", status="COMPLETED"),
                                     rec("NCT4", pc="2030-01"), rec("NCT5", cls="OTHER"), rec("NCT6", pc="2026-12-04"))]
    r = trials.expected_readouts(rows, date(2026, 10, 31))
    assert [x["nct"] for x in r] == ["NCT6", "NCT1"] and r[1]["primary_completion_date"] == "2027-03-15"


def test_diff_events():
    old = [trials.slim(rec("NCT1")), trials.slim(rec("NCT2", pc="2027-01"))]
    new = [trials.slim(rec("NCT1", status="TERMINATED", why="Business decision")),
           trials.slim(rec("NCT2", pc="2027-06", results=True)), trials.slim(rec("NCT9", phases=("PHASE2",)))]
    assert trials.diff_events("BBIO", None, new, "2026-10-31", feed._eid) == []      # first run: silent
    ev = trials.diff_events("BBIO", old, new, "2026-10-31", feed._eid)
    kinds = sorted(e["values"]["kind"] for e in ev)
    assert kinds == ["date", "new", "results", "status"]
    stop = next(e for e in ev if e["values"]["kind"] == "status")
    assert stop["severity"] == "warn" and "Business decision" in stop["detail"]
    slip = next(e for e in ev if e["values"]["kind"] == "date")
    assert "repoussée" in slip["title"] and slip["severity"] == "warn"
