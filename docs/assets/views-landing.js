/* Public front door (#/bienvenue), in French and English. Everything shown is live data from the same JSON files
   as the terminal: the scope cycles through covered stocks, the three specimens are built on real data. The site publishes no
   DCF value of its own: the first specimen is a one-slider version of the visitor's own calculator.
   A first-time visitor without an account who opens the site root lands here once; after that the root is the dashboard. */
(function () {
  "use strict";
  const T = window.T, F = T.fmt;
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } } };
  const calm = () => !window.FX || !window.FX.on();
  let scene = null;   // the 3D mangrove behind the front door (mangrove-scene.js)
  const GLYPH = {"canopy": "<path d=\"M9.5 25.5c0-5 3.6-8.4 8.6-8.1 1.6-4.8 6-7.9 11.2-7.4 2.6-2.4 7.6-2.4 10.6.4 4.4-.6 8.4 2.4 9.2 6.8 3.9.8 6.4 4 5.4 8.3Z\"/>", "water": "<path d=\"M6 26c4.5-4 8.5-4 13 0s8.5 4 13 0 8.5-4 13 0 8.5 4 13 0\"/><path d=\"M6 38c4.5-4 8.5-4 13 0s8.5 4 13 0 8.5-4 13 0 8.5 4 13 0\" opacity=\".55\"/>", "roots": "<path d=\"M32 8v16M32 24c-8.5.6-16 7-19 26M32 24c8.5.6 16 7 19 26M32 25c-4 3.4-7 12-7.6 25M32 25c4 3.4 7 12 7.6 25\"/>"};

  const TXT = {
    fr: {
      h1: ["Valorise.", "Prévois.", "Sois noté."],
      lede: "Mangrove est un terminal de recherche dédié à la santé : pharma et biotech. Les comptes viennent des dépôts à la SEC, les décisions de la FDA et les résultats d'essais arrivent avec leurs probabilités, et chaque prévision est horodatée avant l'événement puis notée contre le réel.",
      chap: { canopy: ["La canopée", "Ce qui remonte en premier : les valeurs suivies et chaque événement daté."],
        water: ["La ligne d'eau", "Là où une thèse rencontre le marché : catalyseurs et publications, avec ta prévision verrouillée avant."],
        roots: ["Les racines", "Ce sur quoi tout repose : des comptes tirés des dépôts à la SEC, et ton propre modèle."] },
      feedH: "Derniers événements", feedMore: "Tout le feed", scroll: "Descends dans l'arbre",
      enter: "Explorer le terminal", ask: "Demander une invitation", free: "Lecture libre, sans compte.",
      price: "Cours", d1: "Séance", d60: "60 jours", open: "Ouvrir la fiche", prev: "Valeur précédente", next: "Valeur suivante",
      asof: (d) => `Données du ${d}`, scope: "Valeurs suivies, une par une",
      a: ["Ton modèle, pas le nôtre", "Mangrove ne publie aucun objectif de cours. Le calculateur part de ce que le cours actuel suppose, sur des comptes tirés des dépôts à la SEC. À toi de dire si c'est trop ou pas assez, hypothèse par hypothèse.", (tk) => `Ouvrir le calculateur sur ${tk}`],
      aCap: (tk, g, n) => `${tk} : le cours suppose ${g} de croissance du chiffre d'affaires par an pendant ${n} ans. Et toi ?`,
      aSlide: (n) => `Croissance du chiffre d'affaires, par an, pendant ${n} ans`, aVal: "Ta valeur par action", aGap: "Écart avec le cours", aNote: "Les autres hypothèses restent celles des comptes. Toutes se règlent dans le calculateur.",
      b: ["Les catalyseurs avant qu'ils n'arrivent", "Décisions de la FDA et résultats d'essais à venir, avec le taux de succès historique, la probabilité retenue par le modèle et le mouvement de cours que les options anticipent.", "Ouvrir le calendrier"],
      bHist: "historique", today: "auj.", dminus: (d) => `J-${d}`,
      kinds: {},
      c: ["Un registre qui ne se réécrit pas", "Tu enregistres ta prévision avant la publication des résultats. Elle est verrouillée à la date limite, puis notée contre le chiffre réel, le consensus des analystes et les autres membres.", "Voir les prochaines publications"],
      cLock: "verrouillage", est: "date estimée",
      also: "Aussi dans le terminal",
      alsoList: [["Portefeuille fictif", "100 000 $ fictifs. Les ordres paient l'écart acheteur-vendeur et l'impact de marché, comme en vrai."], ["Options", "Volatilité implicite, grecques, constructeur de stratégies."], ["Feed", "Chaque publication, chaque séance à plus de 5 %, chaque catalyseur, à sa date."], ["États financiers", "Dix ans de comptes tirés des dépôts à la SEC, trimestre par trimestre."], ["Bientôt", "Sanofi, Regeneron et des comparables pensés pour la santé."]],
      notH: "Ce que ce n'est pas",
      not: (n) => ["Pas un conseil en investissement : un outil d'analyse et d'entraînement.", "Pas de temps réel : cours de clôture, mis à jour deux fois par jour ouvré.", `Pas tout le marché : ${n} valeurs de santé suivies pour l'instant, surtout américaines.`, "Pas une vérité : un calcul vaut ce que valent ses hypothèses, et ici ce sont les tiennes.", "Pas d'argent réel : les portefeuilles sont fictifs."],
      betaH: "Bêta fermée", beta: "La lecture est libre. Prédire, tenir un portefeuille fictif et apparaître au classement demandent un compte, ouvert sur invitation.",
      email: "Ton e-mail", note: "Ce que tu suis en bourse (facultatif)", send: "Demander une invitation", have: "J'ai déjà un code",
      privacy: "Ton adresse sert uniquement à t'envoyer une invitation. Seul l'administrateur la voit, et elle est supprimée sur simple demande.",
      sent: "Demande enregistrée. Tu recevras un code par e-mail si elle est acceptée.", off: "Les demandes d'invitation ne sont pas ouvertes sur ce site.",
      src: "Sources : dépôts SEC EDGAR, ClinicalTrials.gov, cours de clôture. Graphiques : TradingView Lightweight Charts, Apache ECharts.",
    },
    en: {
      h1: ["Value it.", "Call it.", "Get scored."],
      lede: "Mangrove is a research terminal for healthcare: pharma and biotech. Accounts come from SEC filings, FDA decisions and trial readouts come with their probabilities, and every forecast is time-stamped before the event, then scored against what happened.",
      chap: { canopy: ["The canopy", "What surfaces first: the stocks covered and every dated event."],
        water: ["The waterline", "Where a thesis meets the market: catalysts and earnings, with your forecast locked in before."],
        roots: ["The roots", "What everything stands on: accounts from SEC filings, and your own model."] },
      feedH: "Latest events", feedMore: "The whole feed", scroll: "Scroll down the tree",
      enter: "Explore the terminal", ask: "Request an invite", free: "Free to read, no account needed. The terminal itself is in French for now.",
      price: "Price", d1: "Last session", d60: "60 days", open: "Open", prev: "Previous stock", next: "Next stock",
      asof: (d) => `Data as of ${d}`, scope: "Covered stocks, one at a time",
      a: ["Your model, not ours", "Mangrove publishes no price targets. The calculator starts from what today's price assumes, on accounts taken from SEC filings. You decide whether that is too much or too little, one assumption at a time.", (tk) => `Open the calculator on ${tk}`],
      aCap: (tk, g, n) => `${tk}: the price assumes revenue growing ${g} a year for ${n} years. What do you think?`,
      aSlide: (n) => `Revenue growth, per year, for ${n} years`, aVal: "Your value per share", aGap: "Gap to the price", aNote: "Every other assumption stays as the accounts give it. All of them can be changed in the calculator.",
      b: ["Catalysts before they hit", "Upcoming FDA decisions and trial readouts, with the historical success rate, the probability the model uses, and the price move that options are pricing in.", "Open the calendar"],
      bHist: "historical", today: "today", dminus: (d) => `D-${d}`,
      kinds: { pdufa: "FDA decision (PDUFA)", readout: "Trial readout", adcom: "Advisory committee", data: "Trial readout" },
      c: ["A record that can't be rewritten", "You log your forecast before earnings come out. It locks at the deadline, then gets scored against the actual number, the analyst consensus and the other members.", "See upcoming earnings"],
      cLock: "locks", est: "estimated date",
      also: "Also in the terminal",
      alsoList: [["Paper trading", "$100,000 of play money. Orders pay the bid-ask spread and market impact, as they would for real."], ["Options", "Implied volatility, greeks, a strategy builder."], ["Feed", "Every filing, every session that moves more than 5%, every catalyst, on its date."], ["Financial statements", "Ten years of accounts from SEC filings, quarter by quarter."], ["Coming soon", "Sanofi, Regeneron, and comparables built for healthcare."]],
      notH: "What it is not",
      not: (n) => ["Not investment advice: a tool for analysis and practice.", "Not real time: closing prices, updated twice every trading day.", `Not the whole market: ${n} healthcare stocks covered so far, mostly US.`, "Not the truth: a calculation is worth what its assumptions are worth, and here they are yours.", "Not real money: portfolios are paper only."],
      betaH: "Closed beta", beta: "Reading is free. Forecasting, running a paper portfolio and appearing on the leaderboard need an account, opened by invitation.",
      email: "Your e-mail", note: "What you follow in the markets (optional)", send: "Request an invite", have: "I already have a code",
      privacy: "Your address is only used to send you an invitation. Only the administrator sees it, and it is deleted on request.",
      sent: "Request saved. You will get a code by e-mail if it is accepted.", off: "Invitation requests are not open on this site.",
      src: "Sources: SEC EDGAR filings, ClinicalTrials.gov, closing prices. Charts: TradingView Lightweight Charts, Apache ECharts.",
    },
  };
  const getLang = () => { const s = store.get("mangrove-lang"); return s === "fr" || s === "en" ? s : /^fr/i.test(navigator.language || "fr") ? "fr" : "en"; };
  const nf = (lang) => (v, d = 2) => (T.isNum(v) ? new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v) : "-");
  const money = (lang) => { const n = nf(lang); return (v, d = 2) => (T.isNum(v) ? (lang === "fr" ? n(v, d) + " $" : "$" + n(v, d)) : "-"); };
  const pct = (lang) => { const n = nf(lang); return (v, d = 0) => (T.isNum(v) ? (v > 0 ? "+" : "") + n(v * 100, d) + (lang === "fr" ? " %" : "%") : "-"); };
  const day = (lang, s) => new Date(s.length === 10 ? s + "T00:00:00" : s).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short" });

  // ------------------------------------------------------------------ the scope: one covered stock at a time
  let timer = 0;
  function scope(root, tickers, L, lang) {
    const M = money(lang), P = pct(lang);
    const list = tickers.filter((t) => T.isNum(t.price));
    if (!list.length) { root.remove(); return; }
    root.innerHTML = `<div class="sc-stage" role="group" aria-roledescription="carousel" aria-label="${T.esc(L.scope)}">
      <svg class="sc-svg" viewBox="0 0 400 400" aria-hidden="true">
        <circle class="sc-ticks" cx="200" cy="200" r="192"/><circle class="sc-dash" cx="200" cy="200" r="176"/>
        <circle class="sc-track" cx="200" cy="200" r="160"/><circle class="sc-arc" cx="200" cy="200" r="160" pathLength="100"/>
        <path class="sc-cross" d="M200 4v26M200 370v26M4 200h26M370 200h26"/>
        <polyline class="sc-spark" points="" pathLength="100"/>
      </svg>
      <div class="sc-read" aria-live="off">
        <div class="sc-tk"></div><div class="sc-nm"></div>
        <div class="sc-px num"></div>
        <div class="sc-row"><span>${L.d1}</span><b class="num sc-val"></b></div>
        <div class="sc-row"><span>${L.d60}</span><b class="num sc-gap"></b></div>
        <a class="sc-open"></a>
      </div></div>
      <div class="sc-nav"><button type="button" class="icon-btn sc-prev" aria-label="${L.prev}">‹</button>
        <div class="sc-dots">${list.map((t, i) => `<button type="button" data-i="${i}" aria-label="${t.ticker}"></button>`).join("")}</div>
        <button type="button" class="icon-btn sc-next" aria-label="${L.next}">›</button></div>`;
    const $ = (s) => root.querySelector(s);
    let i = 0, hold = false;
    const scramble = (el, final) => {
      if (calm()) { el.textContent = final; return; }
      const idx = []; for (let k = 0; k < final.length; k++) if (/\d/.test(final[k])) idx.push(k);
      const t0 = performance.now(), ms = 520;
      const step = (now) => { const p = Math.min(1, (now - t0) / ms); if (p >= 1 || !el.isConnected) { el.textContent = final; return; }
        const a = final.split(""), locked = Math.floor(p * idx.length); for (let j = locked; j < idx.length; j++) a[idx[j]] = String((Math.random() * 10) | 0);
        el.textContent = a.join(""); requestAnimationFrame(step); };
      requestAnimationFrame(step);
    };
    const show = (n) => {
      i = (n + list.length) % list.length; const t = list[i];
      const sp = (t.spark || []).filter(T.isNum), gap = sp.length > 1 && sp[0] > 0 ? sp[sp.length - 1] / sp[0] - 1 : null;   // 60-session move
      $(".sc-tk").textContent = t.ticker; $(".sc-nm").textContent = t.name;
      scramble($(".sc-px"), M(t.price));
      const d1 = $(".sc-val"); d1.textContent = P(t.chg_1d, 2); d1.className = "num sc-val " + T.cls(t.chg_1d);
      const g = $(".sc-gap"); g.textContent = P(gap, 1); g.className = "num sc-gap " + T.cls(gap);
      const o = $(".sc-open"); o.href = `#/t/${t.ticker}`; o.textContent = `${L.open} ${t.ticker} ›`;
      const arc = $(".sc-arc"); arc.style.strokeDasharray = `${Math.min(100, Math.abs(gap || 0) * 100)} 100`; arc.setAttribute("class", "sc-arc " + T.cls(gap));
      if (sp.length > 1) { const mn = Math.min(...sp), mx = Math.max(...sp), r = mx - mn || 1;
        const pl = $(".sc-spark"); pl.setAttribute("points", sp.map((v, k) => `${92 + (k / (sp.length - 1)) * 216},${318 - ((v - mn) / r) * 44}`).join(" "));
        pl.setAttribute("class", "sc-spark " + (sp[sp.length - 1] >= sp[0] ? "up" : "down"));
        if (!calm() && pl.animate) pl.animate([{ strokeDashoffset: 100 }, { strokeDashoffset: 0 }], { duration: 900, easing: "cubic-bezier(.2,.8,.2,1)" }); }
      root.querySelectorAll(".sc-dots button").forEach((b, k) => b.classList.toggle("on", k === i));
      const st = $(".sc-stage"); st.classList.remove("tick"); void st.offsetWidth; st.classList.add("tick");
    };
    $(".sc-prev").addEventListener("click", () => show(i - 1));
    $(".sc-next").addEventListener("click", () => show(i + 1));
    root.querySelector(".sc-dots").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) show(+b.dataset.i); });
    ["pointerenter", "focusin"].forEach((ev) => root.addEventListener(ev, () => { hold = true; }));
    ["pointerleave", "focusout"].forEach((ev) => root.addEventListener(ev, () => { hold = false; }));
    clearInterval(timer);
    timer = setInterval(() => { if (!root.isConnected) { clearInterval(timer); return; } if (!hold && !document.hidden && !calm()) show(i + 1); }, 4200);
    show(0);
  }

  // ------------------------------------------------------------------ page
  async function render(view) {
    const lang = getLang(), L = TXT[lang], M = money(lang), P = pct(lang);
    document.body.classList.add("landing");
    store.set("mangrove-seen", "1");
    const [u, bio, pred, feed] = await Promise.all([T.get("universe.json"), T.get("biotech.json").catch(() => null), T.get("predictions.json").catch(() => null),
      T.get("feed.json").catch(() => null)]);
    const latest = T.sortEvents ? T.sortEvents((feed || {}).events || []).slice(0, 5) : [];
    const today = new Date().toISOString().slice(0, 10);
    const feat = u.tickers.find((t) => t.method !== "rnpv" && T.isNum(t.price)) || u.tickers[0];
    const val = await T.get(`${feat.ticker}/valuation.json`).catch(() => null);
    const cats = ((bio || {}).calendar || []).filter((c) => c.kind !== "trial" && c.date >= today && !c.outcome).slice(0, 4);
    const nexts = Object.entries((pred || {}).next || {}).filter(([, n]) => n && n.date >= today).sort((a, b) => a[1].date.localeCompare(b[1].date)).slice(0, 4);
    const dd = (s) => Math.round((new Date(s) - new Date(today)) / 864e5);
    const when = (s) => { const d = dd(s); return d <= 0 ? L.today : L.dminus(d); };

    // specimen A: one slider of the visitor's own DCF, starting from the growth that today's price assumes
    let specA = "", calc = null;
    const MD = window.MyDCF, I = val && val.dcf && val.dcf.inputs;
    if (MD && MD.usable(I)) {
      const st = MD.start(I, feat.price);
      if (T.isNum(st.implied) && st.implied > -0.2 && st.implied < 0.6) {
        const n = I.revenue_growth.length, g0 = Math.round(st.implied * 200) / 200;
        calc = { st, I, n };
        specA = `<figure class="lp-fig lp-calc"><figcaption>${T.esc(L.aCap(feat.ticker, P(st.implied, 1).replace(/^\+/, ""), n))}</figcaption>
          <label for="lpG">${T.esc(L.aSlide(n))}<output class="num" id="lpGv" for="lpG"></output></label>
          <input type="range" id="lpG" min="-0.1" max="0.6" step="0.005" value="${g0}">
          <dl class="lp-out" aria-live="polite"><div><dt>${T.esc(L.aVal)}</dt><dd class="num" id="lpV"></dd></div><div><dt>${T.esc(L.aGap)}</dt><dd class="num" id="lpU"></dd></div>
            <div><dt>${T.esc(L.price)}</dt><dd class="num">${M(feat.price)}</dd></div></dl>
          <p class="note">${T.esc(L.aNote)}</p></figure>`;
      }
    }
    const kind = (c) => L.kinds[c.kind] || c.kind_label;
    const asset = (c) => (lang === "fr" ? c.asset || "" : (c.asset || "").replace(/\s*\(.*$/, ""));
    const specB = cats.length ? `<div class="lp-list">${cats.map((c) => `<a href="#/t/${c.ticker}/biotech"><span class="num lp-d">${when(c.date)}</span><b>${c.ticker}</b>
        <span class="lp-what">${T.esc(kind(c))}<em>${T.esc(asset(c))}</em></span>
        <span class="num lp-p">${T.isNum(c.p_model) ? nf(lang)(c.p_model * 100, 0) + (lang === "fr" ? " %" : "%") : "-"}${T.isNum(c.p_base) && c.p_base !== c.p_model ? `<em>${L.bHist} ${nf(lang)(c.p_base * 100, 0)}${lang === "fr" ? " %" : "%"}</em>` : ""}</span></a>`).join("")}</div>` : "";
    const specC = nexts.length ? `<div class="lp-list">${nexts.map(([tk, n]) => `<a href="#/t/${tk}/predictions"><span class="num lp-d">${when(n.date)}</span><b>${tk}</b>
        <span class="lp-what">${T.esc(n.period)}<em>${day(lang, n.date)}${n.estimated ? ` · ${L.est}` : ""}</em></span>
        <span class="num lp-p">${L.cLock}<em>${new Date(n.deadline).toLocaleString(lang === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</em></span></a>`).join("")}</div>` : "";
    const spec = (cls, [h, p, link], href, fig) => `<section class="lp-spec ${cls}"><div class="lp-copy"><h2>${T.esc(h)}</h2><p>${T.esc(p)}</p>
        <a class="lp-more" href="${href}">${T.esc(typeof link === "function" ? link(feat.ticker) : link)} ›</a></div><div class="panel lp-live">${fig}</div></section>`;
    const canAsk = !!(T.members && T.members.configured);

    const chap = (k) => `<header class="lp-chap" id="lp-${k}"><svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPH[k]}</svg>
        <div><h2>${T.esc(L.chap[k][0])}</h2><p>${T.esc(L.chap[k][1])}</p></div></header>`;
    const feedList = latest.length ? `<div class="lp-list lp-feed">${latest.map((e) => `<a href="#/t/${e.ticker}"><span class="num lp-d">${day(lang, e.date)}</span><b>${T.esc(e.ticker || "")}</b>
        <span class="lp-what">${T.esc(e.title)}<em>${T.esc(e.detail || "")}</em></span></a>`).join("")}</div>` : "";

    view.innerHTML = `<div class="lp" lang="${lang}">
      <canvas class="lp-scene" id="lpScene" aria-hidden="true"></canvas>
      <section class="lp-hero">
        <div class="lp-top"><span class="muted num">${T.esc(L.asof(new Date(u.meta.generated_at).toLocaleString(lang === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })))}</span>
          <div class="seg" id="lpLang" role="group" aria-label="Langue / Language"><button type="button" data-k="fr" class="${lang === "fr" ? "on" : ""}" lang="fr">Français</button><button type="button" data-k="en" class="${lang === "en" ? "on" : ""}" lang="en">English</button></div></div>
        <div class="lp-head">
          <h1 class="lp-brand" aria-label="Mangrove">${"Mangrove".split("").map((c, k) => `<span aria-hidden="true" style="--k:${k}">${c}</span>`).join("")}</h1>
          <div class="lp-sub">
            <p class="lp-tag">${L.h1.map((l, k) => `<span style="--k:${k}">${T.esc(l)}</span>`).join(" ")}</p>
            <p class="lp-lede">${T.esc(L.lede)}</p>
            <div class="lp-cta"><a class="btn primary lp-big" href="#/">${T.esc(L.enter)}</a>${canAsk ? `<a class="btn lp-big" href="#/bienvenue" data-ask>${T.esc(L.ask)}</a>` : ""}
              <a class="lp-down" href="#lp-canopy" data-down>${T.esc(L.scroll)} ↓</a></div>
            <p class="note">${T.esc(L.free)}</p></div></div>
      </section>
      ${chap("canopy")}
      <section class="lp-canopy">
        <div class="lp-scope" id="lpScope"></div>
        ${feedList ? `<div class="panel lp-live"><h3>${T.esc(L.feedH)} <a class="hint" href="#/feed">${T.esc(L.feedMore)} ›</a></h3>${feedList}</div>` : ""}
      </section>
      ${chap("water")}
      ${specB ? spec("b flip", L.b, "#/biotech", specB) : ""}
      ${specC ? spec("c", L.c, "#/predictions", specC) : ""}
      ${chap("roots")}
      ${specA ? spec("a", L.a, `#/t/${feat.ticker}/valorisation`, specA) : ""}
      <section class="lp-also"><h2>${T.esc(L.also)}</h2><dl>${L.alsoList.map(([a, b]) => `<div><dt>${T.esc(a)}</dt><dd>${T.esc(b)}</dd></div>`).join("")}</dl></section>
      <section class="lp-not"><h2>${T.esc(L.notH)}</h2><ul>${L.not(u.tickers.length).map((x) => { const [a, ...b] = x.split(" : ").length > 1 ? x.split(" : ") : x.split(": "); return `<li><b>${T.esc(a)}</b>${b.length ? `<span>${T.esc(b.join(": "))}</span>` : ""}</li>`; }).join("")}</ul></section>
      <section class="lp-beta panel" id="lpBeta"><div><h2>${T.esc(L.betaH)}</h2><p>${T.esc(L.beta)}</p><a class="lp-more" href="#/compte">${T.esc(L.have)} ›</a></div>
        ${canAsk ? `<form class="aform" id="lpForm" novalidate><label>${T.esc(L.email)}<input type="email" name="email" required autocomplete="email" maxlength="254"></label>
          <label>${T.esc(L.note)}<input name="note" maxlength="500" autocomplete="off"></label>
          <button class="btn primary" type="submit">${T.esc(L.send)}</button><div class="note" id="lpMsg" role="status"></div>
          <p class="note">${T.esc(L.privacy)}</p></form>` : `<p class="note">${T.esc(L.off)}</p>`}</section>
      <footer class="foot"><span>${T.esc(L.src)}</span></footer></div>`;

    // the scene: camera goes down the tree as the page scrolls (canopy -> waterline -> roots)
    if (scene) { scene.stop(); scene = null; }
    if (!calm() && window.MangroveScene) {
      const roots = T.$("#lp-roots");
      scene = window.MangroveScene.start({ canvas: T.$("#lpScene"), progress: () => {
        const end = roots ? roots.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.35 : document.body.scrollHeight;
        return window.scrollY / Math.max(1, end);
      }, dim: () => { const r = roots ? roots.getBoundingClientRect().top : 0; return r < 0 ? Math.max(0.55, 1 + r / (window.innerHeight * 2)) : 1; } });
    }
    if (!scene) document.body.classList.add("lp-still");
    const down = view.querySelector("[data-down]");
    if (down) down.addEventListener("click", (e) => { e.preventDefault(); T.$("#lp-canopy").scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "start" }); });
    scope(T.$("#lpScope"), u.tickers, L, lang);
    if (calc) {
      const inp = T.$("#lpG"), draw = (exact) => {
        const g = exact ? calc.st.implied : parseFloat(inp.value);
        calc.st.s.revenue_growth = calc.st.s.revenue_growth.map(() => g);
        const c = MD.compute(calc.st, calc.I, feat.price), v = c.ok ? c.res.value_per_share : null, up = c.ok ? c.res.upside : null;
        T.$("#lpGv").textContent = P(g, 1); T.$("#lpV").textContent = M(v);
        const flat = T.isNum(up) && Math.abs(up) < 0.0005, o = T.$("#lpU"); o.textContent = P(flat ? 0 : up, 1); o.className = "num " + T.cls(flat ? 0 : up);
      };
      inp.addEventListener("input", () => draw(false));
      draw(true);
    }
    T.$("#lpLang").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b || b.dataset.k === lang) return; store.set("mangrove-lang", b.dataset.k); T.render(); });
    const ask = view.querySelector("[data-ask]");
    if (ask) ask.addEventListener("click", (e) => { e.preventDefault(); T.$("#lpBeta").scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "center" }); const f = T.$("#lpForm [name=email]"); if (f) f.focus({ preventScroll: true }); });
    const form = T.$("#lpForm");
    if (form) form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form), msg = T.$("#lpMsg"), email = String(fd.get("email") || "").trim();
      msg.className = "note";
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) { msg.className = "note warn"; msg.textContent = lang === "fr" ? "Cette adresse e-mail ne semble pas valide." : "This e-mail address doesn't look valid."; return; }
      msg.textContent = "…";
      const r = await T.members.sb.rpc("request_invite", { p_email: email, p_note: String(fd.get("note") || ""), p_lang: lang });
      if (r.error) { msg.className = "note warn"; msg.textContent = /Trop de demandes/.test(r.error.message) && lang === "en" ? "Too many requests today. Try again tomorrow." : /invalide/.test(r.error.message) && lang === "en" ? "This e-mail address doesn't look valid." : r.error.message; return; }
      form.reset(); msg.className = "note up"; msg.textContent = L.sent;
    });
  }

  T.route(/^\/bienvenue$/, render);
  const syncBody = () => { if (!/^#\/bienvenue/.test(location.hash)) { document.body.classList.remove("landing", "lp-still"); clearInterval(timer); if (scene) { scene.stop(); scene = null; } } };
  window.addEventListener("hashchange", syncBody);

  // First visit without an account: the site root opens the front door once.
  T.landing = {
    shouldShow: async () => {
      if (store.get("mangrove-seen")) return false;
      if (T.members && T.members.ready) { try { await T.members.ready; } catch (e) { /* ignore */ } }
      if (T.user) { store.set("mangrove-seen", "1"); return false; }
      return true;
    },
  };
})();
