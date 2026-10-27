# Terminal — suivi & valorisation d'actions

Terminal personnel d'analyse fondamentale, consultable partout (GitHub Pages) et mis à jour automatiquement (GitHub Actions).
Première valeur couverte : **NVIDIA (NVDA)**, comparée à AMD, Broadcom, Qualcomm, Intel et Marvell.

**Site :** `https://matissebrg.github.io/terminal/`

| Page | Contenu |
|---|---|
| Tableau de bord | valeurs suivies, potentiel vs cours, indices, taux sans risque, feed |
| Synthèse | cours, verdict du modèle (scénarios), football field, chiffres clés TTM, thèse |
| États financiers | compte de résultat, bilan, flux — annuel / trimestriel, variations N−1, liens EDGAR, export CSV |
| Ratios | 25 ratios (rentabilité, rendement du capital, croissance, coûts, bilan, efficacité, allocation) |
| Valorisation | DCF FCFF + simulateur interactif, scénarios bear/base/bull, sensibilités, DCF reverse, comparables, historique |
| Secteur | table des pairs, VE/CA vs croissance, marges, CA indexé, performance relative |
| Performance | chandeliers / aire / comparaison % vs SPY et SOXX, rendements, volatilité, drawdown, bêta |
| Dépôts SEC | 10-K, 10-Q, 8-K de résultats |
| Feed | publications, réévaluations (avec décomposition), mouvements ±5 %, franchissement de la valeur |

Raccourcis : `Ctrl K` ou `/` pour la recherche, `1`…`7` pour changer d'onglet.

---

## Comment ça marche

```
GitHub Actions (2×/jour ouvré, ou à chaque modification des hypothèses)
   │
   ├─ SEC EDGAR (XBRL companyfacts + submissions)      ── états financiers, dépôts
   ├─ Yahoo Finance → Stooq → cache                     ── cours journaliers
   └─ FRED DGS10                                        ── taux sans risque
   │
   ▼
pipeline/  normalize → ratios → valuation → feed  ──►  docs/data/*.json  ──►  GitHub Pages (docs/)
                                                          │
                                                          └─ history.json = la « base de données » (un instantané par jour)
```

- **`config/assumptions/NVDA.yaml` est ton modèle.** Modifie-le sur GitHub (icône crayon → *Commit*) : le workflow se relance, recalcule, et publie un événement dans le feed si la valeur bouge.
- Chaque événement de valorisation est **décomposé** : effet des nouvelles données financières, effet de tes hypothèses, effet des paramètres de marché (taux, bêta).
- Le simulateur de la page *Valorisation* recalcule le DCF dans le navigateur. Bouton *Copier en YAML* → coller dans le fichier d'hypothèses pour le rendre officiel.

## Mise en route (une seule fois)

1. **Settings → Pages → Build and deployment → Source : `GitHub Actions`.**
2. **Settings → Actions → General → Workflow permissions : `Read and write permissions`** (le workflow enregistre l'historique dans le repo).
3. *(Recommandé)* **Settings → Secrets and variables → Actions → New repository secret** :
   `SEC_USER_AGENT` = `Matisse Bourgeois ton.email@exemple.com`. La SEC demande un User-Agent identifiant un contact ; le secret évite de mettre ton e-mail en clair dans un repo public.
4. **Actions → update-data → Run workflow.** Le site est en ligne ~2 minutes après.

> ⚠ GitHub désactive les workflows planifiés d'un repo public après 60 jours sans activité. Les commits automatiques de données devraient suffire à le maintenir actif ; si jamais il s'arrête, un clic sur *Enable workflow* dans l'onglet Actions le relance.

## Ajouter une valeur

1. Dans `config/universe.yaml`, ajouter le ticker (US, déposant à la SEC) avec son nom, son secteur et ses pairs.
2. Copier `config/assumptions/NVDA.yaml` en `config/assumptions/<TICKER>.yaml` et adapter les hypothèses.
3. Commit → le workflow fait le reste.

## Méthode

**Reconstruction des états financiers** (`pipeline/normalize.py`) — le XBRL de la SEC n'est pas utilisable tel quel :
flux de trésorerie des 10-Q publiés en cumul (3/6/9 mois) → trimestres reconstruits par différence ; T4 = exercice − 9 mois ;
retraitements → valeur la plus récemment déposée ; changements d'étiquettes XBRL → liste ordonnée d'étiquettes par ligne ;
exercices de 52/53 semaines → tolérance sur les dates. Toutes les lignes sont converties dans un **schéma canonique interne**
(`revenue`, `operating_income`, `fcf`…) : c'est ce qui permettra d'ajouter plus tard des sources IFRS/ESEF (Europe).

**DCF** (`pipeline/valuation.py`, jumeau JS `docs/assets/dcf.js`) — FCFF = EBIT × (1 − t) + D&A − capex − ΔBFR ;
croissance explicite puis fondu linéaire vers g ; marge qui converge vers une cible ; valeur terminale de Gordon (option :
réinvestissement = g / ROIC terminal) ; convention mi-année ; WACC CAPM (rf FRED, bêta 2 ans hebdo vs SPY ajusté Blume,
écarté si R² < 0,05). La rémunération en actions n'est pas réintégrée (c'est un coût réel). DCF reverse : croissance constante
qui justifie le cours.

**Comparables** — multiples TTM (VE/CA, VE/EBITDA, P/E, Capi/FCF), médiane des pairs, multiples négatifs ou > 500x exclus.
Limite assumée : des multiples passés de pairs moins dynamiques sous-évaluent une entreprise en hypercroissance.

## Développement local

```bash
pip install -r requirements.txt
python -m pytest -q                                   # 66 tests (normalisation, DCF, feed, parité Python/JS)

# Aperçu hors-ligne avec des données SYNTHÉTIQUES (jamais publiées)
python tests/fixtures/make_fixtures.py
python -m pipeline.build --fixtures tests/fixtures --out /tmp/site/data
cp -r docs/assets docs/index.html /tmp/site/ && python -m http.server -d /tmp/site 8000

# Données réelles (nécessite un accès réseau à sec.gov)
SEC_USER_AGENT="Nom email@exemple.com" python -m pipeline.build
```

Les fixtures reproduisent volontairement les pièges du vrai XBRL (cumuls YTD, T4 absent, exercices de 53 semaines,
retraitement, changement d'étiquette) et les tests vérifient chaque reconstruction contre la vérité connue.

## Limites (honnêtes)

- Cours de **clôture**, pas de temps réel ; sources de cours gratuites non officielles (repli automatique, signalé dans l'interface).
- Pas de **consensus** analystes (payant) : pas encore de mesure de « surprise » vs attentes.
- Couverture **US uniquement** (SEC). L'Europe (ESEF) demandera un mapping IFRS.
- Les hypothèses de départ de NVDA sont un **point de départ** posé le 27/10/2026, pas une prévision.

## Pistes pour la suite

Registre de prévisions pré-enregistrées (ta prévision vs consensus vs réalisé, score de Brier) · forecasting par segment
(Data Center, Gaming…) à partir des tableaux XBRL dimensionnels · extraction des KPI des communiqués 8-K · rNPV pour les
biotechs (AGIO) · couverture européenne via filings.xbrl.org / ESAP · alertes par e-mail · pondération de portefeuille.

---
Sources : SEC EDGAR, FRED (Federal Reserve Bank of St. Louis), Yahoo Finance, Stooq. Graphiques :
[TradingView Lightweight Charts™](https://www.tradingview.com/) (Apache 2.0) et Apache ECharts (Apache 2.0).
Outil personnel d'étude — pas un conseil en investissement.
