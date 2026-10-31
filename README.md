<p align="center"><img src="docs/assets/brand/archer-lockup.png" alt="Archer Terminal" width="360"></p>

# Archer Terminal

Terminal personnel d'analyse fondamentale et d'entraînement à la prévision, consultable partout (GitHub Pages) et mis à jour automatiquement (GitHub Actions).
Première valeur couverte : **NVIDIA (NVDA)**, comparée à AMD, Broadcom, Qualcomm, Intel et Marvell.

**Site :** `https://matissebrg.github.io/terminal/`

| Page | Contenu |
|---|---|
| Tableau de bord | valeurs suivies, potentiel vs cours, indices, taux sans risque, feed |
| Synthèse | cours, verdict du modèle (scénarios), football field, chiffres clés TTM, thèse |
| États financiers | compte de résultat, bilan, flux - annuel / trimestriel, variations N-1, liens EDGAR, export CSV |
| Ratios | 25 ratios (rentabilité, rendement du capital, croissance, coûts, bilan, efficacité, allocation) |
| Valorisation | DCF FCFF + simulateur interactif, scénarios bear/base/bull, sensibilités, DCF reverse, comparables, historique |
| **Prédictions** | registre de prévisions horodatées par Git, vérifiées automatiquement contre le réel, le consensus, la guidance et un modèle naïf |
| Options | volatilité implicite (30/90 j, structure par terme, smile), open interest, put/call, choc de résultats implicite vs réactions passées |
| Secteur | table des pairs, VE/CA vs croissance, marges, CA indexé, performance relative |
| Performance | chandeliers / aire / comparaison % vs SPY et SOXX, rendements, volatilité, drawdown, bêta |
| Dépôts SEC | 10-K, 10-Q, 8-K de résultats |
| Feed | publications, réévaluations (avec décomposition), mouvements ±5 %, franchissement de la valeur, prédictions |

Raccourcis : `Ctrl K` ou `/` pour la recherche, `1` à `9` pour changer d'onglet.

---

## Comment ça marche

```
GitHub Actions (2×/jour ouvré, ou à chaque modification des hypothèses)
   │
   ├─ SEC EDGAR (XBRL companyfacts + submissions)      ── états financiers, dépôts
   ├─ Yahoo Finance (yfinance) → Stooq → cache          ── cours, divisions, options, consensus, date de résultats
   └─ FRED DGS10 → Trésor US                            ── taux sans risque
   │
   ▼
pipeline/  normalize → ratios → valuation → feed  ──►  docs/data/*.json  ──►  GitHub Pages (docs/)
                                                          │
                                                          └─ history.json = la « base de données » (un instantané par jour)
```

- **`config/assumptions/NVDA.yaml` est ton modèle.** Modifie-le sur GitHub (icône crayon → *Commit*) : le workflow se relance, recalcule, et publie un événement dans le feed si la valeur bouge.
- Chaque événement de valorisation est **décomposé** : effet des nouvelles données financières, effet de tes hypothèses, effet des paramètres de marché (taux, bêta).
- Le simulateur de la page *Valorisation* recalcule le DCF dans le navigateur. Bouton *Copier en YAML* → coller dans le fichier d'hypothèses pour le rendre officiel.

## Prédictions : s'entraîner à prévoir

1. Onglet **Prédictions** d'une valeur : le contexte (8 derniers trimestres, modèle naïf, guidance, consensus) est affiché.
2. Saisis tes prévisions (CA, marges, résultat, BPA, FCF), un **intervalle à 80 %**, des questions oui / non avec une
   probabilité, des objectifs de cours, et ton raisonnement.
3. **Enregistrer sur GitHub** ouvre un nouveau fichier `config/predictions/<TICKER>/…yaml` pré-rempli : clique *Commit changes*.
   **L'heure du commit fait foi** : seule la dernière version commitée avant 00:00 (New York) le jour de la publication compte.
4. À la publication, le pipeline vérifie tout seul : erreur, intervalle, comparaison au consensus figé la veille, à la guidance
   et au modèle naïf, « surprise bien anticipée » (ton chiffre et le réel du même côté du consensus), score de Brier.
5. La page **Prédictions** cumule : erreur moyenne, **biais** (trop optimiste / pessimiste), taux de réussite des intervalles
   (cible 80 %), victoires contre le consensus et le naïf, calibration des probabilités.

Écriture à la main possible : voir `config/predictions/_modele.yaml`. La guidance de la société se renseigne dans
`config/assumptions/<TICKER>.yaml` (section `guidance`). Le consensus est relevé chaque jour dans `docs/data/<T>/consensus.json`.

## Espace membres (bêta fermée)

Comptes, prédictions enregistrées en base, classement et portefeuilles fictifs, pour un petit groupe sur invitation.
Hébergé sur [Supabase](https://supabase.com) (Postgres + authentification, offre gratuite), le site reste sur GitHub Pages.

- **Toutes les règles sont dans la base** (`supabase/migrations/0001_community.sql`) : date limite, archivage des versions,
  prévisions des autres invisibles avant la limite, argent fictif modifiable uniquement par les fonctions d'exécution.
  Un membre qui appellerait l'API directement ne peut pas tricher. Testé sur un vrai PostgreSQL (`tests/test_db.py`).
- **Le pipeline** (`pipeline/community.py`) ouvre les périodes, publie les derniers cours, exécute les ordres à la clôture
  suivante, calcule le consensus de la communauté et note chaque prédiction (mêmes règles que le registre Git).
- Sans compte, l'onglet Prédictions garde le mode « fichier GitHub » ci-dessous.
- **Badges** (`supabase/migrations/0002_badges.sql`) : statuts Supporter (1 barre, attribué par un administrateur),
  Members (2, à l'adhésion), Founders (3, fondateur et 10 premiers membres), VIP (4, podium du classement dès 6 membres
  classés, ou attribué) ; 11 succès automatiques (première prédiction, raisonnement, multi-valeurs, premier ordre,
  CA à moins de 1 %, mieux que la foule, mieux que Wall Street, régulier, bien calibré, oracle, portefeuille +10 %).
  Chaque badge crée une notification (cloche + animation). Personne ne peut s'attribuer un badge.
- **Succès à 4 niveaux** (bronze, argent, or, platine ; `0003_social.sql`) : les plus durs récompensent la précision et la
  calibration, jamais le volume, et exigent un minimum de résultats (ex. Chirurgien : CA à 0,25 % ; Fléau de Wall Street :
  bat le consensus 3 publications de suite ; Maître de la calibration : 20 intervalles, 75 à 85 % de réussite ; Alpha :
  portefeuille qui bat le S&P 500 sur 90 jours). Rareté affichée (% des membres qui l'ont).
- **Succès ajoutés** (`0004_achievements.sql`) : Archer (inscription), Visionnaire (10 premiers inscrits), Maître du Sharpe
  (Sharpe annualisé >= 2 sur 90 jours, portefeuille investi à 50 % ou plus ; sur 30 jours l'erreur type du Sharpe
  annualisé est d'environ 3,5, donc trop dépendant de la chance), secteurs (« Adepte de la tech »… selon `families` dans
  `config/universe.yaml`, rempli depuis le code SIC à l'ajout d'une valeur) et Touche-à-tout (3 secteurs), ancienneté
  (1 mois à 10 ans).
- **Options** (`0005_options.sql`, `docs/assets/options-lab.js`) : onglet Options enrichi (grecques par strike, skew 25Δ par
  échéance, max pain, historique de l'IV 30 j, constructeur de stratégies avec payoff à l'échéance et aujourd'hui, points
  morts, probabilité de gain log-normale, grecques agrégées) et paper trading d'options : positions acheteuses uniquement,
  exécution à la clôture suivante au prix demandé (ask) à l'achat et offert (bid) à la vente, dénouement à l'échéance à la
  valeur intrinsèque. Les cotations du soir (après 16:00 New York) servent aux exécutions ; Yahoo ne publie pas de bid / ask
  avant l'ouverture. Succès : Premier contrat, Levier gagnant (position soldée à +100 % ou plus).
- **Titres** : chaque badge d'argent ou plus donne un titre, affiché à côté du pseudo (choisi dans *Mon compte*, vérifié par la base).
- **Profils** (`#/membre/<pseudo>`) : statut, titre, statistiques, badges, portefeuilles visibles et prédictions
  après la date limite. **Liste des membres** avec e-mails et dernières connexions : administrateurs seulement.
- **Messagerie privée** : lisible uniquement par les deux membres (pas par les administrateurs) ; blocage, 30 messages
  par 10 minutes, signalement (seul le message signalé est transmis aux administrateurs). Pas de chiffrement de bout en
  bout : les messages sont stockés dans la base Supabase. Rafraîchissement toutes les 8 secondes dans une conversation.

**Activation (une fois) :**

1. Créer un projet Supabase (région UE). *Authentication → Sign In / Providers → Email* : décocher **Confirm email**
   (l'envoi d'e-mails par défaut de Supabase est limité à l'équipe du projet).
2. Copier l'**URL du projet** et la **clé publishable** (`sb_publishable_…`) dans `docs/assets/config.js`. Elles sont publiques
   par conception (la sécurité vient des règles de la base). **Jamais la clé secrète ici.**
3. Secrets GitHub (*Settings → Secrets and variables → Actions*), qui ne quittent jamais GitHub :
   - `SUPABASE_DB_URL` : *Connect → Session pooler* (URI avec le mot de passe de la base ; la connexion directe est IPv6
     uniquement, inaccessible depuis GitHub Actions) ;
   - `SUPABASE_SERVICE_KEY` : clé secrète (`sb_secret_…`) ;
   - `ARCHER_ADMIN_EMAIL` : ton e-mail, pour rejoindre en fondateur sans code.
4. Lancer le workflow : il applique les migrations (`python -m pipeline.dbadmin migrate`), puis synchronise.
5. Sur le site : *Connexion → Créer un compte* avec cet e-mail, code vide → tu es administrateur et peux créer des codes
   d'invitation depuis *Mon compte*.

**Limites :** cours Yahoo Finance, dont les conditions interdisent la redistribution et l'usage commercial : acceptable pour
une bêta privée non commerciale, à remplacer par un fournisseur sous licence avant toute ouverture publique (la source est
isolée dans `pipeline/market.py`). Les divisions d'actions ne sont pas encore appliquées aux portefeuilles fictifs. Données
personnelles (RGPD) : e-mail et pseudo seulement, suppression du compte en un clic dans *Mon compte*.

## Mise en route (une seule fois)

1. **Settings → Pages → Build and deployment → Source : `GitHub Actions`.**
2. **Settings → Actions → General → Workflow permissions : `Read and write permissions`** (le workflow enregistre l'historique dans le repo).
3. *(Recommandé)* **Settings → Secrets and variables → Actions → New repository secret** :
   `SEC_USER_AGENT` = `Matisse Bourgeois ton.email@exemple.com`. La SEC demande un User-Agent identifiant un contact ; le secret évite de mettre ton e-mail en clair dans un repo public.
4. **Actions → update-data → Run workflow.** Le site est en ligne ~2 minutes après.

> ⚠ GitHub désactive les workflows planifiés d'un repo public après 60 jours sans activité. Les commits automatiques de données devraient suffire à le maintenir actif ; si jamais il s'arrête, un clic sur *Enable workflow* dans l'onglet Actions le relance.

## Ajouter une valeur (sans passer par Claude)

1. **Actions → « Ajouter une valeur » → Run workflow.** Renseigner le ticker (ex. `WMT`), les pairs
   (`COST,TGT,KR`), et si besoin le secteur, l'activité et un ETF sectoriel de comparaison (`XLP`, `XLK`, `XLF`…).
2. Le workflow trouve la société à la SEC, reconstruit son historique, écrit `config/assumptions/<TICKER>.yaml`
   et complète `config/universe.yaml`, puis relance la mise à jour du site (~3 minutes au total).
   Le résumé du run affiche le chiffre d'affaires, la valeur indicative et les éventuels problèmes de données.
3. **Le fichier d'hypothèses généré est mécanique** (croissance passée qui converge vers 3 %, marge actuelle
   maintenue, taux d'impôt effectif, BFR observé, bull / bear à ±3 points de croissance et ±15 % de marge, modèle
   naïf le plus précis sur l'historique). Il décrit le passé : écrire la thèse, la vraie croissance, la marge
   cible, les scénarios et la guidance, c'est le travail d'analyste. Modifier le fichier sur GitHub (crayon →
   *Commit*) ou passer par le simulateur de l'onglet *Valorisation* (*Copier en YAML*).

En local : `python -m pipeline.scaffold WMT --peers COST,TGT,KR --etf XLP --etf-name "Consommation de base (ETF XLP)"`.
Limites : sociétés déposant à la SEC uniquement (US et quelques étrangères en 20-F) ; banques et assureurs ont
des états financiers que le DCF « FCFF » ne modélise pas correctement. Retirer une valeur : supprimer son entrée
dans `config/universe.yaml`.

## Biotech : rNPV, catalyseurs, essais cliniques

Onglet **Biotech** d'une valeur (dès qu'elle est dans la famille « santé » ou que son fichier d'hypothèses contient
un bloc `rnpv:`, `catalysts:` ou `trials:`) et page **Biotech** du menu (calendrier de toutes les valeurs).

- **rNPV** (`pipeline/rnpv.py`, jumeau navigateur `docs/assets/rnpv.js`, parité testée) : somme des programmes, chacun
  = flux (montée vers le pic de ventes, plateau, chute après la perte d'exclusivité, marge, impôt, coûts de
  développement restants) × probabilité d'arriver sur le marché, actualisés ; + trésorerie nette - frais centraux.
  Probabilités par défaut : taux historiques de passage de phase par aire thérapeutique (BIO, Informa, QLS,
  2011-2020). Avec `primary: true`, la rNPV remplace le DCF comme valeur affichée (BBIO).
- **Catalyseurs** : date, type (PDUFA, résultats, comité...), programme lié. Calculés : saut du cours en cas de
  succès / d'échec, probabilité impliquée par le cours, mouvement anticipé par les options (volatilité ordinaire
  retirée via l'échéance précédente), comparaison au mouvement attendu par le modèle. Une fois l'événement passé,
  écrire `outcome: success` (ou `failure`, `mixed`) : les prédictions des membres sont notées.
- **Essais** : ClinicalTrials.gov (API v2), promoteurs listés dans `trials: {sponsors: [...]}`. Le feed signale
  les nouveaux essais, changements de statut (arrêt, suspension), retards de date de fin principale et résultats publiés.
- **Prédictions de catalyseurs** (migration `0006_catalysts.sql`) : probabilité donnée avant 00:00 New York le
  jour de l'événement, cachée aux autres tant qu'ils n'ont pas donné la leur, score de Brier contre le taux historique.

Modèle de bloc : `config/assumptions/BBIO.yaml`. Les pics de ventes y sont des hypothèses de départ à retravailler.

- **Biotechs sans chiffre d'affaires** (stade clinique) : acceptées par « Ajouter une valeur ». Le DCF vaut alors la
  trésorerie nette et la valeur affichée vient du bloc `rnpv:` à ajouter (le workflow le rappelle en avertissement).
- **Autonomie financière** : trésorerie / consommation moyenne des 4 derniers trimestres.
- **Bilan des catalyseurs passés** : la veille de chaque événement, probabilités, sauts attendus et mouvement des
  options sont figés (`docs/data/<T>/catalyst_history.json`) ; après, le site affiche la réaction réelle du cours.
- Un catalyseur peut exister sans programme rNPV (grande pharma) : donner `stage` et `area` pour la probabilité de base.

## Méthode

**Reconstruction des états financiers** (`pipeline/normalize.py`) - le XBRL de la SEC n'est pas utilisable tel quel :
flux de trésorerie des 10-Q publiés en cumul (3/6/9 mois) → trimestres reconstruits par différence ; T4 = exercice - 9 mois ;
retraitements → valeur la plus récemment déposée ; changements d'étiquettes XBRL → liste ordonnée d'étiquettes par ligne ;
exercices de 52/53 semaines → tolérance sur les dates. Toutes les lignes sont converties dans un **schéma canonique interne**
(`revenue`, `operating_income`, `fcf`…) : c'est ce qui permettra d'ajouter plus tard des sources IFRS/ESEF (Europe).

**DCF** (`pipeline/valuation.py`, jumeau JS `docs/assets/dcf.js`) - FCFF = EBIT × (1 - t) + D&A - capex - ΔBFR ;
croissance explicite puis fondu linéaire vers g ; marge qui converge vers une cible ; valeur terminale de Gordon (option :
réinvestissement = g / ROIC terminal) ; convention mi-année ; WACC CAPM (rf FRED, bêta 2 ans hebdo vs SPY ajusté Blume,
écarté si R² < 0,05). La rémunération en actions n'est pas réintégrée (c'est un coût réel). DCF reverse : croissance constante
qui justifie le cours.

**Prédictions** (`pipeline/predictions.py`) - date de publication = premier 8-K 2.02 / 10-Q / 10-K déposé après la fin de
période ; date limite = 00:00 New York ce jour-là (prudent : impossible de compter une prévision faite après les chiffres) ;
versions lues dans l'historique Git (`git log --follow`). Le consensus BPA de Yahoo est généralement non-GAAP : affiché, jamais noté.

**Options** (`pipeline/options.py`) - IV recalculée par Black-Scholes sur le milieu bid/ask ; IV 30/90 j par interpolation de la
variance totale ; choc de résultats implicite = √(T₂ (σ₂² - σ₁²)) entre l'échéance juste avant et juste après la publication.

**Pont VE → fonds propres** - + trésorerie et placements + participations en actions - dette financière
(dette long terme, part courante et emprunts court terme, dettes de location-financement) - intérêts minoritaires.
Les loyers de location simple sont déjà déduits de l'EBIT en normes US : leur dette n'est donc pas ajoutée.

**Modèle naïf** (prédictions) - séquentiel (dernier trimestre × dernière croissance) ou saisonnier (même trimestre
de l'an dernier × croissance sur un an), au choix par valeur dans `predictions.naive` ; Walmart : saisonnier.

**Comparables** - multiples TTM (VE/CA, VE/EBITDA, P/E, Capi/FCF), médiane des pairs, multiples négatifs ou > 500x exclus.
Limite assumée : des multiples passés de pairs moins dynamiques sous-évaluent une entreprise en hypercroissance.

## Développement local

```bash
pip install -r requirements.txt
python -m pytest -q                                   # 151 tests (normalisation, DCF, feed, prédictions, options, ajout de valeur, parité Python/JS, base membres*)

# Aperçu hors-ligne avec des données SYNTHÉTIQUES (jamais publiées)
python tests/fixtures/make_fixtures.py
python -m pipeline.build --fixtures tests/fixtures --out /tmp/site/data
cp -r docs/assets docs/index.html /tmp/site/ && python -m http.server -d /tmp/site 8000

# Données réelles (nécessite un accès réseau à sec.gov)
SEC_USER_AGENT="Nom email@exemple.com" python -m pipeline.build
```

\* Les tests de la base membres demandent un PostgreSQL jetable : `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres`
(sinon ils sont ignorés). En CI, un conteneur Postgres 16 est fourni par le workflow.

Les fixtures reproduisent volontairement les pièges du vrai XBRL (cumuls YTD, T4 absent, exercices de 53 semaines,
retraitement, changement d'étiquette) et les tests vérifient chaque reconstruction contre la vérité connue.

## Limites (honnêtes)

- Cours de **clôture**, pas de temps réel ; sources de cours gratuites non officielles (repli automatique, signalé dans l'interface).
- **Consensus** : seulement le prochain trimestre (CA et BPA moyens, haut, bas) via Yahoo ; l'historique se construit jour après jour.
- **Options** : données Yahoo différées ; la qualité dépend de la liquidité des strikes.
- Couverture **sociétés déposant à la SEC** : américaines, et étrangères en 20-F (IFRS, converties en dollars,
  dernier exercice au lieu du TTM). Les sociétés européennes non cotées aux États-Unis (rapports ESEF) restent à faire.
- Les hypothèses de départ de NVDA sont un **point de départ** posé le 27/10/2026, pas une prévision.

## Pistes pour la suite

Forecasting par segment
(Data Center, Gaming…) à partir des tableaux XBRL dimensionnels · extraction des KPI des communiqués 8-K · ventes
d'Attruby et des concurrents par trimestre dans le modèle biotech · couverture européenne via filings.xbrl.org / ESAP ·
alertes par e-mail.

---
Sources : SEC EDGAR, FRED (Federal Reserve Bank of St. Louis), Yahoo Finance, Stooq. Graphiques :
[TradingView Lightweight Charts™](https://www.tradingview.com/) (Apache 2.0) et Apache ECharts (Apache 2.0).
Outil personnel d'étude - pas un conseil en investissement.
