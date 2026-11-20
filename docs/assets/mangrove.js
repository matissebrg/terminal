/* Coming-soon items (config.js, window.MANGROVE).
   - T.soon(tk) / T.renderSoon(view, tk): announced tickers get a "coming soon" page instead of a stock page.
   - T.soonComps(): the comparables panel shown while peer comparables are being rebuilt. */
(function () {
  "use strict";
  const T = window.T, CFG = window.MANGROVE || {};
  const soonList = CFG.comingSoon || [], soonMap = {};
  soonList.forEach((s) => { soonMap[s.ticker] = s; });

  T.soonList = soonList;
  T.soon = (tk) => soonMap[String(tk || "").toUpperCase()] || null;
  T.compsSoon = !!CFG.comparablesSoon;

  const ROOTS = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 25.5c0-5 3.6-8.4 8.6-8.1 1.6-4.8 6-7.9 11.2-7.4 2.6-2.4 7.6-2.4 10.6.4 4.4-.6 8.4 2.4 9.2 6.8 3.9.8 6.4 4 5.4 8.3Z" stroke-width="2.4"/><path d="M32 25.5v7" stroke-width="2.4"/><path d="M32 31.5c-8.5.6-16 7-19 20.5M32 31.5c8.5.6 16 7 19 20.5M32 32.5c-4 3.4-7 10-7.6 19.5M32 32.5c4 3.4 7 10 7.6 19.5" stroke-width="2.2"/><path d="M4 44h56" stroke="var(--bio)" stroke-width="2.2"/></svg>';

  T.renderSoon = (view, tk) => {
    const s = T.soon(tk);
    view.innerHTML = `<div class="soon-page">
      <div class="soon-mark">${ROOTS}</div>
      <div class="soon-tag">Bientôt dans Mangrove</div>
      <h1>${T.esc(s.name)} <span class="tag">${T.esc(s.ticker)}</span></h1>
      <p class="sec">${T.esc(s.note || "")}</p>
      <p class="sec">La couverture est en préparation. La fiche arrivera avec les mêmes onglets que les autres valeurs :
        états financiers, ratios, valorisation, catalyseurs, options et prédictions.</p>
      <div class="row soon-cta"><a class="btn primary" href="#/biotech">Calendrier des catalyseurs</a><a class="btn" href="#/">Tableau de bord</a></div>
      <div class="soon-others"><span class="muted">Aussi en préparation :</span>
        ${soonList.filter((x) => x.ticker !== s.ticker).map((x) => `<a href="#/t/${x.ticker}"><b>${x.ticker}</b> ${T.esc(x.name)}</a>`).join("")}
        ${T.compsSoon ? '<span>Comparables boursiers</span>' : ""}</div>
    </div>`;
  };

  T.soonComps = (title = "Comparables boursiers") => `<div class="panel soon-panel"><h3>${T.esc(title)} <span class="soon-pill">Bientôt</span></h3>
      <p class="sec" style="margin:0">Les comparables sont en cours de refonte pour la santé : pairs choisis par aire thérapeutique et par stade
        (commerciale, clinique), multiples adaptés (VE/CA, VE/pic de ventes, trésorerie). Ils reviennent ici dès qu'ils sont prêts.</p></div>`;
})();
