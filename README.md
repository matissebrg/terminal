# Mangrove

Ma bibliothèque de recherche pharma, racontée comme un palétuvier : on descend de la canopée jusqu'aux racines.

**Site :** `https://matissebrg.github.io/terminal/`

| Section | Ce qu'on y trouve | D'où ça vient |
|---|---|---|
| Canopée | Le fil : mes notes, les dépôts SEC, les mouvements de cours, les couvertures | `library/library.js` + pipeline (`data/feed.json`) |
| Ligne d'eau | Le calendrier des six prochains mois : résultats, catalyseurs, échéances de mes objectifs de cours | pipeline (dates de résultats) + `library/catalysts.js` |
| Marée | Mes prédictions, le tableau de calibration, et le formulaire pour en écrire une | `config/predictions/` notées par `pipeline/predictions.py` |
| Racines | Les principes auxquels chaque note est tenue | `library/values.js` |
| Bibliothèque | Les valeurs par racine, mes documents et les dépôts SEC ; un dossier par valeur | `library/coverage.js` + pipeline |

Couverture : **Sanofi (SNY), Eli Lilly (LLY), Novo Nordisk (NVO), AstraZeneca (AZN), Merck & Co. (MRK), Veeva (VEEV)**, et
l'ETF santé **XLV** comme référence.

## À faire une fois, après la fusion de la branche

Le pipeline ne connaît encore que VEEV : les comptes de LLY et MRK se construisent depuis la SEC, ce que seul GitHub Actions
peut faire (avec ton identité SEC, secret `SEC_USER_AGENT`).

1. Onglet **Actions** → **Ajouter une valeur** → *Run workflow*.
2. Ticker : `LLY,MRK` ; pairs : `LLY,MRK,SNY,NVO,AZN` ; ETF : `XLV` ; nom de l'ETF : `Santé (ETF XLV)`.
3. Environ 5 minutes plus tard, le site affiche LLY et MRK en suivi complet, et SNY, NVO, AZN comme comparables (cours,
   comptes annuels convertis en dollars).

## Suivi complet ou comparable

Sanofi, Novo Nordisk et AstraZeneca déposent un rapport annuel **20-F** à la SEC, sans comptes trimestriels XBRL exploitables.
Le pipeline les lit donc comme **comparables** : cours, dernier exercice publié, multiples. Pour elles, la marée note les
**objectifs de cours** et les **questions oui / non**, pas les chiffres trimestriels. Les valeurs déclarées dans
`config/universe.yaml` (VEEV, puis LLY et MRK) sont en **suivi complet** : trimestres reconstruits, consensus, date de
résultats, et prévisions de résultats notées automatiquement.

## La bibliothèque : ce que tu modifies

Tout est dans `docs/library/`, en JavaScript simple (pour que la copie privée marche hors ligne). Modifie sur GitHub (crayon →
*Commit changes*) : le site se republie tout seul.

- `library.js` : tes documents. Une entrée par note, modèle ou thèse : date, ticker, type, titre, résumé, fichier.
  Les fichiers vont dans `library/documents/`.
- `catalysts.js` : les dates que le pipeline ne voit pas (décision FDA, lecture d'essai, congrès, résultats des émetteurs
  étrangers), avec un lien vers l'annonce.
- `values.js` : tes principes. Les formulations actuelles sont un premier jet, à réécrire avec tes mots.
- `coverage.js` : les tuiles de la bibliothèque (nom, racine, une ligne de métier). Ajouter une valeur au suivi complet,
  c'est le workflow *Ajouter une valeur* ; l'ajouter ici la fait apparaître dans la bibliothèque.
- La **thèse** d'une valeur suivie s'écrit dans `config/assumptions/<TICKER>.yaml`, champ `thesis` ; elle apparaît dans
  son dossier.

**Règle :** le repo est public. N'y mets que ce que tu publierais sous ton nom. Ce qui vient de ton travail en entreprise
reste dans la copie privée.

## La marée : prédire, puis être noté

1. Dans la marée (ou depuis un dossier, « Écrire une prédiction »), choisis la valeur. Pour une valeur en suivi complet, la
   période publiée est préremplie, avec en regard le dernier chiffre publié, le modèle naïf et le consensus.
2. Trois types de prévisions, combinables dans un même fichier :
   - **résultats** (CA, marges, résultat, BPA, FCF) avec un **intervalle à 80 %** ;
   - **questions oui / non** avec une probabilité, notées par le **score de Brier** ; tu tranches l'issue toi-même dans le
     fichier une fois connue (`outcome: null` → `true` ou `false`) ;
   - **objectifs de cours** à une date, vérifiés sur la clôture de ce jour-là (XLV compris).
3. **Enregistrer sur GitHub** ouvre `config/predictions/<TICKER>/<date>-<période>.yaml` déjà rempli : clique *Commit changes*.
   Le brouillon reste dans ton navigateur tant que tu ne l'as pas enregistré.
4. **L'heure du commit fait foi.** Pour des résultats, seule la dernière version commitée avant 0 h (heure de New York) le
   jour de la publication est notée ; une version plus tardive est marquée « enregistrée trop tard ».
5. Le tableau de la marée cumule : chiffres tombés dans l'intervalle (bien calibré, c'est environ 80 %), écart moyen, biais
   (trop optimiste ou trop prudent), victoires contre le consensus, score de Brier, écart des objectifs de cours.

Écriture à la main possible : `config/predictions/_modele.yaml`.

## La copie privée (hors GitHub)

`mangrove-prive.zip` contient le même site, à ouvrir depuis ton disque (double-clic sur `index.html`, Chrome ou Edge).

- Tes documents d'entreprise vont dans `library/` **de cette copie seulement** ; ce dossier n'est jamais commité.
- Ouverte depuis le disque, la page ne peut pas lire de fichiers JSON locaux : elle lit les **données de marché publiques**
  sur le site en ligne (`publicSite` dans `assets/config.js`). Ce sont uniquement des lectures ; rien de la copie n'est envoyé.
  Sans connexion (ou si le réseau de l'entreprise bloque github.io), la bibliothèque, tes documents, le calendrier manuel et
  les principes restent disponibles ; un message l'indique en bas de page.
- Pour mettre à jour le site de la copie sans toucher à tes documents : remplace `index.html` et `assets/` par ceux du repo,
  garde `library/`.
- Avant d'y mettre quoi que ce soit, vérifie que la politique de ton employeur autorise ce stockage.

## Comment ça marche

```
GitHub Actions (2×/jour ouvré, à chaque modification de config/, pipeline/ ou du site)
   │
   ├─ SEC EDGAR (XBRL companyfacts + submissions)      ── états financiers, dépôts
   ├─ Yahoo Finance (yfinance) → Stooq → cache          ── cours, divisions, options, consensus, date de résultats
   └─ FRED DGS10 → Trésor US                            ── taux sans risque
   │
   ▼
pipeline/  normalize → ratios → feed → predictions  ──►  docs/data/*.json  ──►  GitHub Pages (docs/)
```

Le site (`docs/index.html`, `docs/assets/`, `docs/library/`) n'a ni dépendance ni étape de build : HTML, CSS et JavaScript
simples, une scène WebGL dessinée à la main (`assets/js/scene.js`), des graphiques en SVG.

L'ancien espace membres (Supabase) n'a plus d'interface sur le site. Sa base et ses migrations restent dans le repo et le
workflow continue de les maintenir ; rien n'est supprimé côté données.

## Méthode

**Reconstruction des états financiers** (`pipeline/normalize.py`) : flux de trésorerie des 10-Q publiés en cumul → trimestres
reconstruits par différence ; T4 = exercice − 9 mois ; retraitements → valeur la plus récemment déposée ; changements
d'étiquettes XBRL → liste ordonnée d'étiquettes par ligne ; exercices de 52/53 semaines → tolérance sur les dates. Émetteurs
20-F (IFRS) : comptes convertis en dollars, dernier exercice au lieu des douze derniers mois.

**Prédictions** (`pipeline/predictions.py`) : date de publication = premier 8-K 2.02 / 10-Q / 10-K déposé après la fin de
période ; échéance = 0 h New York ce jour-là ; versions lues dans l'historique Git. Le consensus BPA de Yahoo est généralement
non-GAAP : affiché, jamais noté.

**Modèle naïf** : séquentiel (dernier trimestre × dernière croissance) ou saisonnier (même trimestre de l'an dernier ×
croissance sur un an), au choix par valeur dans `config/assumptions/<TICKER>.yaml` (`predictions.naive`).

**Comparables** : multiples sur douze mois (VE/CA, VE/EBITDA, P/E, Capi/FCF) ; multiples négatifs ou > 500x exclus.

## Développement local

```bash
pip install -r requirements.txt
python -m pytest -q        # 184 tests ; ceux de la base demandent TEST_DATABASE_URL (PostgreSQL jetable), sinon ignorés
python -m http.server -d docs 8000      # le site avec les données publiées dans docs/data
```

Les tests du formulaire de prédiction tournent sous node (`tests/js/`, et `tests/test_site_predictions.py` qui fait noter
par le pipeline un fichier écrit par le code du site). En CI, node 22 et un PostgreSQL 16 sont fournis par le workflow.

## Limites

- Cours de **clôture**, pas de temps réel ; sources de cours gratuites non officielles (repli automatique).
- **Consensus** : seulement le prochain trimestre, via Yahoo.
- Émetteurs **20-F** (Sanofi, Novo Nordisk, AstraZeneca) : pas de trimestres, donc pas de prévisions de résultats notées.
- Les dates de résultats « estimées » viennent de Yahoo ou d'une médiane historique : à confirmer avec la société.

---
Sources : SEC EDGAR, FRED (Federal Reserve Bank of St. Louis), Yahoo Finance, Stooq.
Outil personnel d'étude, pas un conseil en investissement.
