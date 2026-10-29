"""Adding a stock: SEC lookup -> assumptions YAML from history -> universe.yaml updated (comments kept)."""
import json
import shutil
from pathlib import Path

import pytest
import yaml

from pipeline import build, normalize, scaffold, valuation

FIX = Path(__file__).parent / "fixtures"
ROOT = Path(__file__).resolve().parent.parent
CIKS = {"AMD": (2488, "ADVANCED MICRO DEVICES INC"), "NVDA": (1045810, "NVIDIA CORP"),
        "INTC": (50863, "INTEL CORP"), "QCOM": (804328, "QUALCOMM INC/DE")}


class FakeSec:
    def lookup(self, t):
        if t not in CIKS:
            raise SystemExit(f"{t} introuvable")
        return CIKS[t]

    def submissions(self, cik):
        t = next(k for k, v in CIKS.items() if v[0] == cik)
        return json.loads((FIX / f"subs_{t}.json").read_text())

    def facts(self, cik):
        t = next(k for k, v in CIKS.items() if v[0] == cik)
        return json.loads((FIX / f"facts_{t}.json").read_text())

    def splits(self, t):
        return []


@pytest.fixture()
def repo(tmp_path):
    (tmp_path / "config" / "assumptions").mkdir(parents=True)
    shutil.copy(ROOT / "config" / "universe.yaml", tmp_path / "config" / "universe.yaml")
    shutil.copy(ROOT / "config" / "assumptions" / "NVDA.yaml", tmp_path / "config" / "assumptions" / "NVDA.yaml")
    return tmp_path


def test_scaffold_adds_a_stock(repo):
    out = scaffold.scaffold("amd", ["intc", "QCOM", "ZZZZ", "AMD"], FakeSec(), root=repo, etf="SMH",
                            etf_name="Semis (ETF SMH)", today="2026-10-29")
    assert out["peers"] == ["INTC", "QCOM"]                      # unknown and self removed
    text = (repo / "config" / "universe.yaml").read_text()
    assert "# Univers suivi par le terminal." in text             # comments kept
    u = yaml.safe_load(text)
    assert u["tickers"]["AMD"]["peers"] == ["INTC", "QCOM"]
    assert u["tickers"]["AMD"]["benchmarks"] == ["SPY", "SMH"]
    assert u["tickers"]["NVDA"]["peers"] == ["AMD", "AVGO", "QCOM", "INTC", "MRVL"]   # untouched
    assert u["ciks"]["AMD"] == 2488 and u["benchmarks"]["SMH"] == "Semis (ETF SMH)"
    a = yaml.safe_load((repo / "config" / "assumptions" / "AMD.yaml").read_text())
    assert a["ticker"] == "AMD" and len(a["dcf"]["revenue_growth"]) == 5
    assert a["dcf"]["revenue_growth"][-1] < a["dcf"]["revenue_growth"][0] or a["dcf"]["revenue_growth"][0] <= 0.03
    assert 0.10 <= a["dcf"]["tax_rate"] <= 0.30
    assert a["comps"]["peers"] == ["INTC", "QCOM"]
    assert sum(s["probability"] for s in a["scenarios"].values()) == pytest.approx(1.0)
    assert out["value_per_share_hint"] and out["value_per_share_hint"] > 0


def test_generated_file_runs_through_the_real_valuation(repo):
    scaffold.scaffold("AMD", ["INTC"], FakeSec(), root=repo, today="2026-10-29")
    a = yaml.safe_load((repo / "config" / "assumptions" / "AMD.yaml").read_text())
    fin = normalize.normalize(json.loads((FIX / "facts_AMD.json").read_text()))
    mkt = {"price": 150.0, "shares": 1.6e9, "mcap": 2.4e11, "rf": (0.043, "test", None), "beta": None}
    sc = valuation.scenarios(a, fin, mkt)
    assert set(sc["cases"]) == {"base", "bull", "bear"}
    assert sc["cases"]["bull"]["value_per_share"] > sc["cases"]["base"]["value_per_share"] > sc["cases"]["bear"]["value_per_share"]


def test_existing_assumptions_are_never_overwritten(repo):
    p = repo / "config" / "assumptions" / "NVDA.yaml"
    before = p.read_text()
    scaffold.scaffold("NVDA", ["AMD"], FakeSec(), root=repo, today="2026-10-29")
    assert p.read_text() == before


def test_history_defaults_growth_fades_to_terminal():
    fin = normalize.normalize(json.loads((FIX / "facts_INTC.json").read_text()))
    d = scaffold.history_defaults(fin)
    g = d["growth"]
    assert len(g) == 5 and all(abs((g[i + 1] - g[i]) - (g[1] - g[0])) < 0.002 for i in range(4))
    assert -0.15 <= d["nwc"] <= 0.30


def test_pretty_names():
    assert scaffold._pretty("WALMART INC.") == "Walmart Inc."
    assert scaffold._pretty("Costco Wholesale Corp") == "Costco Wholesale Corp"


def test_pretty_drops_state_suffix():
    assert scaffold._pretty("Costco Wholesale Corp /new") == "Costco Wholesale Corp"
    assert scaffold._pretty("QUALCOMM INC/DE") == "Qualcomm Inc"


def test_terminal_roic_from_history(repo):
    scaffold.scaffold("AMD", ["INTC"], FakeSec(), root=repo, today="2026-10-29")
    a = yaml.safe_load((repo / "config" / "assumptions" / "AMD.yaml").read_text())
    r = a["dcf"]["terminal_roic"]
    assert r is None or 0.06 <= r <= 0.40
    assert "ROIC" in (repo / "config" / "assumptions" / "AMD.yaml").read_text()


def test_sector_family_from_sic(repo):
    assert scaffold.family_of_sic("3674") == "tech" and scaffold.family_of_sic(5331) == "conso"
    assert scaffold.family_of_sic("2834") == "sante" and scaffold.family_of_sic("6021") == "finance"
    assert scaffold.family_of_sic("2911") == "energie" and scaffold.family_of_sic("3720") == "industrie"
    assert scaffold.family_of_sic(None) is None
    scaffold.scaffold("AMD", ["INTC"], FakeSec(), root=repo, today="2026-10-29")
    fam = yaml.safe_load((repo / "config" / "universe.yaml").read_text())["families"]
    assert fam["NVDA"] == "tech"                                       # existing entries kept
