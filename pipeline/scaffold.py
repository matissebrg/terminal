"""Add a stock to the terminal in one command (or one click in GitHub Actions).

    python -m pipeline.scaffold WMT --peers COST,TGT,KR --etf XLP --etf-name "Consommation de base (ETF XLP)"

What it does
------------
1. Finds the company at the SEC (CIK, legal name, industry code), and the peers' names.
2. Downloads its XBRL history, rebuilds the statements (same code as the site) and derives a
   *starting* DCF from history only:
     - revenue growth, years 1-5: last 3 fiscal years' CAGR, fading linearly toward 3 %
     - EBIT margin target: trailing-twelve-months operating margin (no improvement assumed)
     - tax rate: effective rate TTM, kept within 10 %-30 %
     - working capital: operating NWC / revenue of the last fiscal year (negative for retailers
       paid by customers before they pay suppliers)
     - bull / bear: growth ±3 pts and margin ×1.15 / ×0.85
   These are deliberately mechanical: they describe the past, not a view. Writing the view
   (thesis, growth, margins, scenarios, guidance) is the exercise.
3. Writes config/assumptions/<TICKER>.yaml (never overwrites an existing file without --force)
   and adds the stock, its peers and their SEC identifiers to config/universe.yaml, keeping the
   comments of that file.
4. Prints the resulting valuation as a sanity check.

The next pipeline run (triggered automatically by the GitHub workflow) builds every page.
"""
from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path

from . import market, normalize, sec, valuation

ROOT = Path(__file__).resolve().parent.parent
TERMINAL_G = 0.03


# --------------------------------------------------------------------------- sources
class SecSource:
    """Live SEC + market data. Tests pass a stand-in with the same four methods."""

    def __init__(self):
        self._titles = None

    def lookup(self, ticker: str) -> tuple[int, str]:
        if self._titles is None:
            self._titles = sec.ticker_titles()
        if ticker not in self._titles:
            raise SystemExit(f"{ticker} introuvable dans la liste de la SEC (valeur non cotée aux États-Unis, "
                             f"ou ticker mal orthographié ; les classes s'écrivent avec un tiret, ex. BRK-B).")
        return self._titles[ticker]

    def submissions(self, cik: int) -> dict:
        return sec.submissions(cik)

    def facts(self, cik: int) -> dict:
        return sec.company_facts(cik)

    def splits(self, ticker: str) -> list[dict]:
        try:
            return market.splits(ticker)
        except Exception:  # noqa: BLE001 - the YAML does not depend on per-share history
            return []


# --------------------------------------------------------------------------- defaults from history
def _pct(x: float) -> str:
    return f"{x * 100:.1f}".replace(".", ",") + " %"


def _clip(x, lo, hi):
    return max(lo, min(hi, x))


def history_defaults(fin: dict) -> dict:
    """Mechanical starting assumptions + the facts they come from (shown as YAML comments)."""
    L, T = fin["lines"], fin["ttm"]
    years = [p["label"] for p in fin["periods"]["annual"]]
    rev_a = [L["revenue"]["annual"].get(y) for y in years]
    pairs = [(y, v) for y, v in zip(years, rev_a) if v]
    notes = {}
    if len(pairs) >= 4:
        (y0, v0), (y1, v1) = pairs[-4], pairs[-1]
        g = (v1 / v0) ** (1 / 3) - 1
        notes["growth"] = f"croissance annuelle moyenne du CA {y0} → {y1} : {_pct(g)}"
    elif len(pairs) >= 2:
        (y0, v0), (y1, v1) = pairs[-2], pairs[-1]
        g = v1 / v0 - 1
        notes["growth"] = f"croissance du CA {y0} → {y1} : {_pct(g)} (historique court)"
    else:
        g = 0.05
        notes["growth"] = "historique insuffisant : 5 % par défaut"
    g1 = _clip(g, -0.10, 0.40)
    growth = [round(TERMINAL_G + (g1 - TERMINAL_G) * (1 - i / 5), 3) for i in range(5)]

    rev = T.get("revenue")
    oi = T.get("operating_income")
    margin = round(oi / rev, 3) if rev and oi is not None else 0.10
    notes["margin"] = (f"marge opérationnelle {T.get('_label', 'TTM')} : {_pct(oi / rev)}" if rev and oi is not None
                       else "marge inconnue : 10 % par défaut")

    tax, pre = T.get("income_tax"), T.get("pretax_income")
    if tax is not None and pre and pre > 0:
        t = _clip(tax / pre, 0.10, 0.30)
        notes["tax"] = f"taux effectif {T.get('_label', 'TTM')} : {_pct(tax / pre)}"
    else:
        t = 0.21
        notes["tax"] = "taux effectif inconnu : 21 % (taux fédéral US) par défaut"
    t = round(t, 3)

    nwc = 0.10
    notes["nwc"] = "BFR inconnu : 10 % par défaut"
    if years:
        y = years[-1]
        g_ = lambda n: L.get(n, {}).get("annual", {}).get(y)  # noqa: E731
        ca, cl, cash = g_("current_assets"), g_("current_liabilities"), g_("cash")
        if ca is not None and cl is not None and rev_a[-1]:
            op_nwc = (ca - (cash or 0) - (g_("short_term_investments") or 0)) - (cl - (g_("debt_current") or 0))
            nwc = round(_clip(op_nwc / rev_a[-1], -0.15, 0.30), 3)
            notes["nwc"] = f"BFR d'exploitation {y} : {_pct(op_nwc / rev_a[-1])} du CA"
    from .predictions import naive_backtest
    bt = naive_backtest(fin)
    naive = "seasonal" if (bt.get("seasonal") is not None and bt.get("sequential") is not None
                           and bt["seasonal"] < bt["sequential"]) else "sequential"
    notes["naive"] = (f"erreur moyenne du modèle naïf sur 8 trimestres : séquentiel "
                      f"{_pct(bt['sequential']) if bt.get('sequential') is not None else '-'}, saisonnier "
                      f"{_pct(bt['seasonal']) if bt.get('seasonal') is not None else '-'}")
    # ROIC TTM: NOPAT / operating invested capital. Used for the terminal reinvestment (g / ROIC), so that
    # today's capex intensity (e.g. an AI build-out at 30 % of revenue) is not assumed to last forever.
    roic = None
    ic = sum(T.get(k) or 0 for k in ("equity", "total_debt", "minority_interest")) \
        - sum(T.get(k) or 0 for k in ("cash", "short_term_investments", "equity_investments"))
    if oi is not None and ic > 0:
        r_ = oi * (1 - t) / ic
        roic = round(_clip(r_, 0.06, 0.40), 3)
        notes["roic"] = f"ROIC {T.get('_label', 'TTM')} : {_pct(r_)} (NOPAT / capitaux investis)"
    else:
        notes["roic"] = "ROIC non calculable : pas de réinvestissement terminal explicite"
    return {"growth": growth, "margin": margin, "tax": t, "nwc": nwc, "naive": naive, "roic": roic, "notes": notes}


def _fmt_list(xs):
    return "[" + ", ".join(f"{x:.3f}".rstrip("0").rstrip(".") if x else "0.0" for x in xs) + "]"


def assumptions_yaml(ticker: str, name: str, fin: dict, peers: list[str], today: str) -> str:
    d = history_defaults(fin)
    n = d["notes"]
    bull = [round(x + 0.03, 3) for x in d["growth"]]
    bear = [round(x - 0.03, 3) for x in d["growth"]]
    m = d["margin"]
    return f"""# ============================================================================
# Hypothèses de valorisation - {name} ({ticker})
# ----------------------------------------------------------------------------
# Fichier créé automatiquement le {today} par `python -m pipeline.scaffold` à partir
# de l'HISTORIQUE seul (SEC) : il décrit le passé, ce n'est pas une prévision.
# À toi d'écrire la vue : thèse, croissance, marges, scénarios, guidance.
#   - {n['growth']}
#   - {n['margin']}
#   - {n['tax']}
#   - {n['nwc']}
#   - {n['roic']}
#
# Modifier depuis GitHub : ouvre ce fichier sur github.com, clique sur le crayon,
# commit -> le site se met à jour tout seul en ~2 minutes. Le simulateur de l'onglet
# Valorisation permet d'essayer des chiffres puis de copier le YAML correspondant.
# "auto" = valeur calculée à partir des données (TTM) ou du marché.
# ============================================================================

ticker: {ticker}
updated: {today}
thesis: >
  À écrire : pourquoi cette valeur, ce que le marché price, ce qui ferait changer d'avis.

dcf:
  years: 10
  base_revenue: ttm
  # Années 1 à 5 (point de départ mécanique : croissance passée qui converge vers {_pct(TERMINAL_G)}).
  revenue_growth: {_fmt_list(d['growth'])}
  ebit_margin_start: auto
  ebit_margin_target: {m}          # marge actuelle maintenue (aucune amélioration supposée)
  margin_years_to_target: 5
  tax_rate: {d['tax']}
  d_and_a_pct_revenue: auto
  capex_pct_revenue: auto
  nwc_pct_incremental_revenue: {d['nwc']}
  terminal_growth: {TERMINAL_G}
  # Réinvestissement terminal = croissance terminale / ROIC : le capex actuel n'est pas supposé durer
  # indéfiniment. null = capex et amortissements des années explicites prolongés tels quels.
  terminal_roic: {d['roic'] if d['roic'] is not None else 'null'}
  mid_year: true
  include_equity_investments: true

wacc:
  method: capm
  fixed: 0.09
  risk_free: auto
  risk_free_fallback: 0.044
  beta: auto
  beta_fallback: 1.0
  equity_risk_premium: 0.045
  pre_tax_cost_of_debt: 0.05
  debt_weight: auto

scenarios:
  base:
    probability: 0.50
    narrative: Prolongement mécanique de l'historique (à remplacer par ta vue).
  bull:
    probability: 0.25
    narrative: Croissance supérieure de 3 points et marge cible +15 % (à préciser).
    overrides:
      dcf:
        revenue_growth: {_fmt_list(bull)}
        ebit_margin_target: {round(m * 1.15, 3)}
  bear:
    probability: 0.25
    narrative: Croissance inférieure de 3 points et marge cible -15 % (à préciser).
    overrides:
      dcf:
        revenue_growth: {_fmt_list(bear)}
        ebit_margin_target: {round(m * 0.85, 3)}

comps:
  peers: [{", ".join(peers)}]

predictions:
  # Modèle naïf à battre : sequential (dernier trimestre × dernière croissance séquentielle) ou
  # seasonal (même trimestre de l'an dernier × croissance sur un an, pour les activités saisonnières).
  # Choisi automatiquement : le plus précis sur l'historique ({n['naive']}).
  naive: {d['naive']}

# Guidance publiée par la société, par période (Md$, %), pour comparer tes prédictions.
# Exemple :
#   Q3 FY2027: {{revenue: 100.0, revenue_low: 98.0, revenue_high: 102.0, gross_margin: 40.0, source: communiqué du ...}}
guidance: {{}}
"""


# --------------------------------------------------------------------------- universe.yaml (comments kept)
def _yaml():
    from ruamel.yaml import YAML
    y = YAML()
    y.preserve_quotes = True
    y.indent(mapping=2, sequence=4, offset=2)
    y.width = 120
    return y


def _append(mapping, key, value) -> None:
    """Add key at the end of a ruamel mapping, keeping the comment / blank line that followed the
    previous last key *after* the new one (ruamel attaches it to the last key)."""
    if key in mapping:
        mapping[key] = value
        return
    last = list(mapping.keys())[-1] if len(mapping) else None
    mapping[key] = value
    if last is not None and last in mapping.ca.items:
        trailing = mapping.ca.items[last]
        if len(trailing) > 2 and trailing[2] is not None:
            mapping.ca.items[key] = [None, None, trailing[2], None]
            trailing[2] = None


def family_of_sic(sic) -> str | None:
    """SEC industry code -> broad sector used by the badges (tech, conso, sante, finance, energie, industrie)."""
    try:
        c = int(sic)
    except (TypeError, ValueError):
        return None
    if 3570 <= c <= 3579 or 3600 <= c <= 3699 or 7370 <= c <= 7379 or 4810 <= c <= 4899 or 3820 <= c <= 3829:
        return "tech"
    if 2833 <= c <= 2836 or 3840 <= c <= 3851 or 8000 <= c <= 8099 or c == 5122:
        return "sante"
    if 6000 <= c <= 6799:
        return "finance"
    if 1300 <= c <= 1399 or 2900 <= c <= 2999 or 4900 <= c <= 4999:
        return "energie"
    if 2000 <= c <= 2399 or 2840 <= c <= 2844 or 5000 <= c <= 5999 or 7000 <= c <= 7299 or c in (3711, 3714, 3751):
        return "conso"
    return "industrie"


def update_universe(path: Path, ticker: str, entry: dict, peers: dict[str, tuple[int, str]], cik: int,
                    etf: str | None, etf_name: str | None, families: dict[str, str] | None = None) -> None:
    from ruamel.yaml.comments import CommentedMap, CommentedSeq
    y = _yaml()
    u = y.load(path.read_text())
    tickers = u.setdefault("tickers", CommentedMap())
    cm = CommentedMap()
    for k, v in entry.items():
        if isinstance(v, list):
            seq = CommentedSeq(v)
            seq.fa.set_flow_style()
            cm[k] = seq
        else:
            cm[k] = v
    if ticker in tickers:
        tickers[ticker].update(cm)
    else:
        _append(tickers, ticker, cm)
    names = u.setdefault("peer_names", CommentedMap())
    ciks = u.setdefault("ciks", CommentedMap())
    if ticker not in ciks:
        _append(ciks, ticker, cik)
    for p, (pcik, title) in peers.items():
        if p not in names and p not in tickers:
            _append(names, p, title)
        if p not in ciks:
            _append(ciks, p, pcik)
    if families:
        fam = u.setdefault("families", CommentedMap())
        for k, v in families.items():
            if v and k not in fam:
                _append(fam, k, v)
    if etf:
        benches = u.setdefault("benchmarks", CommentedMap())
        if etf not in benches:
            _append(benches, etf, etf_name or etf)
    with path.open("w") as f:
        y.dump(u, f)


def _pretty(title: str) -> str:
    """SEC titles are often upper case ("WALMART INC.") -> "Walmart Inc."; state suffixes
    ("Costco Wholesale Corp /new", "QUALCOMM INC/DE") are dropped."""
    import re
    title = re.sub(r"\s*/[A-Za-z]{2,3}/?\s*$", "", title.strip())
    if title.isupper():
        small = {"OF", "AND", "THE", "&"}
        return " ".join(w.capitalize() if w not in small else w.lower() for w in title.split())
    return title


# --------------------------------------------------------------------------- main
def scaffold(ticker: str, peers: list[str], src, root: Path = ROOT, sector: str | None = None,
             industry: str | None = None, etf: str | None = None, etf_name: str | None = None,
             force: bool = False, today: str | None = None) -> dict:
    ticker = ticker.upper().strip()
    peers = [p.upper().strip() for p in peers if p.strip() and p.upper().strip() != ticker]
    today = today or date.today().isoformat()
    cik, title = src.lookup(ticker)
    subs = src.submissions(cik)
    name = _pretty(subs.get("name") or title)
    facts = src.facts(cik)
    fin = normalize.normalize(facts, splits=src.splits(ticker))
    if not fin["periods"]["quarterly"] or fin["ttm"].get("revenue") is None:
        raise SystemExit(f"{ticker} : états financiers XBRL inexploitables (pas de chiffre d'affaires trimestriel).")

    peer_info = {}
    fams = {ticker: family_of_sic(subs.get("sic"))}
    for p in peers:
        try:
            pcik, ptitle = src.lookup(p)
            peer_info[p] = (pcik, _pretty(ptitle))
            try:
                fams[p] = family_of_sic(src.submissions(pcik).get("sic"))
            except Exception:  # noqa: BLE001 - the sector is a nice-to-have
                pass
        except SystemExit as exc:
            print(f"  ! pair ignoré : {exc}")
    apath = root / "config" / "assumptions" / f"{ticker}.yaml"
    if apath.exists() and not force:
        print(f"{apath.relative_to(root)} existe déjà : conservé (ajoute --force pour le régénérer).")
    else:
        apath.write_text(assumptions_yaml(ticker, name, fin, list(peer_info), today))
        print(f"écrit : {apath.relative_to(root)}")

    entry = {"name": name, "sector": sector or (subs.get("sicDescription") or "").capitalize() or "-",
             "industry": industry or (subs.get("sicDescription") or "").capitalize() or "-",
             "peers": list(peer_info)}
    entry["benchmarks"] = ["SPY"] + ([etf] if etf else [])
    update_universe(root / "config" / "universe.yaml", ticker, entry, peer_info, cik, etf, etf_name, fams)
    print(f"config/universe.yaml : {ticker} ajouté ({len(peer_info)} pair(s)).")

    # sanity check with the generated assumptions (price unknown here: per-share value only)
    import yaml
    assump = yaml.safe_load(apath.read_text())
    shares = (fin.get("shares_outstanding") or [{}])[-1].get("shares") or fin["ttm"].get("diluted_shares")
    mkt = {"price": None, "shares": shares, "mcap": None, "rf": (0.044, "défaut", None), "beta": None}
    v = valuation.dcf(valuation.resolve(assump, fin, mkt))
    d = history_defaults(fin)
    summary = {"ticker": ticker, "name": name, "cik": cik, "peers": list(peer_info),
               "last_quarter": fin["periods"]["quarterly"][-1]["label"],
               "revenue_ttm": fin["ttm"].get("revenue"), "defaults": {k: d[k] for k in ("growth", "margin", "tax", "nwc")},
               "value_per_share_hint": v["value_per_share"], "quality": normalize.quality(fin)}
    print(f"{name} ({ticker}) · dernier trimestre {summary['last_quarter']} · CA TTM "
          f"{summary['revenue_ttm'] / 1e9:,.1f} Md$ · valeur indicative {v['value_per_share']:,.2f} $/action "
          f"(WACC provisoire, avant le bêta réel)")
    for q in summary["quality"]:
        print(f"  ! qualité : {q}")
    return summary


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Ajoute une valeur au terminal.")
    ap.add_argument("ticker")
    ap.add_argument("--peers", default="", help="tickers des pairs, séparés par des virgules")
    ap.add_argument("--sector")
    ap.add_argument("--industry")
    ap.add_argument("--etf", help="ETF sectoriel de comparaison (ex. XLP)")
    ap.add_argument("--etf-name")
    ap.add_argument("--force", action="store_true", help="régénère le fichier d'hypothèses existant")
    a = ap.parse_args(argv)
    peers = [p for p in a.peers.replace(";", ",").replace(" ", ",").split(",") if p]
    scaffold(a.ticker, peers, SecSource(), sector=a.sector, industry=a.industry, etf=(a.etf or "").upper() or None,
             etf_name=a.etf_name, force=a.force)
    return 0


if __name__ == "__main__":
    sys.exit(main())
