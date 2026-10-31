/* Home (dashboard), Feed, Méthodologie. */
(function () {
  "use strict";
  const T = window.T, F = T.fmt;

  const ICON = { valuation: "◆", filing: "▤", price: "⚡", cross: "⇅", coverage: "✦", prediction: "◎", results: "★", trial: "⚗", catalyst: "⏱" };
  const TYPE_LABEL = { valuation: "Valorisation", filing: "Publication", price: "Mouvement de cours", cross: "Seuil franchi", coverage: "Couverture", prediction: "Prédiction", results: "Résultats", trial: "Essai clinique", catalyst: "Catalyseur" };

  T.banner = (meta, status) => {
    let s = "";
    if (meta && meta.mode === "fixture") {
      s += `<div class="banner">⚠ <div><b>Données de démonstration synthétiques.</b> Ce site affiche des chiffres inventés pour tester l'interface.
        Ils seront remplacés automatiquement par les vraies données SEC et de marché à la première exécution du pipeline (GitHub Actions).</div></div>`;
    }
    const secBlocked = status && (status.errors || []).some((e) => /403/.test(e) && /sec\.gov/.test(e));
    if (secBlocked) {
      s += `<div class="banner">🔑 <div><b>La SEC refuse l'accès aux données (erreur 403).</b> Elle exige un User-Agent avec un vrai contact.
        Dans le repo GitHub : <b>Settings → Secrets and variables → Actions → New repository secret</b>, nom <code>SEC_USER_AGENT</code>,
        valeur <code>Prénom Nom ton.email@exemple.com</code>, puis <b>Actions → update-data → Run workflow</b>.</div></div>`;
    }
    if (status && status.errors && status.errors.length) {
      s += `<div class="banner">⚠ <div><b>Dernière mise à jour partielle :</b> ${status.errors.map(T.esc).join(" · ")}</div></div>`;
    }
    return s;
  };

  T.renderEvent = (e, opts = {}) => {
    const isNew = (Date.now() - new Date(e.date + "T00:00:00").getTime()) / 864e5 <= 7;
    let bridge = "";
    if (e.bridge && e.bridge.length) {
      const max = Math.max(...e.bridge.map((b) => Math.abs(b.delta)), 1e-9);
      bridge = `<div class="bridge">${e.bridge.map((b) => {
        const w = (Math.abs(b.delta) / max) * 50;
        const left = b.delta >= 0 ? 50 : 50 - w;
        return `<span class="sec">${T.esc(b.label)}</span>
          <span class="bar"><span style="left:${left}%;width:${w}%;background:${b.delta >= 0 ? T.C.up : T.C.down}"></span>
          <span style="left:50%;width:1px;background:#3a4050"></span></span>
          <span class="num ${T.cls(b.delta)}" style="text-align:right">${b.delta >= 0 ? "+" : ""}${F.n(b.delta, 2)} $</span>`;
      }).join("")}</div>`;
    }
    const host = e.url ? (/clinicaltrials\.gov/.test(e.url) ? "ClinicalTrials.gov" : /sec\.gov/.test(e.url) ? "EDGAR" : "la source") : "";
    const link = e.url ? ` <a href="${T.esc(e.url)}" target="_blank" rel="noopener">Ouvrir sur ${host} ↗</a>` : "";
    const tk = opts.hideTicker ? "" : `<a href="#/t/${e.ticker}">${e.ticker}</a> · `;
    return `<div class="ev">
      <div class="ic ${e.type}" title="${TYPE_LABEL[e.type] || e.type}">${ICON[e.type] || "•"}</div>
      <div><div class="t1">${isNew ? '<span class="new">NEW</span>' : ""}${T.esc(e.title)}</div>
        <div class="t2">${tk}${T.esc(e.detail || "")}${link}</div>${bridge}</div>
      <div class="dt">${F.date(e.date)}${e.ts && !/T12:00:00Z$/.test(e.ts) ? `<br><span class="muted">${new Date(e.ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>` : ""}</div></div>`;
  };
  // newest first by timestamp (events without one sit at noon of their day)
  T.sortEvents = (ev) => ev.slice().sort((a, b) => ((b.ts || b.date + "T12:00:00Z") > (a.ts || a.date + "T12:00:00Z") ? 1 : -1));

  // ------------------------------------------------------------------ home
  T.route(/^\/$/, async (view) => {
    const [u, feed, status, bio] = await Promise.all([T.get("universe.json"), T.get("feed.json"), T.get("status.json").catch(() => null),
      T.get("biotech.json").catch(() => null)]);
    const today = new Date().toISOString().slice(0, 10);
    const nextCats = ((bio || {}).calendar || []).filter((c) => c.kind !== "trial" && c.date >= today && !c.outcome).slice(0, 6);
    const rf = u.risk_free;
    const empty = !u.tickers.length ? `<tr><td colspan="9"><div class="empty">Aucune valeur calculée pour l'instant - voir le message ci-dessus.</div></td></tr>` : "";
    const rows = empty + u.tickers.map((t) => `<tr data-href="#/t/${t.ticker}" style="cursor:pointer">
        <td><b>${t.ticker}</b> <span class="muted">${T.esc(t.name)}</span></td>
        <td class="n">${F.px(t.price)}</td>
        <td class="n ${T.cls(t.chg_1d)}">${F.pct(t.chg_1d, 2, true)}</td>
        <td class="n">${F.usd(t.market_cap)}</td>
        <td class="n">${F.px(t.value_base)}${t.method === "rnpv" ? ' <span class="tag" title="Valeur par la rNPV du portefeuille de médicaments">rNPV</span>' : ""}</td>
        <td class="n">${F.px(t.value_weighted)}</td>
        <td class="n ${T.cls(t.upside_weighted)}"><b>${F.pct(t.upside_weighted, 1, true)}</b></td>
        <td style="width:140px">${T.spark(t.spark, 140, 24)}</td>
        <td class="muted">${T.esc(t.latest_period || "")}</td></tr>`).join("");
    const benches = Object.entries(u.benchmarks || {}).map(([k, b]) => `
      <div class="kpi"><div class="l">${T.esc(b.name)}</div>
        <div class="v">${F.n(b.last)} <span class="${T.cls(b.chg_1d)}" style="font-size:12px">${F.pct(b.chg_1d, 2, true)}</span></div>
        <div class="s">YTD <span class="${T.cls(b.r_ytd)}">${F.pct(b.r_ytd, 1, true)}</span> · 1 an <span class="${T.cls(b.r_1y)}">${F.pct(b.r_1y, 1, true)}</span></div></div>`).join("");
    view.innerHTML = `${T.banner(u.meta, status)}
      <div class="thead"><div class="id"><h1>Tableau de bord</h1>
        <div class="sub">Mis à jour ${F.dateTime(u.meta.generated_at)} · ${u.tickers.length} valeur(s) suivie(s)</div></div></div>
      <div class="kpis kpis-flex">${benches}
        <div class="kpi"><div class="l">Taux sans risque 10 ans US</div><div class="v">${F.pct(rf && rf.value, 2)}</div>
          <div class="s">${T.esc(rf ? rf.source : "")}${rf && rf.as_of ? " · " + F.date(rf.as_of) : ""}</div></div></div>
      <div class="grid g-main">
        <div class="stack">
          <div class="panel"><h3>Valeurs suivies <span class="hint">potentiel = valeur pondérée (scénarios DCF, ou rNPV pour les biotechs) vs cours</span></h3>
            <div class="tbl-wrap"><table class="t" id="wlTable"><thead><tr><th>Valeur</th><th class="n">Cours</th><th class="n">1 j</th>
              <th class="n">Capi.</th><th class="n">Valeur base</th><th class="n">Valeur pondérée</th><th class="n">Potentiel</th><th>60 j</th><th>Dernier trim.</th></tr></thead>
              <tbody>${rows}</tbody></table></div></div>
          <div class="panel"><h3>Comment ça marche</h3>
            <div class="grid g3">
              <div><b>1 · Données</b><p class="sec" style="margin:6px 0 0">Chaque jour ouvré, GitHub Actions récupère les états financiers XBRL (SEC) et les cours, puis recalcule tout.</p></div>
              <div><b>2 · Tes hypothèses</b><p class="sec" style="margin:6px 0 0">Le modèle lit <code>config/assumptions/&lt;TICKER&gt;.yaml</code>. Modifie-le sur GitHub : le site se recalcule.</p></div>
              <div><b>3 · Le feed</b><p class="sec" style="margin:6px 0 0">Nouvelle publication ou valeur qui bouge → un événement, avec la décomposition données / hypothèses / marché.</p></div>
            </div></div>
        </div>
        <div class="stack">
        ${nextCats.length ? `<div class="panel"><h3>Prochains catalyseurs <a class="hint" href="#/biotech">calendrier →</a></h3>
          ${nextCats.map((c) => { const d = Math.round((new Date(c.date) - new Date(today)) / 864e5);
            return `<a class="order-row" href="#/t/${c.ticker}/biotech" style="color:inherit"><span class="num">${d === 0 ? "auj." : "J-" + d}</span> <b>${c.ticker}</b> <span>${T.esc(c.kind_label)}</span> <span class="muted">${T.esc(c.asset || "")}${T.isNum(c.p_base) ? ` · base ${F.pct(c.p_base, 0)}` : ""}${c.options && T.isNum(c.options.event_move) ? ` · options ±${F.pct(c.options.event_move, 1)}` : ""}</span></a>`; }).join("")}</div>` : ""}
        <div class="panel"><h3>Feed <a class="hint" href="#/feed">tout voir →</a></h3>
          <div class="feed">${T.sortEvents(feed.events || []).slice(0, 12).map((e) => T.renderEvent(e)).join("") || '<div class="empty">Aucun événement pour l’instant.</div>'}</div></div></div>
      </div>`;
    T.$$("#wlTable tbody tr").forEach((tr) => tr.addEventListener("click", () => T.go(tr.dataset.href)));
  });

  // ------------------------------------------------------------------ feed
  T.route(/^\/feed$/, async (view) => {
    const feed = await T.get("feed.json");
    const ev = T.sortEvents(feed.events || []);
    const types = [...new Set(ev.map((e) => e.type))];
    const tks = [...new Set(ev.map((e) => e.ticker))];
    const st = { type: null, tk: null };
    view.innerHTML = `<div class="thead"><div class="id"><h1>Feed</h1><div class="sub">${ev.length} événement(s) · publications, réévaluations, mouvements</div></div></div>
      <div class="panel"><div class="row" id="filters" style="margin-bottom:8px">
        ${types.map((t) => `<button class="chip" data-type="${t}">${ICON[t] || ""} ${TYPE_LABEL[t] || t}</button>`).join("")}
        <span class="spacer"></span>${tks.map((t) => `<button class="chip" data-tk="${t}">${t}</button>`).join("")}</div>
        <div class="feed" id="feedList"></div></div>`;
    const draw = () => {
      const list = ev.filter((e) => (!st.type || e.type === st.type) && (!st.tk || e.ticker === st.tk));
      T.$("#feedList").innerHTML = list.map((e) => T.renderEvent(e)).join("") || '<div class="empty">Rien avec ces filtres.</div>';
      T.$$("#filters .chip").forEach((c) => c.classList.toggle("on", c.dataset.type === st.type || c.dataset.tk === st.tk));
    };
    T.$("#filters").addEventListener("click", (e) => {
      const c = e.target.closest(".chip"); if (!c) return;
      if (c.dataset.type) st.type = st.type === c.dataset.type ? null : c.dataset.type;
      if (c.dataset.tk) st.tk = st.tk === c.dataset.tk ? null : c.dataset.tk;
      draw();
    });
    draw();
  });

  // ------------------------------------------------------------------ methodology
  T.route(/^\/methodo$/, async (view) => {
    const status = await T.get("status.json").catch(() => null);
    const cov = status && status.coverage ? Object.entries(status.coverage) : [];
    view.innerHTML = `<div class="thead"><div class="id"><h1>Méthodologie & sources</h1><div class="sub">Ce que fait le terminal, et ce qu'il ne fait pas</div></div></div>
    <div class="grid g2">
      <div class="panel"><h3>Sources de données</h3>
        <div class="kv">
          <div>États financiers (US)</div><div>SEC EDGAR - API XBRL companyfacts</div>
          <div>Liste des publications</div><div>SEC EDGAR - submissions</div>
          <div>Cours journaliers</div><div>Yahoo Finance (non officiel) → Stooq → cache</div>
          <div>Taux sans risque</div><div>FRED DGS10 (Trésor US 10 ans)</div>
          <div>Fréquence</div><div>2 fois par jour ouvré (GitHub Actions)</div>
        </div>
        <p class="note">Les cours sont des <b>clôtures de fin de journée</b>, pas du temps réel. Les sources de cours gratuites ne sont pas officielles : en cas de panne, le terminal garde les derniers cours connus et l'indique.</p></div>
      <div class="panel"><h3>Reconstruction des états financiers</h3>
        <p class="sec" style="margin-top:0">Le XBRL de la SEC n'est pas directement exploitable trimestre par trimestre :</p>
        <ul class="sec" style="padding-left:18px;margin:0">
          <li>les flux de trésorerie des 10-Q sont publiés <b>en cumul depuis le début d'exercice</b> (3, 6, 9 mois) → trimestres reconstruits par différence ;</li>
          <li>le T4 n'est jamais publié seul → <b>T4 = exercice - 9 mois</b> ;</li>
          <li>une même période apparaît dans plusieurs dépôts → on garde la valeur <b>la plus récemment déposée</b> (retraitements) ;</li>
          <li>les entreprises changent d'étiquette XBRL au fil du temps → chaque ligne a une liste ordonnée d'étiquettes candidates.</li>
        </ul></div>
      <div class="panel"><h3>DCF (FCFF, deux phases)</h3>
        <div class="kv">
          <div>Flux disponible</div><div>EBIT × (1 - t) + D&A - capex - ΔBFR</div>
          <div>Croissance</div><div>années explicites puis fondu linéaire vers g</div>
          <div>Marge</div><div>convergence linéaire vers la marge cible</div>
          <div>Valeur terminale</div><div>Gordon : FCFF(N+1) / (WACC - g)</div>
          <div>Actualisation</div><div>convention mi-année (option)</div>
          <div>WACC</div><div>CAPM : rf + β × prime de risque</div>
          <div>Bêta</div><div>2 ans hebdo vs SPY, ajusté Blume</div>
          <div>Valeur des fonds propres</div><div>VE + trésorerie & placements + participations - dette (y c. location-financement) - intérêts minoritaires</div>
        </div>
        <p class="note">La rémunération en actions n'est <b>pas</b> réintégrée : c'est un vrai coût pour l'actionnaire (dilution). Le DCF reverse cherche la croissance constante qui justifie le cours, toutes autres hypothèses égales.</p></div>
      <div class="panel"><h3>Comparables & limites</h3>
        <p class="sec" style="margin-top:0">Multiples TTM (VE/CA, VE/EBITDA, P/E, Capi/FCF) des pairs, médiane appliquée aux agrégats de la valeur suivie. Les multiples négatifs ou absurdes (&gt; 500x) sont exclus.</p>
        <p class="sec"><b>Limite majeure :</b> des multiples <i>passés</i> appliqués à une entreprise en très forte croissance sous-estiment sa valeur. Les comparables bruts ne sont pas ajustés de la croissance : c'est un point de repère, pas un objectif de cours.</p>
        <p class="sec"><b>Émetteurs étrangers (formulaire 20-F)</b> : AstraZeneca, Unilever, Novartis... publient en IFRS (taxonomie <code>ifrs-full</code>), parfois dans une autre devise. Les montants sont convertis en dollars au cours de change du jour (croissances et marges inchangées) et, faute de trimestres complets (comptes semestriels), le dernier exercice remplace le TTM. Les locations IFRS 16 comptent comme dette. La capitalisation vient de la ligne cotée à New York (ADR).</p>
        <p class="sec"><b>Ce qui manque encore :</b> consensus des analystes (payant), multiples forward, sociétés européennes non cotées aux États-Unis (rapports ESEF), registre de prévisions pré-enregistrées.</p></div>
      <div class="panel"><h3>Biotech : rNPV et catalyseurs</h3>
        <p class="sec" style="margin-top:0">Une biotech ne se valorise pas avec un DCF classique (marges négatives, revenus futurs binaires). La <b>rNPV</b> additionne les programmes : pour chacun, ventes (montée jusqu'au pic, plateau, chute à la perte d'exclusivité), marge, impôt, coûts de développement restants, le tout <b>multiplié par la probabilité d'arriver sur le marché</b> et actualisé (10 % par défaut : le risque d'échec est dans la probabilité, pas dans le taux). Puis : + trésorerie nette - frais centraux.</p>
        <p class="sec"><b>Probabilités</b> : taux historiques de passage de phase (BIO, Informa, QLS, 2011-2020), par aire thérapeutique. Exemple : phase 3 → dépôt 57,8 %, dépôt → approbation 90,6 % ; maladies rares 60,4 % et 93,6 %.</p>
        <p class="sec"><b>Catalyseurs</b> : pour chaque événement (décision FDA, résultats d'essai), le saut du cours en cas de succès ou d'échec, la probabilité que le cours implique (en gardant toutes tes autres hypothèses), et le mouvement anticipé par les options, avec la volatilité ordinaire retirée grâce à l'échéance précédente. Les essais viennent de ClinicalTrials.gov (statut, date de fin principale, retards, arrêts).</p>
        <p class="sec"><b>Prédictions</b> : les membres donnent leur probabilité avant l'événement (cachée aux autres jusqu'à ce qu'ils donnent la leur), notée au score de Brier contre le taux historique.</p></div>
      <div class="panel"><h3>Prédictions</h3>
        <div class="kv">
          <div>Enregistrement</div><div>un fichier YAML par prédiction, commité sur GitHub</div>
          <div>Preuve de date</div><div>heure du commit Git</div>
          <div>Date limite</div><div>00:00 heure de New York, jour de publication</div>
          <div>Publication</div><div>premier 8-K 2.02 / 10-Q / 10-K après la fin de période</div>
          <div>Réel</div><div>chiffres XBRL de la SEC (GAAP)</div>
          <div>Modèle naïf</div><div>séquentiel (dernier trimestre × dernière croissance) ou saisonnier (même trimestre de l'an dernier × croissance sur un an), au choix par valeur</div>
          <div>Consensus</div><div>Yahoo, relevé chaque jour, figé la veille</div>
        </div>
        <p class="note">Seule la dernière version commitée <b>avant</b> la date limite compte. Les modifications ultérieures restent visibles mais ne sont jamais notées.
          Le consensus BPA de Yahoo est généralement non-GAAP : il est affiché mais jamais comparé au BPA GAAP. Intervalles : vise 80 % de réussite ; au-dessus tu es trop prudent, en dessous trop sûr de toi.
          Questions oui / non : score de Brier, 0 = parfait, 0,25 = répondre 50 % à tout.</p></div>
      <div class="panel"><h3>Options</h3>
        <div class="kv">
          <div>Source</div><div>chaînes Yahoo Finance (différées)</div>
          <div>Volatilité implicite</div><div>Black-Scholes sur le milieu bid / ask</div>
          <div>IV 30 / 90 jours</div><div>interpolation de la variance totale</div>
          <div>Straddle</div><div>(call + put ATM) / cours</div>
          <div>Choc implicite</div><div>√(T₂ × (σ₂² - σ₁²)) × √(2/π)</div>
          <div>Réaction passée</div><div>clôture veille → lendemain du 8-K 2.02</div>
        </div>
        <p class="note">Le choc implicite isole ce que le marché paie pour l'annonce elle-même : variance de l'échéance juste après la publication moins la variance « normale » de l'échéance juste avant.
          Sans dividende ni exercice anticipé : approximation standard pour des options liquides.</p></div>
      <div class="panel span2"><h3>Espace membres (bêta fermée)</h3>
        <div class="kv">
          <div>Accès</div><div>sur invitation (code créé par un administrateur), comptes e-mail + mot de passe</div>
          <div>Prédictions</div><div>modifiables jusqu'à 00:00 New York le jour de la publication ; chaque version est archivée, la dernière avant la limite est notée</div>
          <div>Visibilité</div><div>les prévisions des autres membres restent cachées jusqu'à la date limite (seul leur nombre est affiché)</div>
          <div>Communauté</div><div>médiane des membres, calculée sans ta propre prévision quand on te compare au groupe</div>
          <div>Questions oui / non</div><div>résolues automatiquement (guidance, analystes, communauté, réaction du cours veille → lendemain)</div>
          <div>Portefeuilles</div><div>fictifs, 100 000 $ chacun, ordres exécutés à la clôture de la séance suivante, pas de vente à découvert</div>
          <div>Badges</div><div>statuts Supporter, Members, Founders, VIP (le nombre de barres donne le rang) et 44 succès en 4 niveaux (dont secteurs, ancienneté et ratio de Sharpe) (bronze, argent, or, platine) ; les plus durs exigent précision, calibration et un minimum de résultats ; attribués uniquement par la base</div>
          <div>Options (paper trading)</div><div>positions acheteuses uniquement ; ordres exécutés à la clôture suivante, achat au prix demandé (ask) et vente au prix offert (bid) ; dénouement à l'échéance à la valeur intrinsèque ; valorisation quotidienne au milieu bid / ask</div>
          <div>Messagerie</div><div>privée entre deux membres, illisible par les administrateurs ; blocage et signalement (seul le message signalé est transmis) ; non chiffrée de bout en bout</div>
        </div>
        <p class="note">Toutes ces règles sont appliquées par la base de données elle-même (sécurité au niveau des lignes), pas seulement par l'interface.
          Limites connues : les divisions d'actions ne sont pas encore répercutées sur les portefeuilles fictifs ; les cours viennent de sources gratuites
          (Yahoo Finance) dont les conditions interdisent un usage commercial : l'espace membres reste une bêta privée et non commerciale.
          Rien ici n'est un conseil en investissement.</p></div>
      <div class="panel span2"><h3>Couverture XBRL (diagnostic du dernier run)</h3>
        ${cov.length ? cov.map(([tk, c]) => `<div class="group-title">${tk}</div><div class="tbl-wrap"><table class="t"><thead><tr><th>Ligne</th><th>Étiquettes XBRL utilisées</th><th class="n">Exercices</th><th class="n">Trimestres</th></tr></thead><tbody>
          ${Object.entries(c).map(([k, x]) => `<tr><td>${k}</td><td class="muted">${T.esc((x.tags || []).join(", ") || "-")}</td><td class="n ${x.annual ? "" : "warn"}">${x.annual}</td><td class="n ${x.quarterly ? "" : "warn"}">${x.quarterly}</td></tr>`).join("")}
          </tbody></table></div>`).join("") : '<div class="empty">Pas encore de diagnostic.</div>'}</div>
    </div>`;
  });
})();
